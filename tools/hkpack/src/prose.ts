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
import type { Chapter, Encounter, EncounterLink, MonsterGroup, Section } from './types.ts';

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
  width: number;
  height: number;
  text: string;
  font: FontSpec;
}

/**
 * Where the type sits, not where its box starts.
 *
 * The rulebook sets its headings in small caps — "PINT-SIZED HEROES" is a large
 * P, a smaller INT, a large S and so on, each its own run. Bigger glyphs have a
 * smaller `top`, so sorting by `top` deals the letters of one heading out into
 * two interleaved streams and the pack ends up with a section called "EROES".
 * Every run on a printed line shares a baseline whatever its size, so that is
 * what reading order should follow.
 */
const baselineOf = (r: TextRun) => r.top + r.height;
const sameLine = (a: TextRun, b: TextRun) =>
  Math.abs(baselineOf(a) - baselineOf(b)) <= Math.max(3, Math.min(a.height, b.height) * 0.3);

// "Encounter 5: Rat Den!", and the branching ones: "Encounter 4a: East Forest Road"
const ENCOUNTER_TITLE = /^Encounter\s+(\d+)\s*([a-z])?\s*[:\-–—]?\s*(.*)$/i;

export type BlockKind = 'title' | 'heading' | 'readAloud' | 'body';

export interface Block {
  page: number;
  kind: BlockKind;
  text: string;
}

/**
 * Headings normalise to a small set of keys so the app can treat them
 * consistently — the books say both "Encounter Intro" and "Intro" for the same
 * thing, and "Combat Developments" is where a fight's mid-battle text lives.
 * Anything unrecognised keeps a slug of its own heading rather than being
 * dropped: an unknown section is still the GM's text.
 */
const SECTION_KEYS: Record<string, string> = {
  '': 'intro',
  'encounter intro': 'intro',
  intro: 'intro',
  'adventure intro': 'intro',
  'combat intro': 'combatIntro',
  'combat introduction': 'combatIntro',
  map: 'map',
  'combat map': 'map',
  'encounter features': 'features',
  features: 'features',
  'ability tests': 'abilityTests',
  monsters: 'monsters',
  tactics: 'tactics',
  'combat developments': 'developments',
  developments: 'developments',
  development: 'developments',
  'role-playing': 'rolePlaying',
  roleplaying: 'rolePlaying',
  exploration: 'exploration',
  conclusion: 'conclusion',
  rewards: 'rewards',
  background: 'background',
  'adventure overview': 'overview',
  'continuing adventures': 'continuing',
};

function sectionKey(heading: string): string {
  const clean = tidy(heading).toLowerCase();
  return (
    SECTION_KEYS[clean] ??
    clean.replace(/[^a-z0-9]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '')
  );
}

/** Sections that are page furniture rather than something to read at the table. */
const SKIP_SECTIONS = new Set(['map', 'monsters']);

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
    /<page number="(\d+)"[^>]*width="(\d+)"|<fontspec id="(\d+)" size="(\d+)" family="([^"]*)"|<text top="(-?\d+)" left="(-?\d+)" width="(-?\d+)" height="(-?\d+)" font="(\d+)">([\s\S]*?)<\/text>/g;

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
      const font = fonts.get(m[10] ?? '');
      const text = decodeEntities(m[11] ?? '');
      if (!font || !text.trim()) continue;
      runs.push({
        page,
        top: Number(m[6]),
        left: Number(m[7]),
        width: Number(m[8]),
        height: Number(m[9]),
        text,
        font,
      });
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
    const byBaseline = (a: TextRun, b: TextRun) =>
      sameLine(a, b) ? a.left - b.left : baselineOf(a) - baselineOf(b);
    const ordered = [
      ...onPage.filter((r) => r.left < mid).sort(byBaseline),
      ...onPage.filter((r) => r.left >= mid).sort(byBaseline),
    ];

    let current: Block | null = null;
    let previous: TextRun | null = null;
    for (const [index, r] of ordered.entries()) {
      let kind = kindOf(r, scale);
      if (!kind) continue;
      const text = tidy(r.text);
      if (!text) continue;

      // Emphasis does double duty with structure. Italic marks boxed text to read
      // out, but also product names set inline in prose — "requires a copy of the
      // *Hero Kids* RPG". Bold-italic marks section headings, but also place names
      // inside boxed text — the Brecken Vale description mentions *Rivenshore* and
      // the *Camarva River* and used to arrive as six fragments with fake headings
      // between them.
      //
      // What separates the two is the line. A heading owns its line; emphasis has
      // prose beside it — before it, after it, or both — so look in both
      // directions rather than only backwards, because the sentence can just as
      // easily break across a line and leave the emphasised words sitting first.
      const next = ordered[index + 1];
      const prose = current?.kind === 'body' || current?.kind === 'readAloud';
      const continues =
        next !== undefined && sameLine(r, next) && ['body', 'readAloud'].includes(kindOf(next, scale) ?? '');
      const inline =
        prose && text.length < 45 && ((previous !== null && sameLine(previous, r)) || continues);

      if (inline && current) {
        if (kind === 'readAloud' && current.kind === 'body') kind = 'body';
        else if (kind === 'heading') kind = current.kind;
      }

      // Small caps: one printed heading arrives as several runs on one baseline,
      // alternating large and small — "P" "INT" "-S" "IZED" "H" "EROES". The word
      // spaces survive as leading or trailing whitespace on the runs themselves,
      // which is more reliable than measuring the gap between two different sizes.
      if (kind === 'title' && current?.kind === 'title' && previous !== null && sameLine(previous, r)) {
        const spaced =
          /\s$/.test(previous.text) ||
          /^\s/.test(r.text) ||
          r.left - (previous.left + previous.width) > previous.height * 0.5;
        current.text += (spaced ? ' ' : '') + text;
        previous = r;
        continue;
      }

      previous = r;
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
  front: Section[];
  chapters: Chapter[];
  encounters: Encounter[];
}

