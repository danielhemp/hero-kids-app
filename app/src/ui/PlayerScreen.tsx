/**
 * The iPad that lies flat on the table.
 *
 * The map, the party's cards, and the minis the GM has revealed — nothing else.
 * No encounter text, no tactics, no monsters still waiting in the wings. The
 * kids should be able to lean over this all evening without reading how the
 * fight ends.
 */
import { useState } from 'react';
import { Board } from '../board/Board.tsx';
import type { Manifest, MapAsset, Party, Token } from '../types.ts';
import { useAsset, useAssets } from '../store/useAssets.ts';

interface Props {
  pack: Manifest;
  map: MapAsset;
  tokens: Token[];
  party: Party;
  onMove: (tokenId: string, col: number, row: number) => void;
  onOpenPairing: () => void;
  connected: boolean;
}

export function PlayerScreen({ pack, map, tokens, party, onMove, onOpenPairing, connected }: Props) {
  const [selectedId, setSelectedId] = useState<string>();
  const [cardHero, setCardHero] = useState<string>();

  const mapUrl = useAsset(`${pack.id}/${map.file}`);
  // Hidden minis are GM staging — monsters placed but not yet seen. They must
  // not reach this screen at all, not even invisibly in the DOM.
  const visible = tokens.filter((token) => !token.hidden);
  const artUrls = useAssets(visible.map((t) => (t.art ? `${t.packId}/${t.art}` : undefined)));

  const hero = party.heroes.find((h) => h.id === cardHero);
  const heroCards = useAssets(
    party.heroes.map((h) => (h.cardId ? `${h.packId}/${cardFile(pack, h.cardId)}` : undefined)),
  );
  const heroArt = useAssets(party.heroes.map((h) => (h.art ? `${h.packId}/${h.art}` : undefined)));

  return (
    <div className="player">
      <div className="player__board">
        <Board
          map={map}
          mapUrl={mapUrl}
          tokens={visible}
          artUrls={artUrls}
          selectedId={selectedId}
          showGrid={false}
          onSelect={setSelectedId}
          onMove={onMove}
        />
        {!connected && (
          <button type="button" className="player__link" onClick={onOpenPairing}>
            Not connected to the GM — tap to pair
          </button>
        )}
      </div>

      <div className="player__party">
        {party.heroes.map((heroEntry) => {
          const art = heroEntry.art ? heroArt[`${heroEntry.packId}/${heroEntry.art}`] : undefined;
          const token = visible.find((t) => t.side === 'hero' && t.name === heroEntry.name);
          return (
            <button
              key={heroEntry.id}
              type="button"
              className={`player__hero ${token?.health === 3 ? 'is-ko' : ''}`}
              onClick={() => setCardHero(heroEntry.id)}
            >
              {art && <img src={art} alt="" />}
              <span>{heroEntry.name}</span>
              <span className="player__health">
                {token ? ['OK', 'Bruised', 'Hurt', "KO'd"][token.health] : ''}
              </span>
            </button>
          );
        })}
      </div>

      {hero?.cardId && (
        <div className="sheet" onClick={() => setCardHero(undefined)}>
          <div className="sheet__inner" onClick={(e) => e.stopPropagation()}>
            <img src={heroCards[`${hero.packId}/${cardFile(pack, hero.cardId)}`]} alt={hero.name} />
            <button type="button" className="btn" onClick={() => setCardHero(undefined)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Hero cards usually live in the core pack while the map comes from an
 * adventure, so the lookup has to cope with the card not being in `pack`.
 */
function cardFile(pack: Manifest, cardId: string): string {
  return pack.cards.find((c) => c.id === cardId)?.file ?? `cards/${cardId}.webp`;
}
