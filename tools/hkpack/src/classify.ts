/**
 * Deciding what each embedded image *is*.
 *
 * Hero Kids PDFs are laid out consistently across the core book and every
 * adventure, and the giveaway is geometry rather than position: a page can mix
 * stand-up minis and monster cards (Reign of the Dragon p55), so we classify
 * per image, not per page.
 *
 *   full-page art, min dimension >= 1200px  -> battle map (1" printed squares)
 *   landscape ~1.42:1, 900-1500px wide      -> hero card (wide) or monster card
 *   portrait  ~1:1.42, 800-1100px tall      -> item card
 *   anything else between 100 and 800px     -> stand-up mini art
 *
 * On prose pages the only thing worth keeping is the small map printed in each
 * encounter's "Map" section, which we later match against the full-page maps
 * to work out which map belongs to which encounter.
 */
import type { ExtractedImage } from './images.ts';

export type ImageRole = 'map' | 'heroCard' | 'monsterCard' | 'itemCard' | 'token' | 'thumbnail' | 'art';

const CARD_ASPECT = 1.42;
const ASPECT_TOLERANCE = 0.08;

function aspectMatches(ratio: number, target: number): boolean {
  return Math.abs(ratio - target) <= ASPECT_TOLERANCE;
}

export interface ClassifiedImage extends ExtractedImage {
  role: ImageRole;
}

export function classifyImage(img: ExtractedImage, pageWords: number): ImageRole {
  const { width, height } = img;
  const landscape = width / height;
  const portrait = height / width;
  const minDim = Math.min(width, height);
  const isProsePage = pageWords > 50;

  // Page 1 is the cover: a full-bleed illustration that would otherwise look
  // exactly like a battle map.
  if (img.page === 1) return 'art';

  if (isProsePage) {
    // The encounter "Map" section prints a reduction of the full-page map from
    // the back of the book. Most are landscape ~946x681, but some encounters
    // get a portrait map, so rather than pin down a size we let anything
    // picture-sized through as a candidate and let the matcher reject it: an
    // illustration simply will not correlate with any map.
    if (minDim >= 400) return 'thumbnail';
    return 'art';
  }

  if (minDim >= 1200) return 'map';

  if (aspectMatches(landscape, CARD_ASPECT) && width >= 900 && width <= 1500) {
    // Hero cards are printed two to a page and are noticeably larger than the
    // four-up monster cards.
    return width >= 1200 ? 'heroCard' : 'monsterCard';
  }

  if (aspectMatches(portrait, CARD_ASPECT) && height >= 800 && height <= 1100) return 'itemCard';

  // A stand-up mini is a cut-out: it always carries a soft mask, and about half
  // its bounding box is transparent. The rectangular pictures on the last page
  // of the core book — adverts for other games — are the same size and would
  // otherwise sail through as minis.
  if (minDim >= 100 && Math.max(width, height) <= 800 && img.hasAlpha) return 'token';

  return 'art';
}

export function classifyAll(
  images: ExtractedImage[],
  wordsByPage: Map<number, number>,
): ClassifiedImage[] {
  return images.map((img) => ({
    ...img,
    role: classifyImage(img, wordsByPage.get(img.page) ?? 0),
  }));
}

/**
 * How much we want a given placement to be the one we keep. A mini's artwork is
 * often reused as a small illustration in the rules text; the placement on the
 * stand-up sheet is the one worth extracting, even when the illustration is
 * printed larger.
 */
const ROLE_PRIORITY: Record<ImageRole, number> = {
  map: 5,
  heroCard: 5,
  monsterCard: 5,
  itemCard: 5,
  token: 4,
  thumbnail: 3,
  art: 0,
};

/**
 * Stand-up minis are printed as fold-over pairs, so the same artwork is placed
 * twice (once mirrored). Same PDF object id == same artwork: keep the most
 * useful placement, breaking ties on resolution.
 */
export function dedupeByObject(images: ClassifiedImage[]): ClassifiedImage[] {
  const best = new Map<number, ClassifiedImage>();
  const kept: ClassifiedImage[] = [];
  for (const img of images) {
    // Cards and maps are printed once each; if the same artwork really does
    // appear twice, that is two cards to cut out, so keep both.
    if (img.role === 'map' || img.role.endsWith('Card')) {
      kept.push(img);
      continue;
    }
    const seen = best.get(img.objectId);
    if (!seen) {
      best.set(img.objectId, img);
      continue;
    }
    const better =
      ROLE_PRIORITY[img.role] !== ROLE_PRIORITY[seen.role]
        ? ROLE_PRIORITY[img.role] > ROLE_PRIORITY[seen.role]
        : img.width * img.height > seen.width * seen.height;
    if (better) best.set(img.objectId, img);
  }
  return [...kept, ...best.values()].sort(
    (a, b) => a.page - b.page || a.objectId - b.objectId || a.num - b.num,
  );
}
