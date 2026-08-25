/**
 * Reading the adventure text out of the PDF.
 *
 * `pdftotext` alone is not enough: these are two-column pages, and poppler's
 * reading order interleaves the columns, so an "Encounter Intro" heading ends
 * up several paragraphs away from its own text. `pdftohtml -xml` gives us the
 * position *and* the font of every run, which settles both problems:
 *
 *   - column = which half of the page the run starts in
 *   - Salernomi J, ~30pt  -> encounter title
 *   - Baramond BoldItalic -> section heading ("Monsters", "Tactics", ...)
 *   - Baramond Italic     -> boxed read-aloud text, the stuff the GM reads out
 *   - Baramond regular    -> body copy
 *
 * That last one is the whole reason for this approach: the read-aloud boxes are
 * the most valuable text in the book for a GM screen, and italics is the only
 * thing that marks them.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Encounter, MonsterGroup } from './types.ts';

const run = promisify(execFile);

interface FontSpec {
  size: number;
  family: string;
  italic: boolean;
  bold: boolean;
}

interface TextRun {
  page: number;
  top: number;
  left: number;
  text: string;
  font: FontSpec;
}

// "Encounter 5: Rat Den!", and the branching ones: "Encounter 4a: East Forest Road"
const ENCOUNTER_TITLE = /^Encounter\s+(\d+)\s*([a-z])?\s*[:\-–—]?\s*(.*)$/i;

export type BlockKind = 'title' | 'heading' | 'readAloud' | 'body';

export interface Block {
  page: number;
  kind: BlockKind;
  text: string;
}

/**
 * Section headings collapse to a handful of buckets: the books use "Encounter
 * Intro" and "Intro" for the same thing, and "Combat Developments" is where a
 * fight's mid-battle boxed text lives.
 */
const SECTION_KEYS: Record<string, string> = {
  '': 'intro',
  'encounter intro': 'intro',
  intro: 'intro',
  'adventure intro': 'intro',
  map: 'intro',
  'combat map': 'intro',
  'encounter features': 'features',
  features: 'features',
  'ability tests': 'abilityTests',
  monsters: 'monsters',
  tactics: 'tactics',
  'combat developments': 'tactics',
  developments: 'tactics',
  'role-playing': 'rolePlaying',
  conclusion: 'conclusion',
};

const HEADINGS = new Set([
  'encounter intro',
  'intro',
  'map',
  'combat map',
  'encounter features',
  'features',
  'ability tests',
  'monsters',
  'tactics',
  'conclusion',
  'role-playing',
  'developments',
  'combat developments',
  'background',
  'adventure intro',
  'adventure overview',
  'continuing adventures',
  'rewards',
]);

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

/** Justified type leaves double spaces everywhere; squash them. */
function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

async function readRuns(file: string): Promise<{ runs: TextRun[]; pageWidth: number }> {
  const { stdout } = await run('pdftohtml', ['-xml', '-i', '-stdout', file], {
    maxBuffer: 256 * 1024 * 1024,
  });

  const runs: TextRun[] = [];
  let pageWidth = 1188;
  let page = 0;
  // pdftohtml declares each font once, on the first page that uses it, and
  // later pages just reference the id — so this map must not be reset per page.
  const fonts = new Map<string, FontSpec>();

  const lineRe =
    /<page number="(\d+)"[^>]*width="(\d+)"|<fontspec id="(\d+)" size="(\d+)" family="([^"]*)"|<text top="(-?\d+)" left="(-?\d+)"[^>]*font="(\d+)">([\s\S]*?)<\/text>/g;

  for (const m of stdout.matchAll(lineRe)) {
    if (m[1] !== undefined) {
      page = Number(m[1]);
      pageWidth = Number(m[2]);
      continue;
    }
    if (m[3] !== undefined) {
      const family = m[5] ?? '';
      fonts.set(m[3], {
        size: Number(m[4]),
        family,
        italic: /italic/i.test(family),
        bold: /bold/i.test(family),
      });
      continue;
    }
    if (m[6] !== undefined) {
      const font = fonts.get(m[8] ?? '');
      const text = decodeEntities(m[9] ?? '');
      if (!font || !text.trim()) continue;
      runs.push({ page, top: Number(m[6]), left: Number(m[7]), text, font });
    }
  }
  return { runs, pageWidth };
}