/**
 * The rulebook prints its chapter titles in small caps and its sub-headings in
 * ordinary title case, both in the display face — so the only thing separating
 * "ROLLING FOR STUFF" from "Attacking and Defending" is the absence of a
 * lower-case letter. That is a thin signal, but it is the one the book uses.
 */
const isChapterTitle = (text: string) => !/[a-z]/.test(text) && tidy(text).length > 2;

/** Page furniture and the card sections, which are pictures rather than rules. */
const SKIP_CHAPTERS = new Set(['contents', 'tableOfContents', 'credits', 'heroes', 'monsters']);

/** "ROLLING FOR STUFF" shouted back at the GM reads badly; the book only shouts
 *  because it is setting small caps, which we cannot reproduce. */
const SMALL_WORDS = new Set(['a', 'and', 'the', 'for', 'of', 'to', 'in', 'or', 'on', 'with']);

function titleCase(text: string): string {
  return tidy(text)
    .toLowerCase()
    .split(' ')
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word) ? word : word.replace(/^[a-z]/, (c) => c.toUpperCase()),
    )
    .join(' ')
    // "Pint-Sized", "Role-Playing" — the book hyphenates and capitalises both halves.
    .replace(/-([a-z])/g, (_, c: string) => `-${c.toUpperCase()}`);
}

/** A cross-reference to another encounter, e.g. "Encounter 4a" or "Encounter 11". */
const ENCOUNTER_REFERENCE = /Encounter\s+(\d+)\s*([a-z])?\b/gi;

/**
 * The branches the book offers at the end of a scene, pulled out of its prose:
 * "South to Encounter 4: A Momentary Detour", "Proceed to Encounter 10: Dragon
 * Prince Battle". The book's own sentence makes the button label, because it
 * has already phrased it better than we could.
 *
 * An encounter can mention another one several times, and only one of those is
 * an instruction — Encounter 9 mentions Encounter 10 twice while describing how
 * the two maps join up, and once at the end to say where to go. So every
 * mention is collected and then scored, rather than taking the first.
 */
const NAVIGATION_CUE =
  /\b(?:proceed|continue|go|head|move|return|onwards?|back)\b[^.]{0,20}\bto\b|^\s*(?:north|south|east|west|up|down)\b|\bnext encounter\b/i;

/** Where an instruction is likely to live, if it lives anywhere. */
const NAVIGATION_SECTIONS = new Set(['conclusion', 'developments', 'rolePlaying', 'exploration']);

function clauseAround(text: string, at: number, length: number): string {
  // Bullets and newlines are boundaries alongside full stops: the books often
  // offer a choice as a bulleted list with no sentence punctuation at all.
  const BOUNDARY = /[.!?•\n]/;
  let from = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (BOUNDARY.test(text[i]!)) {
      from = i + 1;
      break;
    }
  }
  let until = text.length;
  for (let i = at + length; i < text.length; i++) {
    if (BOUNDARY.test(text[i]!)) {
      until = text[i] === '.' || text[i] === '!' ? i + 1 : i;
      break;
    }
  }
  return tidy(text.slice(from, until))
    .replace(/^[•:\s]+/, '')
    // The books space their punctuation loosely, and " ." on a button looks broken.
    .replace(/\s+([.!?,:;])/g, '$1');
}

