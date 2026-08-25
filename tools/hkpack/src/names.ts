/**
 * Reading the name off a card.
 *
 * The card sheets have no text layer at all — they are flat images — so the
 * only way to get "Cultist Slinger" out of a card without typing thirty of them
 * by hand is OCR. Every Hero Kids card puts its name on one line directly under
 * the "HERO KIDS" logo, which makes for a small, high-contrast crop.
 *
 * Tesseract is optional: if it is not installed the names come back empty and
 * get filled in by hand in the pack's manifest.json.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const run = promisify(execFile);

let available: boolean | null = null;

export async function ocrAvailable(): Promise<boolean> {
  if (available !== null) return available;
  try {
    await run('tesseract', ['--version']);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

/** The band of the card that holds the name, as fractions of width/height. */
const NAME_BAND = { top: 0.155, height: 0.085, left: 0.15, width: 0.54 };

/**
 * Hero cards print the name followed by a colon and a long rule for writing the
 * kid's name on. Tesseract reads that trailing punctuation as a letter — which
 * is where "Warriors" and "Hunters" came from — so trim a trailing plural when
 * what precedes it is otherwise a clean word.
 */
function unpluralise(name: string): string {
  const singular = name.replace(/s$/, '');
  return /^(warrior|hunter|healer|knight|rogue|brute|warlock|scout|ranger|druid|bard|monk)$/i.test(
    singular,
  )
    ? singular
    : name;
}

export async function readCardName(file: string): Promise<string> {
  if (!(await ocrAvailable())) return '';

  const dir = await mkdtemp(path.join(tmpdir(), 'hkocr-'));
  try {
    const meta = await sharp(file).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return '';

    const crop = path.join(dir, 'name.png');
    await sharp(file)
      .flatten({ background: '#ffffff' })
      .extract({
        left: Math.round(w * NAME_BAND.left),
        top: Math.round(h * NAME_BAND.top),
        width: Math.round(w * NAME_BAND.width),
        height: Math.round(h * NAME_BAND.height),
      })
      // The cards are printed on a mottled parchment texture; greyscale plus a
      // hard threshold gives tesseract clean black type on white.
      .greyscale()
      .normalise()
      .threshold(160)
      .resize({ width: 1400 })
      .png()
      .toFile(crop);

    // --psm 7: treat the image as a single line of text.
    const { stdout } = await run('tesseract', [crop, 'stdout', '--psm', '7'], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return tidyName(stdout);
  } catch {
    return '';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function tidyName(raw: string): string {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .find((l) => /[A-Za-z]{3}/.test(l));
  if (!line) return '';

  // Card borders and the dice-pool boxes bleed into the crop, so tesseract
  // often brackets the name with junk: "- Cultist Slinger", "Dragon Warrior ee".
  const words = line
    .replace(/[^A-Za-z'’\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (words.length && !/^[A-Za-z]{3}/.test(words[0]!)) words.shift();
  while (words.length && !/^[A-Za-z]{3}/.test(words[words.length - 1]!)) words.pop();
  const cleaned = words.join(' ');

  // "HERO KIDS" itself, or an empty name line on a blank card.
  if (!cleaned || /^hero\s*kids$/i.test(cleaned)) return '';
  if (cleaned.length < 3 || cleaned.length > 40) return '';

  return cleaned
    .split(' ')
    .map((w) => (w.length > 2 ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .map(unpluralise)
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());
}
