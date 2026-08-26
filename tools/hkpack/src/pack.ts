/**
 * Assembling a .hkpack: classify every image, convert the ones worth keeping,
 * match each encounter to its map, and write the zip.
 */
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import yazl from 'yazl';
import { extractImages, listImages, pageText, pdfInfo, type PdfImage } from './pdf.ts';
import {
  extractPageImages,
  findTemplateObjects,
  signature,
  similarity,
  type ExtractedImage,
} from './images.ts';
import { classifyAll, dedupeByObject, type ClassifiedImage } from './classify.ts';
import { gridFromDpi, gridsFromMeasurements, measureMap } from './grid.ts';
import { parseProse } from './prose.ts';
import { readCardName, ocrAvailable } from './names.ts';
import { detectMarkers, readGlyphs } from './markers.ts';
import {
  PACK_FORMAT,
  type CardAsset,
  type Manifest,
  type MapAsset,
  type TokenAsset,
} from './types.ts';

export interface PackOptions {
  pdfFile: string;
  outDir: string;
  workDir: string;
  /** skip OCR even when tesseract is installed */
  noOcr?: boolean;
  log?: (message: string) => void;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function toWebp(src: string, dest: string, opts: { alpha: boolean; quality: number }) {
  const pipeline = sharp(src);
  if (!opts.alpha) pipeline.flatten({ background: '#ffffff' });
  await pipeline.webp({ quality: opts.quality, effort: 5 }).toFile(dest);
}

/**
 * Pull the book's circled digits out as matchable artwork.
 *
 * They are ordinary embedded images, one per digit, reused wherever the book
 * prints a number — beside a roster line, beside a health box, and on the GM's
 * copy of each map. Their soft mask carries the drawing; the colour plane is a
 * flat grey, which is why the mask is what gets kept.
 */
async function extractGlyphs(
  pdfFile: string,
  workDir: string,
  listing: PdfImage[],
): Promise<{ objectId: number; file: string }[]> {
  // A circled digit is small, square, and — because the book prints the same
  // number beside a roster line, a health box and a map — reused across pages.
  // That last test is what keeps dice faces and spot illustrations out.
  const pagesPerObject = new Map<number, Set<number>>();
  for (const image of listing) {
    if (image.type !== 'image') continue;
    let pages = pagesPerObject.get(image.objectId);
    if (!pages) pagesPerObject.set(image.objectId, (pages = new Set()));
    pages.add(image.page);
  }
  const candidates = listing.filter(
    (i) =>
      i.type === 'image' &&
      i.width >= 40 &&
      i.width < 130 &&
      i.height >= 40 &&
      i.height < 130 &&
      Math.abs(i.width / i.height - 1) < 0.12 &&
      (pagesPerObject.get(i.objectId)?.size ?? 0) >= 2,
  );
  if (!candidates.length) return [];

  const outDir = path.join(workDir, 'glyphs');
  await mkdir(outDir, { recursive: true });

  const glyphs: { objectId: number; file: string }[] = [];
  const taken = new Set<number>();
  for (const page of [...new Set(candidates.map((c) => c.page))].sort((a, b) => a - b)) {
    const seenHere = new Set<number>();
    const wanted = candidates.filter((c) => {
      if (c.page !== page || taken.has(c.objectId) || seenHere.has(c.objectId)) return false;
      seenHere.add(c.objectId);
      return true;
    });
    if (!wanted.length) continue;

    const raw = path.join(workDir, 'glyphs-raw');
    await rm(raw, { recursive: true, force: true });
    await mkdir(raw, { recursive: true });
    const files = await extractImages(pdfFile, page, page, path.join(raw, 'g'));
    const onPage = listing.filter((r) => r.page === page);
    for (const row of wanted) {
      // pdfimages writes one file per listing row, in order, so a glyph's mask
      // is the row immediately after the glyph itself.
      const at = onPage.findIndex((r) => r.num === row.num);
      const mask = files[at + 1];
      if (!mask) continue;
      const dest = path.join(outDir, `glyph-${row.objectId}.png`);
      await sharp(mask).negate().toFile(dest);
      glyphs.push({ objectId: row.objectId, file: dest });
      taken.add(row.objectId);
    }
  }
  return glyphs;
}

/**
 * Every encounter prints a small copy of its map beside the text. Matching that
 * thumbnail against the full-page maps at the back of the book is what tells us
 * which map belongs to which encounter — the PDF itself never says.
 */
async function matchThumbnailsToMaps(
  thumbnails: ClassifiedImage[],
  maps: { asset: MapAsset; source: ExtractedImage }[],
): Promise<{ byPage: Map<number, string[]>; thumbForMap: Map<string, ClassifiedImage> }> {
  const mapSigs = await Promise.all(
    maps.map(async (m) => ({ id: m.asset.id, sig: await signature(m.source.file) })),
  );
  const byPage = new Map<number, string[]>();
  const thumbForMap = new Map<string, ClassifiedImage>();
  const bestScore = new Map<string, number>();

  for (const thumb of thumbnails) {
    const sig = await signature(thumb.file);
    const scored = mapSigs
      .map((candidate) => ({ id: candidate.id, score: similarity(sig, candidate.sig) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const runnerUp = scored[1];
    if (!best) continue;

    // A correct match scores 0.7-0.99, but printer-friendly editions push some
    // down toward 0.5, so an absolute cut alone either loses real matches or
    // invents wrong ones. What actually separates a match from a near-miss is
    // the gap to the second-best map.
    const clear = best.score >= 0.5 && best.score - (runnerUp?.score ?? 0) >= 0.12;
    if (process.env.HKPACK_DEBUG) {
      const top = scored.slice(0, 3).map((s) => `${s.id}:${s.score.toFixed(2)}`).join(' ');
      process.stdout.write(`    thumb p${thumb.page} -> ${clear ? 'MATCH' : 'reject'}  ${top}\n`);
    }
    if (!clear) continue;

    const list = byPage.get(thumb.page) ?? [];
    if (!list.includes(best.id)) list.push(best.id);
    byPage.set(thumb.page, list);

    // Several pages can show the same map; the clearest copy is the one to read
    // the markers off.
    if (best.score > (bestScore.get(best.id) ?? 0)) {
      bestScore.set(best.id, best.score);
      thumbForMap.set(best.id, thumb);
    }
  }
  return { byPage, thumbForMap };
}

export async function buildPack(opts: PackOptions): Promise<{ manifest: Manifest; packFile: string }> {
  const log = opts.log ?? (() => {});
  const { pdfFile } = opts;

  const info = await pdfInfo(pdfFile);
  const id = slug(info.title);
  const assetDir = path.join(opts.workDir, 'assets');
  await rm(assetDir, { recursive: true, force: true });
  for (const sub of ['maps', 'cards', 'tokens']) {
    await mkdir(path.join(assetDir, sub), { recursive: true });
  }

  log(`reading ${path.basename(pdfFile)} (${info.pages} pages)`);

  const texts = await pageText(pdfFile);
  const wordsByPage = new Map<number, number>();
  texts.forEach((t, i) => wordsByPage.set(i + 1, t.trim().split(/\s+/).filter(Boolean).length));

  const listing = await listImages(pdfFile);
  const templates = findTemplateObjects(listing);
  const extracted = await extractPageImages(pdfFile, opts.workDir, {
    skipObjects: templates,
    onPage: (page, total) => log(`  extracting images, page ${page}/${total}`),
  });
  const classified = dedupeByObject(classifyAll(extracted, wordsByPage));

  // --- maps -----------------------------------------------------------------
  const mapSources = classified.filter((c) => c.role === 'map');
  const gridWarnings: Manifest['unresolved'] = [];

  const measurements = [];
  for (const src of mapSources) {
    measurements.push(await measureMap(src.file, src.width, src.height, src.ppi));
  }
  const { bookPeriod, grids } = gridsFromMeasurements(measurements);
  if (mapSources.length) log(`  grid pitch ${bookPeriod.toFixed(1)}px (median across the book)`);

  const maps: { asset: MapAsset; source: ExtractedImage }[] = [];
  for (const [i, src] of mapSources.entries()) {
    const assetId = `map-${String(i + 1).padStart(2, '0')}`;
    const file = `maps/${assetId}.webp`;
    await toWebp(src.file, path.join(assetDir, file), { alpha: false, quality: 82 });
    const measured = grids.get(src.file);
    if (measured && !measured.agreesWithBook) {
      gridWarnings.push({
        page: src.page,
        reason: `${assetId}: the printed ruling did not match the rest of the book — check the grid overlay`,
      });
    }
    maps.push({
      asset: {
        id: assetId,
        file,
        width: src.width,
        height: src.height,
        ppi: src.ppi,
        grid: measured?.grid ?? gridFromDpi(src.width, src.height, src.ppi),
        page: src.page,
        label: `Map ${i + 1} (p${src.page})`,
        markers: [],
      },
      source: src,
    });
  }
  log(`  ${maps.length} maps`);

  // --- cards ----------------------------------------------------------------
  const useOcr = !opts.noOcr && (await ocrAvailable());
  if (!useOcr) log('  tesseract not found — card names left blank for hand-editing');
  const cardSources = classified.filter((c) => c.role.endsWith('Card'));
  const cards: CardAsset[] = [];
  for (const [i, src] of cardSources.entries()) {
    const assetId = `card-${String(i + 1).padStart(2, '0')}`;
    const file = `cards/${assetId}.webp`;
    await toWebp(src.file, path.join(assetDir, file), { alpha: false, quality: 88 });
    cards.push({
      id: assetId,
      file,
      kind: src.role === 'heroCard' ? 'hero' : src.role === 'monsterCard' ? 'monster' : 'unknown',
      name: useOcr ? await readCardName(src.file) : '',
      width: src.width,
      height: src.height,
      page: src.page,
    });
  }
  log(`  ${cards.length} cards${useOcr ? ` (${cards.filter((c) => c.name).length} named by OCR)` : ''}`);

  // --- tokens ---------------------------------------------------------------
  const tokenSources = classified.filter((c) => c.role === 'token');
  const tokens: TokenAsset[] = [];
  for (const [i, src] of tokenSources.entries()) {
    const assetId = `token-${String(i + 1).padStart(2, '0')}`;
    const file = `tokens/${assetId}.webp`;
    await toWebp(src.file, path.join(assetDir, file), { alpha: true, quality: 90 });
    tokens.push({
      id: assetId,
      file,
      name: '',
      width: src.width,
      height: src.height,
      page: src.page,
    });
  }
  log(`  ${tokens.length} stand-up minis`);

  // --- text -----------------------------------------------------------------
  const prose = await parseProse(pdfFile);
  const thumbnails = classified.filter((c) => c.role === 'thumbnail');
  const { byPage: mapsByPage, thumbForMap } = await matchThumbnailsToMaps(thumbnails, maps);

  // --- what the book says to put where --------------------------------------
  const glyphFiles = await extractGlyphs(pdfFile, opts.workDir, listing);
  const glyphs = await readGlyphs(glyphFiles);
  let placed = 0;
  for (const map of maps) {
    const thumb = thumbForMap.get(map.asset.id);
    if (!thumb || glyphs.length === 0) continue;
    map.asset.markers = await detectMarkers({
      thumbnail: thumb.file,
      map: map.source.file,
      width: map.asset.width,
      height: map.asset.height,
      grid: map.asset.grid,
      glyphs,
    });
    if (map.asset.markers.length) placed++;
  }
  if (maps.length) {
    log(`  ${glyphs.length} numbered markers known, positions read on ${placed}/${maps.length} maps`);
  }

  const unresolved: Manifest['unresolved'] = [...gridWarnings];

  // An encounter's map is not always printed on the page its title is on: in
  // Reign of the Dragon each encounter runs across two or three pages and the
  // "Combat Map" section lands on the second. So a thumbnail belongs to the
  // last encounter that started at or before its page.
  for (const [index, encounter] of prose.encounters.entries()) {
    const start = encounter.page;
    const end = prose.encounters[index + 1]?.page ?? Number.MAX_SAFE_INTEGER;
    const ids: string[] = [];
    for (const [page, mapIds] of mapsByPage) {
      if (page < start || page >= end) continue;
      for (const id of mapIds) if (!ids.includes(id)) ids.push(id);
    }
    encounter.mapIds = ids;
    if (ids.length === 0 && Object.keys(encounter.monstersByHeroCount).length > 0) {
      // Some encounters never print a reduction of their map in the text, so
      // there is nothing to match against. Rather than guess by page order —
      // which would be silently wrong sometimes — say so and let the GM pick.
      unresolved.push({
        page: encounter.page,
        reason: `Encounter ${encounter.n}${encounter.part ?? ''} "${encounter.title}" is a fight with no map matched — pick one in the app, or set mapIds by hand`,
      });
    }
  }
  const usedMaps = new Set(prose.encounters.flatMap((e) => e.mapIds ?? []));
  const spare = maps.filter((m) => !usedMaps.has(m.asset.id));
  if (spare.length && prose.encounters.length) {
    unresolved.push({
      page: spare[0]!.asset.page,
      reason: `${spare.length} map${spare.length === 1 ? '' : 's'} not used by any encounter (${spare
        .map((m) => `${m.asset.id} p${m.asset.page}`)
        .join(', ')}) — blank grids and region maps are expected here`,
    });
  }
  log(`  ${prose.encounters.length} encounters, ${usedMaps.size}/${maps.length} maps matched`);

  const kind = /core rules/i.test(info.subject) ? 'core' : 'adventure';
  // The same sections are reachable both ways; ship whichever organisation the
  // book actually has, rather than both. The rulebook has chapters and no
  // encounters; an adventure has encounters and a few pages before the first.
  const front = kind === 'core' ? [] : prose.front;
  const chapters = kind === 'core' ? prose.chapters : [];
  if (kind === 'core') log(`  ${chapters.length} rules chapters`);

  const manifest: Manifest = {
    format: PACK_FORMAT,
    id,
    // "Hero Kids - Adventure - Basement O Rats" -> "Basement O Rats"
    title:
      info.title
        .replace(/^Hero Kids\s*[-–]\s*/i, '')
        .replace(/^(Fantasy\s+)?Adventure\s*[-–]\s*/i, '')
        .replace(/\s*[-–]\s*Printer Friendly$/i, '')
        .trim() || info.title,
    kind,
    generated: new Date().toISOString().slice(0, 10),
    source: { file: path.basename(pdfFile), pages: info.pages },
    front,
    chapters,
    encounters: prose.encounters,
    maps: maps.map((m) => m.asset),
    cards,
    tokens,
    unresolved,
  };

  await writeFile(
    path.join(assetDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  await mkdir(opts.outDir, { recursive: true });
  const packFile = path.join(opts.outDir, `${id}.hkpack`);
  await zipDirectory(assetDir, packFile, manifest);
  log(`  wrote ${path.relative(process.cwd(), packFile)}`);

  return { manifest, packFile };
}

function zipDirectory(dir: string, dest: string, manifest: Manifest): Promise<void> {
  const zip = new yazl.ZipFile();
  zip.addFile(path.join(dir, 'manifest.json'), 'manifest.json');
  for (const asset of [...manifest.maps, ...manifest.cards, ...manifest.tokens]) {
    zip.addFile(path.join(dir, asset.file), asset.file);
  }
  zip.end();
  return new Promise((resolve, reject) => {
    const out = createWriteStream(dest);
    out.on('close', () => resolve());
    out.on('error', reject);
    zip.outputStream.on('error', reject).pipe(out);
  });
}
