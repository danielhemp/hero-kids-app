/**
 * The .hkpack manifest, as written by tools/hkpack.
 *
 * Kept in step with tools/hkpack/src/types.ts by hand — the two are separate
 * npm projects and a shared package would be more machinery than one small
 * interface is worth. `format` guards against drift: bump it there and the app
 * refuses the pack rather than misreading it.
 */

export const PACK_FORMAT = 6;

export type PackKind = 'core' | 'adventure';

export interface Grid {
  cols: number;
  rows: number;
  inset: { top: number; right: number; bottom: number; left: number };
  calibrated: boolean;
}

/**
 * A position the book printed on the GM's copy of the map: a numbered circle for
 * a monster, or the lettered circle where the heroes come in.
 */
export interface Marker {
  /** "1".."8" for a monster position, or "entry" for where the heroes come in */
  label: string;
  col: number;
  row: number;
}

export interface MapAsset {
  id: string;
  file: string;
  width: number;
  height: number;
  ppi: number;
  grid: Grid;
  page: number;
  label: string;
  /** where the book says to put things, read off the GM's copy of this map */
  markers: Marker[];
}

export type CardKind = 'hero' | 'monster' | 'unknown';

export interface CardAsset {
  id: string;
  file: string;
  kind: CardKind;
  name: string;
  width: number;
  height: number;
  page: number;
  tokenId?: string;
}

export interface TokenAsset {
  id: string;
  file: string;
  name: string;
  width: number;
  height: number;
  page: number;
}

export interface MonsterGroup {
  name: string;
  count: number;
}

/**
 * One printed section of an encounter — "Role-Playing", "Encounter Features",
 * "Conclusion" — in the order the book prints them. Whole sections used to be
 * dropped by the extractor, which left the pure conversation scenes almost
 * empty; everything is kept now and the app decides what to show.
 */
export interface Section {
  key: string;
  title: string;
  body?: string;
  readAloud: string[];
}

/** "South to Encounter 4: A Momentary Detour" — a branch the players choose. */
export interface EncounterLink {
  to: string;
  label: string;
}

export interface Encounter {
  n: number;
  part?: string;
  title: string;
  page: number;
  kind: 'combat' | 'scene';
  mapIds?: string[];
  sections: Section[];
  links: EncounterLink[];
  monstersByHeroCount: Record<string, MonsterGroup[]>;
}

/**
 * One chapter of the rulebook — "Rolling for Stuff", "Health and Damage" — with
 * the sub-headed parts printed under it. Adventures have none: their prose is
 * organised by encounter, and what comes before Encounter 1 is `front`.
 */
export interface Chapter {
  key: string;
  title: string;
  page: number;
  sections: Section[];
}

export interface Manifest {
  format: number;
  id: string;
  title: string;
  kind: PackKind;
  generated: string;
  source: { file: string; pages: number };
  /** the adventure's own front matter — overview, background, the hook */
  front: Section[];
  /** the rulebook's chapters, for a core pack; empty for an adventure */
  chapters: Chapter[];
  encounters: Encounter[];
  maps: MapAsset[];
  cards: CardAsset[];
  tokens: TokenAsset[];
  unresolved: { page: number; reason: string }[];
}

/** Stable key for an encounter within a pack: "4a", "11". */
export function encounterKey(e: Encounter): string {
  return `${e.n}${e.part ?? ''}`;
}

/** Where the adventure's own opening pages live, alongside the numbered encounters. */
export const FRONT_KEY = 'front';

/**
 * The pages before Encounter 1 — the background, the overview, and the boxed
 * text that opens the evening — presented as a scene you walk into like any
 * other. Encounter 1 of Basement O Rats literally begins "Following the
 * adventure intro…", so this is not optional colour: without it the first thing
 * the app says to the table refers back to something it never said.
 *
 * The book prints these pages with no encounter number, hence `n: 0`, which the
 * scene screen reads as "no number to show".
 */
export function frontMatter(pack: Manifest): Encounter | undefined {
  if (!pack.front?.length) return undefined;
  const first = pack.encounters[0];
  return {
    n: 0,
    title: 'Before you begin',
    page: 1,
    kind: 'scene',
    sections: pack.front,
    links: first
      ? [{ to: encounterKey(first), label: `Begin — ${encounterKey(first)}. ${first.title}` }]
      : [],
    monstersByHeroCount: {},
  };
}

// --- board state ------------------------------------------------------------

/** Mirrors the printed health boxes: OK, Bruised, Hurt, KO'd. */
export type Health = 0 | 1 | 2 | 3;

export const HEALTH_LABELS: Record<Health, string> = {
  0: 'OK',
  1: 'Bruised',
  2: 'Hurt',
  3: "KO'd",
};

export interface Token {
  id: string;
  side: 'hero' | 'monster';
  name: string;
  /** which pack the art comes from — heroes usually come from the core pack */
  packId: string;
  /** token art file within that pack, if we have any */
  art?: string;
  /** card to show when this token is tapped */
  cardId?: string;
  col: number;
  row: number;
  health: Health;
  /** placed by the GM but not yet revealed to the player screen */
  hidden: boolean;
}

export interface Party {
  /** heroes the kids are playing, in seating order */
  heroes: { id: string; name: string; packId: string; cardId?: string; art?: string }[];
}

export interface BoardState {
  /** where the party is in the adventure — moves without disturbing the board */
  position?: { packId: string; encounter: string };
  /** the fight currently laid out; unchanged while a conversation plays out, so
   *  the table iPad keeps showing the last map rather than going blank */
  packId?: string;
  encounter?: string;
  mapId?: string;
  tokens: Token[];
}