interface TypeScale {
  bodySize: number;
  bodyFamily: string;
}

/**
 * The body face is simply whatever is used most; everything else is defined
 * relative to it. Guessing absolute point sizes breaks as soon as a book uses
 * a different display face on its cover.
 */
function measureTypeScale(runs: TextRun[]): TypeScale {
  const weight = new Map<string, number>();
  for (const r of runs) {
    const key = `${r.font.size}|${r.font.family.replace(/,.*$/, '')}`;
    weight.set(key, (weight.get(key) ?? 0) + r.text.length);
  }
  let bestKey = '21|';
  let bestWeight = -1;
  for (const [key, w] of weight) {
    if (w > bestWeight) {
      bestWeight = w;
      bestKey = key;
    }
  }
  const [size, family] = bestKey.split('|');
  return { bodySize: Number(size) || 21, bodyFamily: family ?? '' };
}

function kindOf(run: TextRun, scale: TypeScale): BlockKind | null {
  const size = run.font.size;
  // Running heads and page numbers sit at roughly half body size.
  if (size < scale.bodySize * 0.8) return null;

  const family = run.font.family.replace(/,.*$/, '');
  // Titles are set in the display face at a noticeably larger size. Matching on
  // the text alone would be wrong: body copy is full of cross-references like
  // "South to Encounter 4: A Momentary Detour", which are not headings.
  if (size >= scale.bodySize * 1.3 && family !== scale.bodyFamily) return 'title';

  if (run.font.bold && run.font.italic) return 'heading';
  if (HEADINGS.has(tidy(run.text).toLowerCase())) return 'heading';
  if (run.font.italic) return 'readAloud';
  return 'body';
}

/**
 * Runs in true reading order — left column top to bottom, then right column —
 * merged into blocks of a single kind.
 */
export async function readBlocks(file: string): Promise<Block[]> {
  const { runs, pageWidth } = await readRuns(file);
  const scale = measureTypeScale(runs);

  const byPage = new Map<number, TextRun[]>();
  for (const r of runs) {
    const arr = byPage.get(r.page) ?? [];
    arr.push(r);
    byPage.set(r.page, arr);
  }

  const blocks: Block[] = [];
  // Page 1 is the cover — small-caps display type that parses as word salad.
  for (const page of [...byPage.keys()].filter((p) => p > 1).sort((a, b) => a - b)) {
    const onPage = byPage.get(page)!;
    const mid = pageWidth / 2;
    const ordered = [
      ...onPage.filter((r) => r.left < mid).sort((a, b) => a.top - b.top || a.left - b.left),
      ...onPage.filter((r) => r.left >= mid).sort((a, b) => a.top - b.top || a.left - b.left),
    ];

    let current: Block | null = null;
    for (const r of ordered) {
      const kind = kindOf(r, scale);
      if (!kind) continue;
      const text = tidy(r.text);
      if (!text) continue;
      // Headings and titles are always their own block; body and read-aloud
      // runs are single lines that need joining back into paragraphs.
      if (kind === 'heading' || kind === 'title' || current === null || current.kind !== kind) {
        current = { page, kind, text };
        blocks.push(current);
      } else {
        current.text = `${current.text} ${text}`;
      }
    }
  }
  return blocks;
}

/**
 * Words that can only be starting a new sentence, never continuing a monster's
 * name. Without these, "3 x Cultist Acolytes If the heroes are strong..." reads
 * as a monster called "Cultist Acolytes If The Heroes".
 */
const NOT_A_NAME_WORD = new Set([
  'if', 'you', 'the', 'this', 'these', 'additionally', 'when', 'for', 'use',
  'feel', 'once', 'bring', 'alternatively', 'unless', 'and', 'plus', 'with',
  'they', 'their', 'there', 'all', 'each', 'any', 'note', 'as', 'at', 'in',
  'on', 'to', 'up', 'or', 'but', 'so', 'that', 'then', 'after', 'before',
]);

