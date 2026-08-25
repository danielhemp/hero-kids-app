/**
 * Resolving pack assets to object URLs for the UI.
 *
 * Keys are `${packId}/${file}` so a single map can hold art from several packs
 * at once — heroes generally come from the core pack while the map and monsters
 * come from the adventure.
 */
import { useEffect, useState } from 'react';
import { assetUrl } from './db.ts';

export type AssetUrls = Record<string, string | undefined>;

export function useAssets(keys: (string | undefined)[]): AssetUrls {
  const wanted = keys.filter((k): k is string => Boolean(k));
  const signature = wanted.slice().sort().join('|');
  const [urls, setUrls] = useState<AssetUrls>({});

  useEffect(() => {
    let live = true;
    const missing = wanted.filter((key) => !(key in urls));
    if (missing.length === 0) return;

    void (async () => {
      const resolved: AssetUrls = {};
      for (const key of missing) {
        const slash = key.indexOf('/');
        const packId = key.slice(0, slash);
        const file = key.slice(slash + 1);
        resolved[key] = await assetUrl(packId, file);
      }
      if (live) setUrls((current) => ({ ...current, ...resolved }));
    })();

    return () => {
      live = false;
    };
    // `signature` stands in for the key list; comparing the array itself would
    // re-run on every render because a new array is built each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return urls;
}

export function useAsset(key: string | undefined): string | undefined {
  const urls = useAssets([key]);
  return key ? urls[key] : undefined;
}
