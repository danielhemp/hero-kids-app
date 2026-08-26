/**
 * Where the book says to put things.
 *
 * Every encounter prints its map twice. The small copy beside the text is the
 * GM's: it carries numbered circles for the monsters and a lettered circle for
 * where the heroes come in. The full-page copy at the back is the players' —
 * the same artwork with the markers left off, because they get printed out and
 * played on.
 *
 * That is the whole trick. The two images are the same picture at different
 * sizes, so scaling one to the other and subtracting leaves exactly the
 * markers and nothing else. No shape detection, no guessing at what a circle
 * looks like on a hand-drawn map.
 *
 * Identifying which circle is which is the second half. The circled digits are
 * stored in the PDF as their own small images, reused wherever the book prints
 * them, so we can match each blob against the book's own artwork rather than
 * reading it with OCR. Their object ids run in the order the digits are first
 * printed — "1 Hero: (1)(2)" before "2 Heroes: (1)(2)(3)" — which is what makes
 * ascending object id mean ascending number.
 *
 * Anything that matches no digit is the hero entry: an H or an I, depending on
 * the book, and we never need to tell those two apart.
 */
import sharp from 'sharp';
import type { Grid } from './types.ts';

export interface Marker {
  /** "1".."8" for a monster position, or "entry" for where the heroes come in */
  label: string;
  /** grid cell, 0-based from the top-left playable square */
  col: number;
  row: number;
  /** how well the glyph matched, 0..1 — carried through so verify can report it */
  score: number;
}

export interface Glyph {
  digit: number;
  /** normalised greyscale, GLYPH×GLYPH, ink high */
  pixels: Float64Array;
}

const GLYPH = 24;

/** Two stored glyphs this alike are the same digit kept at two sizes. */
const DUPLICATE = 0.93;

/** How well a window must correlate with a printed digit to count as one. */
const MATCH = 0.5;

/** How far the difference is grown to join a circle's outline to its digit. */
const DILATE = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How much darker than the players' map a pixel must be to count as marker ink. */
const INK = 30;

/** Marker sizes to search, as a fraction of one printed square. */
const SCALES = [0.85, 0.95, 1, 1.05, 1.15];

/** Load an image as greyscale over white, at a given size. */
async function grey(file: string, width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp(file)
    .flatten({ background: '#ffffff' })
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .greyscale()
    .raw()
    .toBuffer();
  return new Uint8Array(buf.buffer, buf.byteOffset, width * height);
}

/**
 * The pixels inside the circle, and nothing else.
 *
 * Where the book prints markers shoulder to shoulder, a square window centred on
 * one of them catches the arcs of its neighbours, and those arcs are enough to
 * pull the correlation below any threshold that is still safe elsewhere. The
 * marker is a disc, so comparing only the disc ignores whatever is crowding it.
 */
const DISC: number[] = (() => {
  const inside: number[] = [];
  const middle = (GLYPH - 1) / 2;
  for (let y = 0; y < GLYPH; y++) {
    for (let x = 0; x < GLYPH; x++) {
      if (Math.hypot(x - middle, y - middle) <= middle) inside.push(y * GLYPH + x);
    }
  }
  return inside;
})();

/**
 * Reduce a patch to a mean-centred unit vector over the disc, so matching is
 * unaffected by how dark the marker happens to sit against its background.
 */
function normalise(values: Float64Array): Float64Array {
  const out = new Float64Array(DISC.length);
  let mean = 0;
  for (const i of DISC) mean += values[i]!;
  mean /= DISC.length;
  let norm = 0;
  for (let k = 0; k < DISC.length; k++) {
    out[k] = values[DISC[k]!]! - mean;
    norm += out[k]! * out[k]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < out.length; k++) out[k] = out[k]! / norm;
  return out;
}

