/**
 * Running an encounter: the map on the left, the GM's screen on the right.
 *
 * Nothing here resolves rules. Dice, damage and judgement stay with the people
 * playing — the app's job is to be the map and the minis, plus the text the GM
 * would otherwise be holding the book open to read.
 */
import { useMemo, useState } from 'react';
import type React from 'react';
import { Board } from '../board/Board.tsx';
import type { Encounter, Health, Manifest, MapAsset, Token } from '../types.ts';
import { HEALTH_LABELS } from '../types.ts';
import { defaultPairing, findCard } from '../store/pairing.ts';
import { rosterFor } from '../store/stage.ts';
import { useAsset, useAssets } from '../store/useAssets.ts';
import { Sections } from './Sections.tsx';

export interface PlayHandlers {
  onMove: (tokenId: string, col: number, row: number) => void;
  onHealth: (tokenId: string, health: Health) => void;
  onRemove: (tokenId: string) => void;
  onAdd: (name: string, side: 'hero' | 'monster') => void;
  onToggleHidden: (tokenId: string) => void;
  onSetArt: (tokenId: string, art: string | undefined) => void;
  onChooseMap: (mapId: string) => void;
  onRestage: () => void;
  /** back to the encounter's text, without disturbing the board */
  onBackToScene: () => void;
  onExit: () => void;
}

interface Props extends PlayHandlers {
  link: React.ReactNode;
  onOpenPairing: () => void;
  pack: Manifest;
  encounter: Encounter;
  map: MapAsset;
  tokens: Token[];
  partySize: number;
}

