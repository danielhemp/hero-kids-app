/**
 * Setting an encounter up on the board.
 *
 * Hero Kids prints numbered circles on each map for where the monsters start,
 * but those numbers are baked into the map image — nothing in the file says
 * which square is number 3. So rather than guess at positions, everything is
 * staged in a row along an edge: monsters across the top, heroes across the
 * bottom. The GM drags them onto the printed numbers, which takes a few seconds
 * and is never wrong.
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

  // Monsters across the top, heroes across the bottom. Staged one row in from
  // the edge so a standee's figure — which stands up out of its square — sits
  // on the map instead of hanging off it.
  const topRow = map.grid.rows > 4 ? 1 : 0;
  const bottomRow = map.grid.rows - 1;
  let cursor = { col: 0, row: topRow };
  for (const group of rosterFor(encounter, party.heroes.length || 1)) {
    const card = findCard(pairing.monsterCards, group.name);
    const file = artByName?.[group.name] ?? (card ? art.fileForCard(card.id) : undefined);

    for (let i = 0; i < group.count; i++) {
      const at = firstFreeCell(map, taken, cursor, 1);
      taken.add(`${at.col},${at.row}`);
      cursor = { col: at.col + 1, row: at.row };
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

  cursor = { col: 0, row: bottomRow };
  for (const hero of party.heroes) {
    const at = firstFreeCell(map, taken, cursor, -1);
    taken.add(`${at.col},${at.row}`);
    cursor = { col: at.col + 1, row: at.row };
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
