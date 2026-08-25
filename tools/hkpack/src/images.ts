/**
 * Pulling embedded images out of the PDF at full resolution.
 *
 * `pdfimages -png` writes an image and its soft mask as two separate files, so
 * we re-pair them here and composite the mask back in as alpha. That matters
 * for the stand-up minis, whose whole value is a clean cut-out.
 */
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import sharp from 'sharp';
import { listImages, extractImages, type PdfImage } from './pdf.ts';

export interface ExtractedImage {
  /** PDF object id — identical art placed twice shares an id */
  objectId: number;
  /** poppler's image number, unique per placement — keeps ordering stable */
  num: number;
  page: number;
  width: number;
  height: number;
  ppi: number;
  /** path to a PNG on disk, alpha composited if the source had a soft mask */
  file: string;
  hasAlpha: boolean;
}

/**
 * Images that appear on five or more pages are page furniture — the parchment
 * background, header rules, the little dragon in the corner. Never content.
 */
export function findTemplateObjects(images: PdfImage[], minPages = 5): Set<number> {
  const pagesByObject = new Map<number, Set<number>>();
  for (const img of images) {
    if (img.type !== 'image') continue;
    let pages = pagesByObject.get(img.objectId);
    if (!pages) pagesByObject.set(img.objectId, (pages = new Set()));
    pages.add(img.page);
  }
  const templates = new Set<number>();
  for (const [id, pages] of pagesByObject) {
    if (pages.size >= minPages) templates.add(id);
  }
  return templates;
}

/**
 * Walk poppler's listing in order, pairing each image with the smask that
 * follows it. Returns one record per placed image, in document order.
 */
function pairWithMasks(images: PdfImage[]): { image: PdfImage; mask: PdfImage | null }[] {
  const out: { image: PdfImage; mask: PdfImage | null }[] = [];
  for (let i = 0; i < images.length; i++) {
    const cur = images[i]!;
    if (cur.type !== 'image') continue;
    const next = images[i + 1];
    const isMask =
      next !== undefined &&
      (next.type === 'smask' || next.type === 'mask') &&
      next.page === cur.page &&
      next.width === cur.width &&
      next.height === cur.height;
    out.push({ image: cur, mask: isMask ? next : null });
  }
  return out;
}

/**
 * Extract every image on `pages`, skipping template furniture and anything
 * smaller than `minSize` (the numbered circles printed beside each mini).
 *
 * Done one page at a time: `pdfimages` restarts its output numbering on every
 * invocation, so per-page extraction lets us line files up with the listing by
 * position, and it keeps peak disk use to a single page's worth of PNGs
 * instead of the whole book's.
 */
export async function extractPageImages(
  pdfFile: string,
  workDir: string,
  opts: {
    pages?: number[];
    minSize?: number;
    skipObjects?: Set<number>;
    onPage?: (page: number, total: number) => void;
  } = {},
): Promise<ExtractedImage[]> {
  const minSize = opts.minSize ?? 100;
  const skip = opts.skipObjects ?? new Set<number>();
  const listing = await listImages(pdfFile);

  const allPages = [...new Set(listing.map((i) => i.page))].sort((a, b) => a - b);
  const pages = opts.pages ? allPages.filter((p) => opts.pages!.includes(p)) : allPages;

  const rawDir = path.join(workDir, 'raw');
  const outDir = path.join(workDir, 'images');
  await mkdir(outDir, { recursive: true });

  const out: ExtractedImage[] = [];

  for (const [index, page] of pages.entries()) {
    opts.onPage?.(page, pages.length);
    const onPage = listing.filter((i) => i.page === page);
    if (onPage.length === 0) continue;

    // Nothing worth extracting? Don't pay for the render.
    const wanted = pairWithMasks(onPage).filter(
      (p) => !skip.has(p.image.objectId) && p.image.width >= minSize && p.image.height >= minSize,
    );
    if (wanted.length === 0) continue;

    await rm(rawDir, { recursive: true, force: true });
    await mkdir(rawDir, { recursive: true });
    const files = await extractImages(pdfFile, page, page, path.join(rawDir, 'img'));

    // pdfimages writes one file per listing row on this page, in listing order.
    const fileAt = new Map<number, string>();
    onPage.forEach((row, i) => {
      const f = files[i];
      if (f) fileAt.set(row.num, f);
    });

    for (const { image, mask } of wanted) {
      const colourFile = fileAt.get(image.num);
      if (!colourFile) continue;
      const maskFile = mask ? fileAt.get(mask.num) : undefined;

      const dest = path.join(outDir, `p${image.page}-o${image.objectId}-n${image.num}.png`);
      if (maskFile) {
        // poppler hands back the mask as a standalone greyscale PNG; join it on
        // as the alpha channel so cut-outs stay cut out.
        const alpha = await sharp(maskFile)
          .resize(image.width, image.height, { fit: 'fill' })
          .greyscale()
          .raw()
          .toBuffer();
        await sharp(colourFile)
          .resize(image.width, image.height, { fit: 'fill' })
          .ensureAlpha()
          .joinChannel(alpha, {
            raw: { width: image.width, height: image.height, channels: 1 },
          })
          .png()
          .toFile(dest);
      } else {
        await sharp(colourFile).png().toFile(dest);
      }

      out.push({
        objectId: image.objectId,
        num: image.num,
        page: image.page,
        width: image.width,
        height: image.height,
        ppi: image.xPpi || 200,
        file: dest,
        hasAlpha: Boolean(maskFile),
      });
    }
    void index;
  }

  await rm(rawDir, { recursive: true, force: true });
  return out;
}

/**
 * A coarse perceptual signature: 16x16 greyscale, mean-centred. Good enough to
 * recognise that the little map printed beside an encounter is the same
 * artwork as one of the full-page maps at the back.
 */
export async function signature(file: string): Promise<Float64Array> {
  const size = 16;
  const raw = await sharp(file)
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(size, size, { fit: 'fill' })
    .raw()
    .toBuffer();
  const sig = new Float64Array(size * size);
  let mean = 0;
  for (let i = 0; i < sig.length; i++) mean += raw[i]!;
  mean /= sig.length;
  for (let i = 0; i < sig.length; i++) sig[i] = raw[i]! - mean;
  return sig;
}

/** Normalised cross-correlation, 1.0 == identical. */
export function similarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
