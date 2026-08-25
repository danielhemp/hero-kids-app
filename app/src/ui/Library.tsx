/**
 * Picking what to play: installed packs, then an adventure's encounters.
 */
import { useRef, useState } from 'react';
import type React from 'react';
import type { Encounter, Manifest } from '../types.ts';
import { encounterKey } from '../types.ts';
import { importPackFile } from '../store/importPack.ts';
import { rosterFor } from '../store/stage.ts';
import { useAsset } from '../store/useAssets.ts';

interface Props {
  packs: Manifest[];
  partySize: number;
  link: React.ReactNode;
  onOpenPairing: () => void;
  onImported: () => void;
  onOpenParty: () => void;
  onPlay: (pack: Manifest, encounter: Encounter) => void;
  onDeletePack: (packId: string) => void;
}

export function Library({ packs, partySize, link, onOpenPairing, onImported, onOpenParty, onPlay, onDeletePack }: Props) {
  const [openPackId, setOpenPackId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const adventures = packs.filter((p) => p.kind === 'adventure');
  // Fall back to the first adventure rather than seeding state from `packs`:
  // the list arrives from IndexedDB after the first render, and a useState
  // initialiser would have captured the empty list forever.
  const openPack = packs.find((p) => p.id === openPackId) ?? adventures[0];

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(undefined);
    try {
      for (const file of Array.from(files)) await importPackFile(file);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="library">
      <header className="library__head">
        <h1>Hero Kids</h1>
        <div className="library__actions">
          <button type="button" className="btn btn--quiet" onClick={onOpenPairing}>
            {link}
          </button>
          <button type="button" className="btn" onClick={onOpenParty}>
            Party ({partySize})
          </button>
          <button type="button" className="btn btn--primary" onClick={() => fileInput.current?.click()} disabled={busy}>
            {busy ? 'Importing…' : 'Add pack'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".hkpack,application/zip"
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {packs.length === 0 ? (
        <div className="empty">
          <h2>No content yet</h2>
          <p>
            Build packs from your Hero Kids PDFs with <code>hkpack</code>, then add the{' '}
            <code>.hkpack</code> files here. They stay on this iPad.
          </p>
        </div>
      ) : (
        <>
          <nav className="library__tabs">
            {adventures.map((pack) => (
              <button
                key={pack.id}
                type="button"
                className={`tab ${pack.id === openPack?.id ? "is-active" : ""}`}
                onClick={() => setOpenPackId(pack.id)}
              >
                {pack.title}
              </button>
            ))}
          </nav>

          {openPack && (
            <ul className="encounters">
              {openPack.encounters.map((encounter) => (
                <EncounterRow
                  key={encounterKey(encounter)}
                  pack={openPack}
                  encounter={encounter}
                  partySize={partySize}
                  onPlay={() => onPlay(openPack, encounter)}
                />
              ))}
            </ul>
          )}

          <details className="library__packs">
            <summary>Installed packs</summary>
            <ul>
              {packs.map((pack) => (
                <li key={pack.id}>
                  <span>
                    <b>{pack.title}</b> <small>{pack.kind}</small>
                    <small>
                      {' '}
                      · {pack.maps.length} maps · {pack.cards.length} cards · {pack.tokens.length} minis
                    </small>
                  </span>
                  <button type="button" className="btn btn--quiet" onClick={() => onDeletePack(pack.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

function EncounterRow({
  pack,
  encounter,
  partySize,
  onPlay,
}: {
  pack: Manifest;
  encounter: Encounter;
  partySize: number;
  onPlay: () => void;
}) {
  const mapId = encounter.mapIds?.[0];
  const map = pack.maps.find((m) => m.id === mapId);
  const thumb = useAsset(map ? `${pack.id}/${map.file}` : undefined);
  const roster = rosterFor(encounter, partySize);

  return (
    <li className="encounters__row">
      <button type="button" className="encounters__button" onClick={onPlay}>
        <span className="encounters__thumb">
          {thumb ? <img src={thumb} alt="" /> : <span className="encounters__noMap">no map</span>}
        </span>
        <span className="encounters__text">
          <b>
            {encounter.n}
            {encounter.part ?? ''}. {encounter.title}
          </b>
          <small>
            {roster.length
              ? roster.map((g) => `${g.count} × ${g.name}`).join(', ')
              : 'role-playing — no monsters'}
          </small>
        </span>
      </button>
    </li>
  );
}
