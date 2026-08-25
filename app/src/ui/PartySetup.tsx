/**
 * Who the kids are playing.
 *
 * Set once and remembered. The party size also decides how many monsters each
 * encounter puts on the board, since Hero Kids scales its rosters by the number
 * of heroes.
 */
import type { Manifest, Party } from '../types.ts';
import { artLookup, defaultPairing } from '../store/pairing.ts';
import { useAssets } from '../store/useAssets.ts';

interface Props {
  packs: Manifest[];
  party: Party;
  onChange: (party: Party) => void;
  onDone: () => void;
}

export function PartySetup({ packs, party, onChange, onDone }: Props) {
  const candidates = packs.flatMap((pack) => {
    const pairing = defaultPairing(pack);
    const art = artLookup(pack, pairing);
    return pairing.heroCards.map((card) => ({
      pack,
      card,
      art: art.fileForCard(card.id),
      key: `${pack.id}:${card.id}`,
    }));
  });

  const urls = useAssets([
    ...candidates.map((c) => `${c.pack.id}/${c.card.file}`),
    ...candidates.map((c) => (c.art ? `${c.pack.id}/${c.art}` : undefined)),
  ]);

  const chosen = new Set(party.heroes.map((h) => h.id));

  function toggle(candidate: (typeof candidates)[number]) {
    if (chosen.has(candidate.key)) {
      onChange({ heroes: party.heroes.filter((h) => h.id !== candidate.key) });
      return;
    }
    onChange({
      heroes: [
        ...party.heroes,
        {
          id: candidate.key,
          name: candidate.card.name || 'Hero',
          packId: candidate.pack.id,
          cardId: candidate.card.id,
          art: candidate.art,
        },
      ],
    });
  }

  function rename(id: string, name: string) {
    onChange({ heroes: party.heroes.map((h) => (h.id === id ? { ...h, name } : h)) });
  }

  return (
    <div className="party">
      <header className="library__head">
        <h1>Party</h1>
        <button type="button" className="btn btn--primary" onClick={onDone}>
          Done
        </button>
      </header>

      {party.heroes.length > 0 ? (
        <ul className="party__chosen">
          {party.heroes.map((hero) => (
            <li key={hero.id}>
              <span className="party__mini">
                {hero.art && urls[`${hero.packId}/${hero.art}`] ? (
                  <img src={urls[`${hero.packId}/${hero.art}`]} alt="" />
                ) : null}
              </span>
              <input
                value={hero.name}
                onChange={(e) => rename(hero.id, e.target.value)}
                aria-label="Hero name"
              />
              <button type="button" className="btn btn--quiet" onClick={() => onChange({ heroes: party.heroes.filter((h) => h.id !== hero.id) })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          Tap the heroes your kids are playing. Their names are editable — use the kid's name for
          their hero if that's easier at the table.
        </p>
      )}

      <div className="party__grid">
        {candidates.map((candidate) => (
          <button
            key={candidate.key}
            type="button"
            className={`party__card ${chosen.has(candidate.key) ? 'is-chosen' : ''}`}
            onClick={() => toggle(candidate)}
          >
            <img src={urls[`${candidate.pack.id}/${candidate.card.file}`]} alt={candidate.card.name} />
            <span>{candidate.card.name || 'Blank card'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
