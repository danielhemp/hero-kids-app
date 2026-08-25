/**
 * On-device storage.
 *
 * Content packs are imported from a file the GM picks and live in IndexedDB
 * from then on: nothing Hero Kids ships inside the app, and nothing leaves the
 * iPad. Assets are stored as Blobs and handed to the UI as object URLs, which
 * keeps the big map images out of JS memory until something actually shows one.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { PACK_FORMAT, type Manifest, type Party } from '../types.ts';
import type { LogState } from '../sync/oplog.ts';

interface HeroKidsDB extends DBSchema {
  packs: {
    key: string;
    value: { id: string; manifest: Manifest; installedAt: number };
  };
  assets: {
    key: string; // `${packId}/${file}`
    value: { key: string; packId: string; blob: Blob };
    indexes: { byPack: string };
  };
  state: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<HeroKidsDB>> | null = null;

function db() {
  dbPromise ??= openDB<HeroKidsDB>('hero-kids', 1, {
    upgrade(database) {
      database.createObjectStore('packs', { keyPath: 'id' });
      const assets = database.createObjectStore('assets', { keyPath: 'key' });
      assets.createIndex('byPack', 'packId');
      database.createObjectStore('state');
    },
  });
  return dbPromise;
}

export async function putPack(manifest: Manifest, files: Map<string, Blob>): Promise<void> {
  const database = await db();
  const tx = database.transaction(['packs', 'assets'], 'readwrite');
  await tx.objectStore('packs').put({ id: manifest.id, manifest, installedAt: Date.now() });
  const assets = tx.objectStore('assets');
  for (const [file, blob] of files) {
    await assets.put({ key: `${manifest.id}/${file}`, packId: manifest.id, blob });
  }
  await tx.done;
}

export interface InstalledPacks {
  packs: Manifest[];
  /** installed, but built by a version of hkpack this app cannot read */
  stale: { id: string; title: string; format: number }[];
}

/**
 * Packs already in IndexedDB are checked on the way out, not just on import.
 * Bumping the pack format used to protect new imports while leaving whatever was
 * already stored to be read with the wrong shape — which crashed the app to a
 * blank screen the first time an old pack's encounter was opened.
 */
export async function listPacks(): Promise<InstalledPacks> {
  const database = await db();
  const rows = await database.getAll('packs');
  const sorted = rows.sort(
    (a, b) => a.manifest.kind.localeCompare(b.manifest.kind) || a.installedAt - b.installedAt,
  );

  const packs: Manifest[] = [];
  const stale: InstalledPacks['stale'] = [];
  for (const row of sorted) {
    if (row.manifest.format === PACK_FORMAT) packs.push(row.manifest);
    else stale.push({ id: row.id, title: row.manifest.title, format: row.manifest.format });
  }
  return { packs, stale };
}

export async function deletePack(packId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['packs', 'assets'], 'readwrite');
  await tx.objectStore('packs').delete(packId);
  const index = tx.objectStore('assets').index('byPack');
  for (const key of await index.getAllKeys(packId)) {
    await tx.objectStore('assets').delete(key);
  }
  await tx.done;
}

const urlCache = new Map<string, string>();

/**
 * An object URL for a pack asset, created once and kept. These live for the
 * lifetime of the tab on purpose: the alternative is revoking URLs while an
 * <img> is still using them, which shows up as an image that silently fails to
 * paint after a re-render.
 */
export async function assetUrl(packId: string, file: string): Promise<string | undefined> {
  const key = `${packId}/${file}`;
  const cached = urlCache.get(key);
  if (cached) return cached;

  const database = await db();
  const row = await database.get('assets', key);
  if (!row) return undefined;

  const url = URL.createObjectURL(row.blob);
  urlCache.set(key, url);
  return url;
}

export function forgetAssetUrls(packId: string): void {
  for (const [key, url] of urlCache) {
    if (key.startsWith(`${packId}/`)) {
      URL.revokeObjectURL(url);
      urlCache.delete(key);
    }
  }
}

// --- small pieces of state --------------------------------------------------

async function getState<T>(key: string): Promise<T | undefined> {
  const database = await db();
  return (await database.get('state', key)) as T | undefined;
}

async function setState(key: string, value: unknown): Promise<void> {
  const database = await db();
  await database.put('state', value, key);
}

export const loadParty = () => getState<Party>('party');
export const saveParty = (party: Party) => setState('party', party);

/**
 * The op log, not the board. Storing the edits rather than the picture is what
 * lets a re-paired iPad merge instead of having to pick a winner.
 */
export const loadLog = () => getState<LogState>('log');
export const saveLog = (log: LogState) => setState('log', log);

export const loadRole = () => getState<'gm' | 'player'>('role');
export const saveRole = (role: 'gm' | 'player') => setState('role', role);
