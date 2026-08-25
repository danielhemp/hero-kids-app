/**
 * The .hkpack manifest schema.
 *
 * A pack is a zip: manifest.json + maps/ + cards/ + tokens/. The app imports it
 * on-device and stores it in IndexedDB; no Hero Kids content is ever bundled
 * into the app itself.
 */

export const PACK_FORMAT = 2;

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

export interface Encounter {
  /** 1-based encounter number as printed */
  n: number;
  /** branching adventures print "Encounter 4a" and "Encounter 4b" */
  part?: string;
  title: string;
  /** source page in the PDF */
  page: number;
  /** maps matched to this encounter; a few battles span two facing maps */
  mapIds?: string[];
  /** boxed text from the encounter's intro — what the GM opens with */
  readAloud: string[];
  /**
   * Every boxed passage, keyed by the section it was printed under ("intro",
   * "conclusion", "tactics"...). The conclusion's text gives away the end of the
   * fight, so it must not sit at the top of a GM screen with the opening text.
   */
  readAloudBySection: Record<string, string[]>;
  features?: string;
  abilityTests?: string;
  tactics?: string;
  conclusion?: string;
  /** keyed by hero count: "1", "2", "3", "4" */
  monstersByHeroCount: Record<string, MonsterGroup[]>;
}

export interface Manifest {
  format: typeof PACK_FORMAT;
  id: string;
  title: string;
  kind: PackKind;
  /** ISO date the pack was generated */
  generated: string;
  source: { file: string; pages: number };
  intro?: string;
  encounters: Encounter[];
  maps: MapAsset[];
  cards: CardAsset[];
  tokens: TokenAsset[];
  /** anything the classifier could not place, so it is visible rather than lost */
  unresolved: { page: number; reason: string }[];
}
