/**
 * Working out which stand-up mini goes with which card.
 *
 * The PDFs never say. Cards are flat images with no text layer (hkpack reads
 * their names by OCR) and the minis have no names at all, so nothing links
 * "Cultist Slinger" to a picture of a robed figure.
 *
 * What we do have is print order: Hero Kids lays its cards out in the same order
 * as the stand-up sheets that follow them. Pairing by index gets the heroes
 * exactly right and most of the monsters, so it is a good default — and every
 * token's art can be re-picked in the app when it isn't.
 */
import type { CardAsset, Manifest, TokenAsset } from '../types.ts';

export interface Pairing {
  /** cardId -> tokenId */
  tokenForCard: Map<string, string>;
  heroCards: CardAsset[];
  monsterCards: CardAsset[];
}

function tokensInPrintOrder(manifest: Manifest): TokenAsset[] {
  return [...manifest.tokens].sort((a, b) => a.page - b.page || a.id.localeCompare(b.id));
}

export function defaultPairing(manifest: Manifest): Pairing {
  const heroCards = manifest.cards.filter((c) => c.kind === 'hero');
  const monsterCards = manifest.cards.filter((c) => c.kind === 'monster');
  const tokens = tokensInPrintOrder(manifest);

  const tokenForCard = new Map<string, string>();

  // Hero minis are printed immediately after the hero cards, in the same order,
  // so the first run of tokens belongs to the heroes.
  heroCards.forEach((card, index) => {
    const explicit = card.tokenId;
    const token = explicit ?? tokens[index]?.id;
    if (token) tokenForCard.set(card.id, token);
  });

  monsterCards.forEach((card, index) => {
    const explicit = card.tokenId;
    const token = explicit ?? tokens[heroCards.length + index]?.id;
    if (token) tokenForCard.set(card.id, token);
  });

  return { tokenForCard, heroCards, monsterCards };
}

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/s$/, '');
}

/**
 * Find the card for a monster the encounter text names, e.g. "Giant Rat".
 * Falls back to a loose word-overlap match, because OCR occasionally mangles a
 * name ("Golddragan") and an approximate card beats no card.
 */
export function findCard(cards: CardAsset[], name: string): CardAsset | undefined {
  const wanted = normalise(name);
  if (!wanted) return undefined;

  const exact = cards.find((c) => normalise(c.name) === wanted);
  if (exact) return exact;

  const wantedWords = new Set(wanted.split(' '));
  let best: { card: CardAsset; score: number } | undefined;
  for (const card of cards) {
    const words = new Set(normalise(card.name).split(' '));
    let shared = 0;
    for (const word of wantedWords) if (words.has(word)) shared++;
    const score = shared / Math.max(1, Math.max(wantedWords.size, words.size));
    if (score > 0.5 && (!best || score > best.score)) best = { card, score };
  }
  return best?.card;
}

export interface ArtLookup {
  /** art file for a card, resolving through the pairing */
  fileForCard(cardId: string): string | undefined;
  fileForToken(tokenId: string): string | undefined;
}

export function artLookup(manifest: Manifest, pairing: Pairing): ArtLookup {
  const tokenById = new Map(manifest.tokens.map((t) => [t.id, t]));
  return {
    fileForToken: (tokenId) => tokenById.get(tokenId)?.file,
    fileForCard: (cardId) => {
      const tokenId = pairing.tokenForCard.get(cardId);
      return tokenId ? tokenById.get(tokenId)?.file : undefined;
    },
  };
}