/**
 * Prepare the book's own circled digits for matching.
 *
 * The digits are numbered by the order the book first prints them — "1 Hero:
 * (1)(2)" comes before "2 Heroes: (1)(2)(3)" — and PDF object ids are handed out
 * in that same order, so ascending id is ascending digit. The catch is that a
 * book can store the same digit twice at two sizes: Basement O Rats keeps a
 * second, smaller 4 for its stand-up minis page. Deduplicate on the artwork
 * rather than the id, or that copy becomes a phantom 9.
 */
export async function readGlyphs(files: { objectId: number; file: string }[]): Promise<Glyph[]> {
  const ordered = [...files].sort((a, b) => a.objectId - b.objectId);
  const glyphs: Glyph[] = [];
  for (const source of ordered) {
    const pixels = await grey(source.file, GLYPH, GLYPH);
    // Ink high, paper low, so the sign convention matches the difference image.
    const shape = normalise(Float64Array.from(pixels, (v) => 255 - v));
    const duplicate = glyphs.some((seen) => {
      let match = 0;
      for (let i = 0; i < shape.length; i++) match += shape[i]! * seen.pixels[i]!;
      return match > DUPLICATE;
    });
    if (duplicate) continue;
    glyphs.push({ digit: glyphs.length + 1, pixels: shape });
  }
  return glyphs;
}

interface Blob {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
}

/** Flood-fill the thresholded difference into connected blobs. */
function blobs(mask: Uint8Array, width: number, height: number): Blob[] {
  const seen = new Uint8Array(width * height);
  const found: Blob[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const blob: Blob = {
      minX: width,
      maxX: 0,
      minY: height,
      maxY: 0,
      count: 0,
    };
    while (stack.length) {
      const at = stack.pop()!;
      const x = at % width;
      const y = (at - x) / width;
      blob.count++;
      if (x < blob.minX) blob.minX = x;
      if (x > blob.maxX) blob.maxX = x;
      if (y < blob.minY) blob.minY = y;
      if (y > blob.maxY) blob.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    found.push(blob);
  }
  return found;
}

/** Dilate by one cell so a circle's outline and its digit become one blob. */
function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  let current = mask;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!current[y * width + x]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            next[ny * width + nx] = 1;
          }
        }
      }
    }
    current = next;
  }
  return current;
}

export interface DetectOptions {
  /** the GM's copy: the map with the markers printed on it */
  thumbnail: string;
  /** the players' copy: the same map without them */
  map: string;
  /** the full map's pixel size, which is the coordinate space the app uses */
  width: number;
  height: number;
  grid: Grid;
  glyphs: Glyph[];
  /** for the preview: write the difference image here */
  debugFile?: string;
}

