/**
 * The .hkpack manifest schema.
 *
 * A pack is a zip: manifest.json + maps/ + cards/ + tokens/. The app imports it
 * on-device and stores it in IndexedDB; no Hero Kids content is ever bundled
 * into the app itself.
 */

export const PACK_FORMAT = 6;

export type PackKind = 'core' | 'adventure';

/**
 * Where the playable squares sit on a map image.
 *
 * The pitch is measured from the printed ruling (see grid.ts) rather than
 * assumed from the image DPI — Hero Kids squares are not one inch, and the two
 * books we have use different sizes. `inset` is the margin outside the grid,
 * the decorative paper border.
 * The app computes cell size as (width - inset.left - inset.right) / cols, so
 * the grid always spans exactly the area the GM marked.
 */
export interface Grid {
  cols: number;
  rows: number;
  inset: { top: number; right: number; bottom: number; left: number };
  /** true once a human has confirmed or adjusted it in the app */
  calibrated: boolean;
}

/**
 * A position the book printed on the GM's copy of the map: a numbered circle for
 * a monster, or the lettered circle where the heroes come in.
 */
export interface Marker {
  /** "1".."8" for a monster position, or "entry" for where the heroes come in */
  label: string;
  /** grid cell, 0-based from the top-left playable square */
  col: number;
  row: number;
}

export interface MapAsset {
  id: string;
  file: string;
  width: number;
  height: number;
  /** stored DPI of the source image — 1 inch == 1 square */
  ppi: number;
  grid: Grid;
  /** source page, for tracing back to the PDF */
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
  /** read off the card by hand — the card sheets have no text layer */
  name: string;
  width: number;
  height: number;
  page: number;
  /** token art that goes with this card, if we matched one */
  tokenId?: string;
}

export interface TokenAsset {
  id: string;
  file: string;
  /** hand-labelled; defaults to the source page + index */
  name: string;
  width: number;
  height: number;
  page: number;
}

/** "3 Heroes: 5 x Giant Rats" — the roster scales with party size. */
export interface MonsterGroup {
  name: string;
  count: number;
}

/**
 * One printed section of an encounter — "Role-Playing", "Encounter Features",
 * "Conclusion" — kept in the order the book prints them.
 *
 * The first version of this hardcoded four sections and dropped the rest, which
 * quietly threw away every word of the role-playing scenes: in Reign of the
 * Dragon five of the fourteen encounters are pure conversation, and for those
 * the pack ended up holding almost nothing. Keep everything; let the app decide
 * what to show.
 */
export interface Section {
  /** normalised: intro, rolePlaying, features, abilityTests, monsters, tactics, exploration, developments, conclusion, rewards, or the heading slug */
  key: string;
  /** the heading exactly as printed */
  title: string;
  /** body prose, paragraphs separated by blank lines */
  body?: string;
  /** boxed text the GM reads out, in printed order */
  readAloud: string[];
}

/** "South to Encounter 4: A Momentary Detour" — a branch the players choose. */
export interface EncounterLink {
  /** the encounter it points at, as an encounter key: "4a", "11" */
  to: string;
  /** the sentence that offers it, used as the button label */
  label: string;
}

export interface Encounter {
  /** 1-based encounter number as printed */
  n: number;
  /** branching adventures print "Encounter 4a" and "Encounter 4b" */
  part?: string;
  title: string;
  /** source page in the PDF */
  page: number;
  /** a fight, or a scene with no monsters in it */
  kind: 'combat' | 'scene';
  /** maps matched to this encounter; a few battles span two facing maps */
  mapIds?: string[];
  /** every printed section, in order */
  sections: Section[];
  /** where this encounter can lead next */
  links: EncounterLink[];
  /** keyed by hero count: "1", "2", "3", "4" */
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
  /** source page in the PDF, which is also the printed reading order */
  page: number;
  sections: Section[];
}

export interface Manifest {
  format: typeof PACK_FORMAT;
  id: string;
  title: string;
  kind: PackKind;
  /** ISO date the pack was generated */
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
  /** anything the classifier could not place, so it is visible rather than lost */
  unresolved: { page: number; reason: string }[];
}
