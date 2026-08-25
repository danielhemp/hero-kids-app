/**
 * Reading a .hkpack the GM picked from Files.
 *
 * A pack is a plain zip: manifest.json plus maps/, cards/ and tokens/. We unzip
 * it in the browser rather than on a server because there is no server — and
 * because the contents are copyrighted material that belongs on Daniel's own
 * devices and nowhere else.
 */
import { unzip } from 'fflate';
import { PACK_FORMAT, type Manifest } from '../types.ts';
import { putPack } from './db.ts';

const MIME: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  json: 'application/json',
};

function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => (err ? reject(err) : resolve(files)));
  });
}

export interface ImportResult {
  manifest: Manifest;
  assetCount: number;
}

export async function importPackFile(file: File): Promise<ImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  let entries: Record<string, Uint8Array>;
  try {
    entries = await unzipAsync(bytes);
  } catch {
    throw new Error(`${file.name} is not a readable .hkpack (could not unzip it).`);
  }

  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) {
    throw new Error(`${file.name} has no manifest.json — is it a .hkpack?`);
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
  } catch {
    throw new Error(`${file.name} has a manifest.json that is not valid JSON.`);
  }

  if (manifest.format !== PACK_FORMAT) {
    throw new Error(
      `${manifest.title || file.name} is pack format ${manifest.format}, but this app reads ` +
        `format ${PACK_FORMAT}. Rebuild it with the current hkpack.`,
    );
  }

  const blobs = new Map<string, Blob>();
  const missing: string[] = [];
  for (const asset of [...manifest.maps, ...manifest.cards, ...manifest.tokens]) {
    const data = entries[asset.file];
    if (!data) {
      missing.push(asset.file);
      continue;
    }
    blobs.set(asset.file, new Blob([data as BlobPart], { type: mimeFor(asset.file) }));
  }

  if (missing.length) {
    throw new Error(
      `${manifest.title} is missing ${missing.length} file${missing.length === 1 ? '' : 's'} ` +
        `it says it contains (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}).`,
    );
  }

  await putPack(manifest, blobs);
  return { manifest, assetCount: blobs.size };
}