function cleanMonsterName(raw: string): string {
  const words: string[] = [];
  for (const word of tidy(raw).split(' ')) {
    if (!word) continue;
    if (NOT_A_NAME_WORD.has(word.toLowerCase())) break;
    words.push(word);
    if (words.length >= 4) break;
  }
  return singular(words.join(' '));
}

function parseMonsters(text: string): Record<string, MonsterGroup[]> {
  // "1 Hero: 2 x Giant Rats  2 Heroes: 3 x Giant Rats ..." and, when the
  // roster does not scale, "1-4 Heroes: 1 x Ettin Giant".
  const cut = text.split(/Use these health boxes/i)[0] ?? text;
  const out: Record<string, MonsterGroup[]> = {};
  const parts = [...cut.matchAll(/(\d+)\s*(?:[-–—]\s*(\d+))?\s+Heroe?s?\s*:/gi)];

  for (const [i, m] of parts.entries()) {
    const start = m.index! + m[0].length;
    const end = i + 1 < parts.length ? parts[i + 1]!.index! : cut.length;
    const chunk = cut.slice(start, end);

    const groups: MonsterGroup[] = [];
    for (const g of chunk.matchAll(/(\d+)\s*x\s*([A-Za-z][A-Za-z'’\- ]*)/g)) {
      const name = cleanMonsterName(g[2] ?? '');
      if (name) groups.push({ name, count: Number(g[1]) });
    }
    if (!groups.length) continue;

    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    for (let heroes = from; heroes <= to; heroes++) out[String(heroes)] = groups;
  }
  return out;
}

/** "5 x Giant Rats" is five of a monster called "Giant Rat". */
function singular(name: string): string {
  if (/(ss|ies|us)$/i.test(name)) return name;
  return name.replace(/s$/, '');
}

export interface ParsedProse {
  intro: string;
  encounters: Encounter[];
}

export async function parseProse(file: string): Promise<ParsedProse> {
  const blocks = await readBlocks(file);

  const encounters: Encounter[] = [];
  const introParts: string[] = [];
  let current: Encounter | null = null;
  let section = '';

  for (const block of blocks) {
    if (block.kind === 'title') {
      const m = ENCOUNTER_TITLE.exec(block.text);
      if (m) {
        const part = (m[2] ?? '').toLowerCase();
        current = {
          n: Number(m[1]),
          part: part || undefined,
          title: tidy(m[3] ?? '') || `Encounter ${m[1]}${part}`,
          page: block.page,
          readAloud: [],
          readAloudBySection: {},
          monstersByHeroCount: {},
        };
        encounters.push(current);
        section = '';
        continue;
      }
      // A non-encounter chapter title ends whatever encounter we were in.
      current = null;
      section = '';
      continue;
    }

    if (block.kind === 'heading') {
      section = tidy(block.text).toLowerCase();
      continue;
    }

    if (!current) {
      if (block.kind === 'body' || block.kind === 'readAloud') introParts.push(block.text);
      continue;
    }

    if (block.kind === 'readAloud') {
      const key = SECTION_KEYS[section] ?? section ?? 'intro';
      (current.readAloudBySection[key] ??= []).push(block.text);
      if (key === 'intro') current.readAloud.push(block.text);
      continue;
    }

    switch (section) {
      case 'encounter features':
      case 'features':
        current.features = append(current.features, block.text);
        break;
      case 'ability tests':
        current.abilityTests = append(current.abilityTests, block.text);
        break;
      case 'tactics':
      case 'combat developments':
      case 'developments':
        current.tactics = append(current.tactics, block.text);
        break;
      case 'conclusion':
        current.conclusion = append(current.conclusion, block.text);
        break;
      case 'monsters':
        Object.assign(current.monstersByHeroCount, parseMonsters(block.text));
        break;
      default:
        break;
    }
  }

  return {
    intro: introParts.slice(0, 6).join('\n\n'),
    encounters: encounters.sort((a, b) => a.n - b.n || (a.part ?? '').localeCompare(b.part ?? '')),
  };
}

function append(existing: string | undefined, text: string): string {
  return existing ? `${existing}\n\n${text}` : text;
}