export function PlayScreen(props: Props) {
  const { pack, encounter, map, tokens, partySize } = props;
  const [selectedId, setSelectedId] = useState<string>();
  const [showGrid, setShowGrid] = useState(false);
  const [cardId, setCardId] = useState<string>();
  const [pickingArtFor, setPickingArtFor] = useState<string>();

  const mapUrl = useAsset(`${pack.id}/${map.file}`);
  const artUrls = useAssets(tokens.map((t) => (t.art ? `${t.packId}/${t.art}` : undefined)));

  const selected = tokens.find((t) => t.id === selectedId);
  const roster = useMemo(() => rosterFor(encounter, partySize), [encounter, partySize]);

  return (
    <div className="play">
      <div className="play__board">
        <Board
          map={map}
          mapUrl={mapUrl}
          tokens={tokens}
          artUrls={artUrls}
          selectedId={selectedId}
          showGrid={showGrid}
          onSelect={setSelectedId}
          onMove={props.onMove}
        />

        {selected && (
          <div className="tokenbar">
            <b className="tokenbar__name">{selected.name}</b>

            <div className="tokenbar__health" role="group" aria-label="Health">
              {([0, 1, 2, 3] as Health[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`pip ${selected.health >= level && level > 0 ? 'is-on' : ''} ${
                    selected.health === level ? 'is-current' : ''
                  }`}
                  onClick={() => props.onHealth(selected.id, level)}
                  title={HEALTH_LABELS[level]}
                >
                  {level === 0 ? 'OK' : level === 3 ? 'KO' : level}
                </button>
              ))}
            </div>

            {selected.cardId && (
              <button type="button" className="btn btn--quiet" onClick={() => setCardId(selected.cardId)}>
                Card
              </button>
            )}
            <button type="button" className="btn btn--quiet" onClick={() => setPickingArtFor(selected.id)}>
              Mini
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => props.onToggleHidden(selected.id)}>
              {selected.hidden ? 'Reveal' : 'Hide'}
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                props.onRemove(selected.id);
                setSelectedId(undefined);
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      <aside className="play__panel">
        <header className="panel__head">
          <button type="button" className="btn btn--quiet" onClick={props.onBackToScene}>
            ‹ Scene
          </button>
          <button type="button" className="btn btn--quiet" onClick={props.onOpenPairing}>
            {props.link}
          </button>
          <label className="toggle">
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
            Grid
          </label>
        </header>

        <h2 className="panel__title">
          {encounter.n}
          {encounter.part ?? ''}. {encounter.title}
        </h2>

        <MapChooser pack={pack} encounter={encounter} current={map.id} onChoose={props.onChooseMap} />

        <Sections sections={encounter.sections} lead />

        <h3 className="panel__h3">
          Monsters <small>for {partySize} hero{partySize === 1 ? '' : 'es'}</small>
        </h3>
        {roster.length === 0 ? (
          <p className="muted">No monsters in this encounter.</p>
        ) : (
          <ul className="roster">
            {roster.map((group) => {
              const onBoard = tokens.filter(
                (t) => t.side === 'monster' && t.name.replace(/ \d+$/, '') === group.name,
              ).length;
              return (
                <li key={group.name}>
                  <span>
                    {group.name} <small>{onBoard} of {group.count} on the map</small>
                  </span>
                  <button type="button" className="btn btn--quiet" onClick={() => props.onAdd(group.name, 'monster')}>
                    + Add
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <button type="button" className="btn panel__restage" onClick={props.onRestage}>
          Reset the board
        </button>
        <button type="button" className="btn btn--quiet panel__restage" onClick={props.onExit}>
          Leave the adventure
        </button>
      </aside>

      {cardId && <CardSheet pack={pack} cardId={cardId} onClose={() => setCardId(undefined)} />}
      {pickingArtFor && (
        <MiniPicker
          pack={pack}
          onPick={(file) => {
            props.onSetArt(pickingArtFor, file);
            setPickingArtFor(undefined);
          }}
          onClose={() => setPickingArtFor(undefined)}
        />
      )}
    </div>
  );
}

/**
 * Some encounters never print a small copy of their map, so hkpack has nothing
 * to match and leaves them unassigned. Rather than hide that, let the GM pick
 * from the maps in the pack — it takes one tap and is always right.
 */
function MapChooser({
  pack,
  encounter,
  current,
  onChoose,
}: {
  pack: Manifest;
  encounter: Encounter;
  current: string;
  onChoose: (mapId: string) => void;
}) {
  const matched = encounter.mapIds ?? [];
  const [open, setOpen] = useState(false);
  if (pack.maps.length <= 1) return null;

  return (
    <div className="mapchooser">
      <button type="button" className="btn btn--quiet" onClick={() => setOpen((v) => !v)}>
        {matched.includes(current) ? 'Change map' : 'Pick the map'} ▾
      </button>
      {open && (
        <div className="mapchooser__grid">
          {pack.maps.map((m) => (
            <MapThumb
              key={m.id}
              pack={pack}
              map={m}
              current={m.id === current}
              suggested={matched.includes(m.id)}
              onChoose={() => {
                onChoose(m.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MapThumb({
  pack,
  map,
  current,
  suggested,
  onChoose,
}: {
  pack: Manifest;
  map: MapAsset;
  current: boolean;
  suggested: boolean;
  onChoose: () => void;
}) {
  const url = useAsset(`${pack.id}/${map.file}`);
  return (
    <button
      type="button"
      className={`mapchooser__item ${current ? 'is-current' : ''} ${suggested ? 'is-suggested' : ''}`}
      onClick={onChoose}
    >
      {url && <img src={url} alt="" />}
      <small>
        p{map.page} · {map.grid.cols}×{map.grid.rows}
      </small>
    </button>
  );
}

function CardSheet({ pack, cardId, onClose }: { pack: Manifest; cardId: string; onClose: () => void }) {
  const card = pack.cards.find((c) => c.id === cardId);
  const url = useAsset(card ? `${pack.id}/${card.file}` : undefined);
  if (!card) return null;
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__inner" onClick={(e) => e.stopPropagation()}>
        {url && <img src={url} alt={card.name} />}
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function MiniPicker({
  pack,
  onPick,
  onClose,
}: {
  pack: Manifest;
  onPick: (file: string | undefined) => void;
  onClose: () => void;
}) {
  const packs = [pack];
  const urls = useAssets(packs.flatMap((p) => p.tokens.map((t) => `${p.id}/${t.file}`)));
  const pairing = defaultPairing(pack);
  void findCard;
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__inner sheet__inner--wide" onClick={(e) => e.stopPropagation()}>
        <h3>Choose a mini</h3>
        <div className="minipicker">
          {pack.tokens.map((token) => (
            <button key={token.id} type="button" onClick={() => onPick(token.file)}>
              <img src={urls[`${pack.id}/${token.file}`]} alt="" />
            </button>
          ))}
        </div>
        <p className="muted">
          {pairing.tokenForCard.size} minis are paired with cards by print order; pick another if
          one looks wrong.
        </p>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
