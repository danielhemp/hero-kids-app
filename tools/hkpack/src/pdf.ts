/**
 * Thin wrappers around poppler-utils. We shell out rather than use a JS PDF
 * library because we need the *embedded* images at their original resolution,
 * not a re-render of the page — `pdfimages` gives us exactly that, along with
 * the stored DPI that tells us how big a printed grid square is.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);

const MAX_BUFFER = 64 * 1024 * 1024;

export interface PdfImage {
  page: number;
  /** poppler's sequential image number within the document */
  num: number;
  /** 'image' for colour data, 'smask' for the alpha channel of the preceding image */
  type: 'image' | 'smask' | 'mask' | 'stencil';
  width: number;
  height: number;
  /** PDF object id — the same id on many pages means a repeated template asset */
  objectId: number;
  xPpi: number;
  yPpi: number;
  bytes: number;
}

export interface PdfInfo {
  title: string;
  subject: string;
  pages: number;
  /** page width/height in points (72pt = 1 inch) */
  pageWidthPt: number;
  pageHeightPt: number;
}

function parseSize(value: string): number {
  // pdfimages prints sizes as "553K", "2829K", "4966B"
  const m = /^([\d.]+)([BKMG]?)$/.exec(value.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2] ?? 'B';
  const scale = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[unit] ?? 1;
  return Math.round(n * scale);
}

export async function pdfInfo(file: string): Promise<PdfInfo> {
  const { stdout } = await run('pdfinfo', [file], { maxBuffer: MAX_BUFFER });
  const fields = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) fields.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  const size = /([\d.]+) x ([\d.]+) pts/.exec(fields.get('Page size') ?? '');
  return {
    title: fields.get('Title') ?? path.basename(file, '.pdf'),
    subject: fields.get('Subject') ?? '',
    pages: Number(fields.get('Pages') ?? 0),
    pageWidthPt: size ? Number(size[1]) : 792,
    pageHeightPt: size ? Number(size[2]) : 612,
  };
}

/** Inventory every embedded image in the document, with its page and stored DPI. */
export async function listImages(file: string): Promise<PdfImage[]> {
  const { stdout } = await run('pdfimages', ['-list', file], { maxBuffer: MAX_BUFFER });
  const out: PdfImage[] = [];
  for (const line of stdout.split('\n')) {
    // page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio
    const f = line.trim().split(/\s+/);
    if (f.length < 15) continue;
    const page = Number(f[0]);
    if (!Number.isFinite(page) || page < 1) continue;
    const type = f[2] as PdfImage['type'];
    if (type !== 'image' && type !== 'smask' && type !== 'mask' && type !== 'stencil') continue;
    // "object ID" is two columns: the id and a generation number.
    out.push({
      page,
      num: Number(f[1]),
      type,
      width: Number(f[3]),
      height: Number(f[4]),
      objectId: Number(f[10]),
      xPpi: Number(f[12]),
      yPpi: Number(f[13]),
      bytes: parseSize(f[14] ?? '0B'),
    });
  }
  return out;
}

/** Extract the embedded images on a page range as PNGs (alpha preserved). */
export async function extractImages(
  file: string,
  firstPage: number,
  lastPage: number,
  outPrefix: string,
): Promise<string[]> {
  await run(
    'pdfimages',
    ['-png', '-f', String(firstPage), '-l', String(lastPage), file, outPrefix],
    { maxBuffer: MAX_BUFFER },
  );
  const dir = path.dirname(outPrefix);
  const base = path.basename(outPrefix);
  const files = await readdir(dir);
  return files
    .filter((f) => f.startsWith(`${base}-`) && f.endsWith('.png'))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Render a whole page to PNG at the given DPI — used for preview thumbnails. */
export async function renderPage(
  file: string,
  page: number,
  dpi: number,
  outPrefix: string,
): Promise<string> {
  await run(
    'pdftoppm',
    ['-f', String(page), '-l', String(page), '-r', String(dpi), '-png', file, outPrefix],
    { maxBuffer: MAX_BUFFER },
  );
  const dir = path.dirname(outPrefix);
  const base = path.basename(outPrefix);
  const files = await readdir(dir);
  const hit = files.filter((f) => f.startsWith(`${base}-`) && f.endsWith('.png')).sort();
  if (hit.length === 0) throw new Error(`pdftoppm produced nothing for page ${page}`);
  return path.join(dir, hit[hit.length - 1]!);
}

/** The text layer, one entry per page, laid out to preserve the two-column split. */
export async function pageText(file: string): Promise<string[]> {
  const { stdout } = await run('pdftotext', ['-layout', file, '-'], { maxBuffer: MAX_BUFFER });
  // pdftotext separates pages with a form feed
  return stdout.split('\f');
}
