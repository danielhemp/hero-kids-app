/**
 * Finding the printed grid on a battle map.
 *
 * The first version of this assumed Hero Kids prints 1-inch squares, so the
 * image's stored DPI would give the square size directly. It does not: Basement
 * O Rats lands on ~207px squares in a 240dpi image (0.86") and Reign of the
 * Dragon on ~173px in a 200dpi image (0.87"). Both books work out at 12x9
 * squares per map, but neither is a round number of inches, so the grid has to
 * be measured.
 *
 * Measuring it per map is unreliable — cave walls and furniture drown out the
 * faint printed lines on busy maps. What works is measuring every map in the
 * book and taking the median: a book is printed at one scale throughout, so the
 * quiet maps carry the noisy ones. Each map then only has to contribute its own
 * phase, which is a much easier thing to recover than a frequency.
 */
import sharp from 'sharp';
import type { Grid } from './types.ts';

export interface Profiles {
  columns: Float64Array;
  rows: Float64Array;
  width: number;
  height: number;
}

/**
 * Mean darkness down each column and across each row, over the interior of the
 * image only — the decorative torn-paper border is the strongest edge there is
 * and would dominate everything.
 */
export async function readProfiles(file: string): Promise<Profiles> {
  const { data, info } = await sharp(file)
    .flatten({ background: '#ffffff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const x0 = Math.floor(width * 0.03);
  const x1 = Math.ceil(width * 0.97);
  const y0 = Math.floor(height * 0.05);
  const y1 = Math.ceil(height * 0.95);

  const columns = new Float64Array(width);
  const rows = new Float64Array(height);
  const colSamples = y1 - y0;
  const rowSamples = x1 - x0;

  for (let y = y0; y < y1; y++) {
    const base = y * width;
    let rowSum = 0;
    for (let x = x0; x < x1; x++) {
      const dark = 255 - data[base + x]!;
      columns[x]! += dark;
      rowSum += dark;
    }
    rows[y] = rowSum / rowSamples;
  }
  for (let x = x0; x < x1; x++) columns[x]! /= colSamples;

  // Zero the margins so they cannot contribute to the frequency estimate.
  for (let x = 0; x < x0; x++) columns[x] = 0;
  for (let x = x1; x < width; x++) columns[x] = 0;
  for (let y = 0; y < y0; y++) rows[y] = 0;
  for (let y = y1; y < height; y++) rows[y] = 0;

  return { columns, rows, width, height };
}

/** Subtract a moving average: leaves the periodic ruling, drops the artwork. */
function highPass(signal: Float64Array, window: number): Float64Array {
  const w = Math.max(11, Math.round(window) | 1);
  const half = w >> 1;
  const n = signal.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + signal[i]!;

  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    out[i] = signal[i]! - (prefix[hi]! - prefix[lo]!) / (hi - lo);
  }
  // The moving average is meaningless within half a window of either end.
  for (let i = 0; i < w && i < n; i++) out[i] = 0;
  for (let i = Math.max(0, n - w); i < n; i++) out[i] = 0;
  return out;
}

/** One bin of a DFT: how strongly `signal` repeats every `period` samples. */
function bin(signal: Float64Array, period: number): { magnitude: number; phase: number } {
  const k = (2 * Math.PI) / period;
  let cos = 0;
  let sin = 0;
  for (let i = 0; i < signal.length; i++) {
    const v = signal[i]!;
    if (v === 0) continue;
    cos += v * Math.cos(k * i);
    sin += v * Math.sin(k * i);
  }
  return {
    magnitude: Math.hypot(cos, sin) / signal.length,
    phase: Math.atan2(sin, cos),
  };
}

/**
 * The square size that best explains the ruling on both axes at once.
 * Requiring both axes to agree is what stops paper texture winning: texture is
 * isotropic noise, a grid is periodic in x *and* y at the same pitch.
 */
export function estimatePeriod(profiles: Profiles, ppi: number): { period: number; strength: number } {
  const lo = Math.max(40, ppi * 0.5);
  const hi = Math.max(lo + 10, ppi * 1.3);

  let best = { period: ppi, strength: -1 };
  for (let period = lo; period <= hi; period += 0.25) {
    const window = period * 1.5;
    const cols = bin(highPass(profiles.columns, window), period);
    const rows = bin(highPass(profiles.rows, window), period);
    const strength = cols.magnitude * rows.magnitude;
    if (strength > best.strength) best = { period, strength };
  }
  return best;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Where the ruling actually falls on one axis, given the pitch. */
function axisLayout(
  signal: Float64Array,
  length: number,
  period: number,
): { count: number; before: number; after: number } {
  const { phase } = bin(highPass(signal, period * 1.5), period);
  // s[x] peaks where cos(2π(x - x0)/period) peaks, so x0 = phase * period / 2π.
  let origin = (phase * period) / (2 * Math.PI);
  origin -= Math.floor(origin / period) * period;

  const firstIndex = Math.ceil(-origin / period);
  const lastIndex = Math.floor((length - origin) / period);
  const first = origin + firstIndex * period;
  const last = origin + lastIndex * period;

  return { count: Math.max(1, lastIndex - firstIndex), before: first, after: length - last };
}

/**
 * Fallback when the ruling cannot be measured: assume one-inch squares. Wrong
 * for both books we have, but a sane shape for a map to start from, and the
 * app's calibration overlay exists precisely for this case.
 */
export function gridFromDpi(width: number, height: number, ppi: number): Grid {
  const square = ppi > 0 ? ppi : 200;
  const cols = Math.max(1, Math.round(width / square));
  const rows = Math.max(1, Math.round(height / square));
  const spareX = Math.max(0, width - cols * square);
  const spareY = Math.max(0, height - rows * square);
  return {
    cols,
    rows,
    inset: {
      left: Math.round(spareX / 2),
      right: spareX - Math.round(spareX / 2),
      top: Math.round(spareY / 2),
      bottom: spareY - Math.round(spareY / 2),
    },
    calibrated: false,
  };
}

export interface MapMeasurement {
  file: string;
  width: number;
  height: number;
  ppi: number;
  profiles: Profiles;
  period: number;
  strength: number;
}

export async function measureMap(
  file: string,
  width: number,
  height: number,
  ppi: number,
): Promise<MapMeasurement> {
  const profiles = await readProfiles(file);
  const { period, strength } = estimatePeriod(profiles, ppi);
  return { file, width, height, ppi, profiles, period, strength };
}

/**
 * Turn per-map measurements into grids, using the book-wide median pitch. Maps
 * whose own estimate is wildly off the median (usually a region map or a title
 * spread rather than a battle map) keep their own estimate only if it is
 * plausible, otherwise they take the book pitch too.
 */
export interface GridResult {
  grid: Grid;
  /** false when this map's own pitch reading disagreed with the rest of the book */
  agreesWithBook: boolean;
}

export function gridsFromMeasurements(measurements: MapMeasurement[]): {
  bookPeriod: number;
  grids: Map<string, GridResult>;
} {
  const grids = new Map<string, GridResult>();
  if (measurements.length === 0) return { bookPeriod: 0, grids };

  const bookPeriod = median(measurements.map((m) => m.period));

  for (const m of measurements) {
    // Within 12% of the book pitch counts as agreement. Beyond that the map is
    // usually not a battle map at all — a region map or a title spread — and
    // its own reading is noise rather than evidence of a different scale, so we
    // still lay the book's grid on it and flag it for a human to look at.
    const agreesWithBook = Math.abs(m.period - bookPeriod) / bookPeriod <= 0.12;
    const period = bookPeriod;

    const cols = axisLayout(m.profiles.columns, m.width, period);
    const rows = axisLayout(m.profiles.rows, m.height, period);

    const plausible =
      cols.count >= 4 && cols.count <= 40 && rows.count >= 3 && rows.count <= 40;

    grids.set(m.file, {
      agreesWithBook,
      grid: plausible
        ? {
            cols: cols.count,
            rows: rows.count,
            inset: {
              left: Math.max(0, Math.round(cols.before)),
              right: Math.max(0, Math.round(cols.after)),
              top: Math.max(0, Math.round(rows.before)),
              bottom: Math.max(0, Math.round(rows.after)),
            },
            calibrated: false,
          }
        : gridFromDpi(m.width, m.height, m.ppi),
    });
  }
  return { bookPeriod, grids };
}