function findLinks(sections: Section[], self: string, known: Set<string>): EncounterLink[] {
  const candidates = new Map<string, { label: string; score: number }>();

  for (const section of sections) {
    const text = [section.body ?? '', ...section.readAloud].join('\n');
    for (const match of text.matchAll(ENCOUNTER_REFERENCE)) {
      const to = `${match[1]}${(match[2] ?? '').toLowerCase()}`;
      if (to === self || !known.has(to)) continue;

      const label = clauseAround(text, match.index!, match[0].length);
      if (!label || label.length > 120) continue;

      let score = 0;
      if (NAVIGATION_CUE.test(label)) score += 3;
      if (NAVIGATION_SECTIONS.has(section.key)) score += 1;
      // Between two equally-cued sentences, the terser one is the instruction.
      score -= label.length / 500;

      const best = candidates.get(to);
      if (!best || score > best.score) candidates.set(to, { label, score });
    }
  }

  return [...candidates].map(([to, { label }]) => ({ to, label }));
}

function encounterKeyOf(e: { n: number; part?: string }): string {
  return `${e.n}${e.part ?? ''}`;
}

export async function parseProse(file: string): Promise<ParsedProse> {
  const blocks = await readBlocks(file);

  const encounters: Encounter[] = [];
  const front: Section[] = [];
  const chapters: Chapter[] = [];
  let current: Encounter | null = null;
  let chapter: Chapter | null = null;
  let section: Section | null = null;

  /** Start a new section in whichever place we are currently writing. */
  const openSection = (heading: string) => {
    const key = sectionKey(heading);
    section = { key, title: tidy(heading), readAloud: [] };
    if (SKIP_SECTIONS.has(key)) return;
    (current ? current.sections : front).push(section);
    // A rulebook chapter holds the same section objects the flat front matter
    // does; which of the two a pack ships is the writer's decision, not this
    // parser's, and an adventure never grows chapters because its front matter
    // is set in title case rather than small caps.
    if (!current && chapter) chapter.sections.push(section);
  };

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
          kind: 'scene',
          sections: [],
          links: [],
          monstersByHeroCount: {},
        };
        encounters.push(current);
        // The lead paragraph before the first heading is the scene summary.
        openSection('Intro');
        continue;
      }
      // A non-encounter chapter title ends whatever encounter we were in.
      current = null;
      if (isChapterTitle(block.text)) {
        const key = sectionKey(block.text);
        chapter = { key, title: titleCase(block.text), page: block.page, sections: [] };
        if (!SKIP_CHAPTERS.has(key)) chapters.push(chapter);
        // The paragraphs before the first sub-heading are the chapter's opening.
        openSection('Intro');
        continue;
      }
      openSection(block.text);
      continue;
    }

    if (block.kind === 'heading') {
      openSection(block.text);
      continue;
    }

    if (!section) openSection('Intro');

    if (block.kind === 'readAloud') {
      section!.readAloud.push(block.text);
      continue;
    }

    // The monster roster is data, not prose, so it is parsed rather than kept.
    if (section!.key === 'monsters') {
      if (current) Object.assign(current.monstersByHeroCount, parseMonsters(block.text));
      continue;
    }

    section!.body = section!.body ? `${section!.body}\n\n${block.text}` : block.text;
  }

  const known = new Set(encounters.map(encounterKeyOf));
  for (const encounter of encounters) {
    encounter.kind = Object.keys(encounter.monstersByHeroCount).length ? 'combat' : 'scene';
    encounter.sections = encounter.sections.filter((s) => s.body || s.readAloud.length);
    encounter.links = findLinks(encounter.sections, encounterKeyOf(encounter), known);
  }

  for (const c of chapters) c.sections = c.sections.filter((s: Section) => s.body || s.readAloud.length);

  return {
    front: front.filter((s) => s.body || s.readAloud.length),
    // A chapter with nothing under it is a divider page — "HEROES!" above eight
    // pages of cards — rather than something to read.
    chapters: chapters.filter((c) => c.sections.some((s: Section) => (s.body ?? '').length > 120)),
    encounters: encounters.sort((a, b) => a.n - b.n || (a.part ?? '').localeCompare(b.part ?? '')),
  };
}
