/**
 * Setting an encounter up on the board.
 *
 * Hero Kids prints numbered circles on the GM's copy of each map for where the
 * monsters start, and a lettered circle for where the heroes come in. hkpack
 * reads those off the page, so a fight lays itself out the way the book drew it:
 * the first monster in the roster on circle 1, the second on circle 2, and the
 * party on and around the entry.
 *
 * When a map has no markers — the extractor could not match its two printed
 * copies, or the encounter genuinely has none — everything falls back to a row
 * along an edge for the GM to drag into place.
 */
import type { Encounter, Manifest, Party, Token } from '../types.ts';
import { firstFreeCell } from '../board/geometry.ts';
import type { MapAsset } from '../types.ts';
import { artLookup, defaultPairing, findCard } from './pairing.ts';

let counter = 0;
export function tokenId(): string {
  counter += 1;
  return `t${Date.now().toString(36)}${counter.toString(36)}`;
}

/**
 * The roster scales with the number of heroes. If the book has no line for this
 * party size — some encounters only print "1-4 Heroes" or skip a size — take
 * the closest one rather than showing an empty fight.
 */
export function rosterFor(encounter: Encounter, partySize: number) {
  const table = encounter.monstersByHeroCount;
  const exact = table[String(partySize)];
  if (exact) return exact;

  const sizes = Object.keys(table)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => Math.abs(a - partySize) - Math.abs(b - partySize));
  const nearest = sizes[0];
  return nearest === undefined ? [] : (table[String(nearest)] ?? []);
}

export interface StageOptions {
  manifest: Manifest;
  encounter: Encounter;
  map: MapAsset;
  party: Party;
  /** art overrides the GM has chosen, keyed by monster name */
  artByName?: Record<string, string>;
}

export function stageEncounter({ manifest, encounter, map, party, artByName }: StageOptions): Token[] {
  const pairing = defaultPairing(manifest);
  const art = artLookup(manifest, pairing);
  const tokens: Token[] = [];
  const taken = new Set<string>();

  // The numbered circles, in printed order. The book numbers them in the order
  // its roster lists the monsters — the King Rat is 1 and his giant rats follow
  // — which is the same order the health boxes are printed in.
  const circles = (map.markers ?? [])
    .filter((m) => /^\d+$/.test(m.label))
    .sort((a, b) => Number(a.label) - Number(b.label));
  const entries = (map.markers ?? []).filter((m) => m.label === 'entry');

  // Monsters across the top, heroes across the bottom, for maps with no markers.
  // Staged one row in from the edge so a standee's figure — which stands up out
  // of its square — sits on the map instead of hanging off it.
  const topRow = map.grid.rows > 4 ? 1 : 0;
  const bottomRow = map.grid.rows - 1;
  let cursor = { col: 0, row: topRow };
  let circle = 0;
  for (const group of rosterFor(encounter, party.heroes.length || 1)) {
    const card = findCard(pairing.monsterCards, group.name);
    const file = artByName?.[group.name] ?? (card ? art.fileForCard(card.id) : undefined);

    for (let i = 0; i < group.count; i++) {
      const printed = circles[circle++];
      const at =
        printed && !taken.has(`${printed.col},${printed.row}`)
          ? { col: printed.col, row: printed.row }
          : firstFreeCell(map, taken, cursor, 1);
      taken.add(`${at.col},${at.row}`);
      if (!printed) cursor = { col: at.col + 1, row: at.row };
      tokens.push({
        id: tokenId(),
        side: 'monster',
        name: group.count > 1 ? `${group.name} ${i + 1}` : group.name,
        packId: manifest.id,
        art: file,
        cardId: card?.id,
        col: at.col,
        row: at.row,
        health: 0,
        hidden: false,
      });
    }
  }

  // The heroes arrive together at the entry the book marked, spreading out from
  // it: one square holds one hero, and a party of four needs four.
  cursor = entries[0] ? { col: entries[0].col, row: entries[0].row } : { col: 0, row: bottomRow };
  for (const hero of party.heroes) {
    const at = entries[0]
      ? nearestFree(map, taken, cursor)
      : firstFreeCell(map, taken, cursor, -1);
    taken.add(`${at.col},${at.row}`);
    if (!entries[0]) cursor = { col: at.col + 1, row: at.row };
    tokens.push({
      id: tokenId(),
      side: 'hero',
      name: hero.name,
      packId: hero.packId,
      art: hero.art,
      cardId: hero.cardId,
      col: at.col,
      row: at.row,
      health: 0,
      hidden: false,
    });
  }

  return tokens;
}

/**
 * The free square closest to a point, so a party lands in a huddle around the
 * entry rather than in a line off the edge of it.
 */
function nearestFree(map: MapAsset, taken: Set<string>, at: { col: number; row: number }) {
  let best: { col: number; row: number } | undefined;
  let bestDistance = Infinity;
  for (let row = 0; row < map.grid.rows; row++) {
    for (let col = 0; col < map.grid.cols; col++) {
      if (taken.has(`${col},${row}`)) continue;
      const distance = Math.hypot(col - at.col, row - at.row);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { col, row };
      }
    }
  }
  return best ?? at;
}

/** Somewhere sensible to drop a token added in the middle of a fight. */
export function spawnCell(map: MapAsset, tokens: Token[], side: 'hero' | 'monster') {
  const taken = new Set(tokens.map((t) => `${t.col},${t.row}`));
  return firstFreeCell(
    map,
    taken,
    side === 'monster'
      ? { col: 0, row: map.grid.rows > 4 ? 1 : 0 }
      : { col: 0, row: map.grid.rows - 1 },
    side === 'monster' ? 1 : -1,
  );
}