export async function detectMarkers(opts: DetectOptions): Promise<Marker[]> {
  const { grid, glyphs } = opts;
  const cellW = (opts.width - grid.inset.left - grid.inset.right) / grid.cols;
  const cellH = (opts.height - grid.inset.top - grid.inset.bottom) / grid.rows;

  // Work at the thumbnail's own resolution: it is the smaller of the two, and
  // upsampling it would only invent detail the difference would then find.
  const meta = await sharp(opts.thumbnail).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return [];

  // The two images must be the same crop for the subtraction to mean anything.
  // They always have been in the books we have, but a mismatched aspect ratio
  // would turn every wall into a false marker, so refuse rather than guess.
  const aspectGap = Math.abs(w / h - opts.width / opts.height) / (opts.width / opts.height);
  if (aspectGap > 0.02) return [];

  const gm = await grey(opts.thumbnail, w, h);
  const plain = await grey(opts.map, w, h);

  const scale = opts.width / w;
  const markerPx = Math.min(cellW, cellH) / scale;

  // The difference itself is what we match against, not the GM's map: the
  // markers come out on a blank field, with the walls and barrels that sit
  // under them subtracted away.
  const ink = new Float64Array(w * h);
  const diff = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) {
    const value = plain[i]! - gm[i]!;
    ink[i] = value > 0 ? value : 0;
    diff[i] = value > INK ? 1 : 0;
  }

  const grown = dilate(diff, w, h, DILATE);
  if (opts.debugFile) {
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = 255 - Math.min(255, ink[i]! * 2);
    await sharp(Buffer.from(out), { raw: { width: w, height: h, channels: 1 } })
      .png()
      .toFile(opts.debugFile);
  }
  const found = blobs(grown, w, h).filter((b) => {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    // A marker is about one square across. Smaller is resampling noise along a
    // wall; much larger is a run of them printed shoulder to shoulder, which
    // the books do — Encounter 2 of Basement O Rats prints 2, 4 and 6 in a row.
    if (process.env.HKPACK_DEBUG) {
      process.stdout.write(`      blob ${bw}x${bh} at ${b.minX},${b.minY} count ${b.count} (markerPx ${markerPx.toFixed(0)})\n`);
    }
    return (
      Math.min(bw, bh) > markerPx * 0.5 &&
      bw < markerPx * 6 &&
      bh < markerPx * 6 &&
      b.count > markerPx * markerPx * 0.2
    );
  });

  /**
   * Correlate the window at (x, y, side) against every digit.
   *
   * The size has to be searched, not assumed: where the book prints circles
   * shoulder to shoulder it draws them smaller to fit — Encounter 2 sets 2, 4
   * and 6 in a row at about two thirds the size of the ones with room around
   * them.
   */
  const readAt = (x: number, y: number, side: number) => {
    const sample = new Float64Array(GLYPH * GLYPH);
    for (let gy = 0; gy < GLYPH; gy++) {
      for (let gx = 0; gx < GLYPH; gx++) {
        const sx = x + Math.floor((gx + 0.5) * (side / GLYPH));
        const sy = y + Math.floor((gy + 0.5) * (side / GLYPH));
        sample[gy * GLYPH + gx] = sx >= 0 && sy >= 0 && sx < w && sy < h ? ink[sy * w + sx]! : 0;
      }
    }
    const probe = normalise(sample);
    const scores = new Float64Array(glyphs.length);
    let best = -1;
    for (const [i, glyph] of glyphs.entries()) {
      let score = 0;
      for (let k = 0; k < probe.length; k++) score += probe[k]! * glyph.pixels[k]!;
      scores[i] = score;
      if (score > best) best = score;
    }
    return { best, scores };
  };

  const markers: Marker[] = [];
  const toCell = (px: number, py: number) => ({
    col: Math.floor((px * scale - grid.inset.left) / cellW),
    row: Math.floor((py * scale - grid.inset.top) / cellH),
  });

  /**
   * Slide a window of one size across a blob and keep the clearest reading of
   * each cluster of hits.
   */
  interface Peak {
    x: number;
    y: number;
    side: number;
    best: number;
    scores: Float64Array;
  }

  const search = (b: Blob, side: number, floor: number): Peak[] => {
    const stride = Math.max(2, Math.round(side / 12));
    const peaks: Peak[] = [];
    // Sweep window *centres* over the blob, not top-left corners over its box:
    // a blob smaller than the window has no valid top-left corner inside its own
    // bounding box, so a corner sweep silently skips it — which is exactly what
    // happens to a circle the threshold has nibbled at the edges.
    const reach = side * 0.6;
    for (let cy = b.minY - reach; cy <= b.maxY + reach; cy += stride) {
      for (let cx = b.minX - reach; cx <= b.maxX + reach; cx += stride) {
        const x = Math.round(cx - side / 2);
        const y = Math.round(cy - side / 2);
        const hit = readAt(x, y, side);
        if (hit.best < floor) continue;
        peaks.push({ x: x + side / 2, y: y + side / 2, side, best: hit.best, scores: hit.scores });
      }
    }
    peaks.sort((p, q) => q.best - p.best);
    const kept: Peak[] = [];
    for (const peak of peaks) {
      if (kept.some((k) => Math.hypot(k.x - peak.x, k.y - peak.y) < side * 0.7)) continue;
      kept.push(peak);
    }
    return kept;
  };

  // One pass over every blob at every plausible size, collecting places that
  // look like a printed marker without yet deciding which one. The book shrinks
  // its markers where several are crowded together, so the printed square is a
  // starting point rather than the answer; comparing only the disc is what
  // makes readings at different sizes comparable.
  const candidates: (Peak & { blob: Blob })[] = [];
  for (const b of found) {
    const perBlob: Peak[] = [];
    for (const factor of SCALES) {
      const side = Math.max(8, Math.round(markerPx * factor));
      if (side > Math.max(b.maxX - b.minX, b.maxY - b.minY) + markerPx) continue;
      perBlob.push(...search(b, side, MATCH));
    }
    perBlob.sort((p, q) => q.best - p.best);
    const kept: Peak[] = [];
    for (const peak of perBlob) {
      if (kept.some((k) => Math.hypot(k.x - peak.x, k.y - peak.y) < Math.min(k.side, peak.side) * 0.7)) {
        continue;
      }
      kept.push(peak);
      candidates.push({ ...peak, blob: b });
      if (process.env.HKPACK_DEBUG) {
        const ranked = [...peak.scores]
          .map((v, i) => `${glyphs[i]!.digit}:${v.toFixed(2)}`)
          .sort((a, c) => Number(c.split(':')[1]) - Number(a.split(':')[1]))
          .slice(0, 3)
          .join(' ');
        process.stdout.write(`      peak ${peak.x.toFixed(0)},${peak.y.toFixed(0)} side ${peak.side} -> ${ranked}\n`);
      }
    }
  }

  // Each digit is printed once per map, so this is an assignment: take the most
  // confident (place, digit) pairing, strike out both, repeat. Deciding each
  // place on its own would let a crowded 4 that reads faintly as a 1 lose to the
  // real 1 and then be dropped, rather than falling through to its own digit.
  const pairs: { at: number; glyph: number; score: number }[] = [];
  for (const [at, candidate] of candidates.entries()) {
    for (const [glyph, score] of candidate.scores.entries()) {
      if (score >= MATCH) pairs.push({ at, glyph, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const takenPlace = new Set<number>();
  const takenGlyph = new Set<number>();
  const explained = new Set<Blob>();
  for (const pair of pairs) {
    if (takenPlace.has(pair.at) || takenGlyph.has(pair.glyph)) continue;
    const candidate = candidates[pair.at]!;
    const at = toCell(candidate.x, candidate.y);
    if (at.col < 0 || at.row < 0 || at.col >= grid.cols || at.row >= grid.rows) continue;
    takenPlace.add(pair.at);
    takenGlyph.add(pair.glyph);
    explained.add(candidate.blob);
    markers.push({ label: String(glyphs[pair.glyph]!.digit), ...at, score: pair.score });
  }

  for (const b of found) {
    if (explained.has(b)) continue;
    // Nothing here reads as a digit, so it is the hero entry — the one marker
    // whose glyph we never learned, because the book only prints it on maps.
    const at = toCell((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    if (at.col < 0 || at.row < 0 || at.col >= grid.cols || at.row >= grid.rows) continue;
    markers.push({ label: 'entry', ...at, score: 0 });
  }

  // Two readings on one square are one marker read twice; the book never prints
  // two numbers in the same square, because nothing could stand on both.
  const occupied = new Map<string, Marker>();
  for (const marker of markers.filter((m) => m.label !== 'entry')) {
    const key = `${marker.col},${marker.row}`;
    const sitting = occupied.get(key);
    if (!sitting || marker.score > sitting.score) occupied.set(key, marker);
  }

  // One printed marker can leave two blobs — the hero circle is drawn larger
  // than the rest and its letter often separates from its ring — so entries that
  // share a square or sit next to each other are one entry.
  const entries: Marker[] = [];
  for (const marker of markers) {
    if (marker.label !== 'entry') continue;
    if (entries.some((e) => Math.abs(e.col - marker.col) <= 1 && Math.abs(e.row - marker.row) <= 1)) {
      continue;
    }
    entries.push(marker);
  }

  return [
    ...[...occupied.values()].sort((a, b) => Number(a.label) - Number(b.label)),
    ...entries,
  ];
}
