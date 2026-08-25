/**
 * The .hkpack manifest, as written by tools/hkpack.
 *
 * Kept in step with tools/hkpack/src/types.ts by hand — the two are separate
 * npm projects and a shared package would be more machinery than one small
 * interface is worth. `format` guards against drift: bump it there and the app
 * refuses the pack rather than misreading it.
 */

export const PACK_FORMAT = 2;

export type PackKind = 'core' | 'adventure';

export interface Grid {
  cols: number;
  rows: number;
  inset: { top: number; right: number; bottom: number; left: number };
  calibrated: boolean;
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

export interface Encounter {
  n: number;
  part?: string;
  title: string;
  page: number;
  mapIds?: string[];
  /** boxed text from the encounter's intro — what the GM opens with */
  readAloud: string[];
  /**
   * Every boxed passage keyed by the section it was printed under. The
   * conclusion's passage spoils the end of the fight, so it belongs inside the
   * Conclusion section rather than at the top of the GM screen.
   */
  readAloudBySection: Record<string, string[]>;
  features?: string;
  abilityTests?: string;
  tactics?: string;
  conclusion?: string;
  monstersByHeroCount: Record<string, MonsterGroup[]>;
}

export interface Manifest {
  format: number;
  id: string;
  title: string;
  kind: PackKind;
  generated: string;
  source: { file: string; pages: number };
  intro?: string;
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
  packId?: string;
  encounter?: string;
  mapId?: string;
  tokens: Token[];
}
