/**
 * A scene: the parts of the adventure that are talking rather than fighting.
 *
 * Five of Reign of the Dragon's fourteen encounters are pure conversation — the
 * dragon asking for help, planning the journey, the ending. They have no map and
 * no monsters, and until now the app had nothing to show for them, which meant
 * the book stayed open on the table anyway.
 *
 * The table iPad is deliberately left alone while this is on screen: it keeps
 * showing whatever map it had, rather than blanking every time somebody talks.
 */
import type { Encounter, EncounterLink, Manifest } from '../types.ts';
import { Sections } from './Sections.tsx';

interface Props {
  pack: Manifest;
  encounter: Encounter;
  /** where each link leads, resolved for the button labels */
  links: { link: EncounterLink; encounter: Encounter }[];
  /** the next encounter in printed order, when the book offers no explicit link */
  fallback?: Encounter;
  link: React.ReactNode;
  onOpenPairing: () => void;
  onGo: (encounterKey: string) => void;
  onStartFight: () => void;
  onExit: () => void;
}

export function SceneScreen({
  pack,
  encounter,
  links,
  fallback,
  link,
  onOpenPairing,
  onGo,
  onStartFight,
  onExit,
}: Props) {
  const roster = Object.values(encounter.monstersByHeroCount)[0] ?? [];

  return (
    <div className="scene">
      <header className="scene__head">
        <button type="button" className="btn btn--quiet" onClick={onExit}>
          ‹ Adventure
        </button>
        <span className="scene__where">{pack.title}</span>
        <button type="button" className="btn btn--quiet" onClick={onOpenPairing}>
          {link}
        </button>
      </header>

      <div className="scene__body">
        <h1 className="scene__title">
          <span className="scene__number">
            {encounter.n}
            {encounter.part ?? ''}
          </span>
          {encounter.title}
        </h1>

        {encounter.kind === 'combat' && (
          <div className="scene__fight">
            <div>
              <b>This one is a fight.</b>
              {roster.length > 0 && (
                <span> {roster.map((g) => `${g.count} × ${g.name}`).join(', ')}</span>
              )}
            </div>
            <button type="button" className="btn btn--primary" onClick={onStartFight}>
              Set up the board
            </button>
          </div>
        )}

        <Sections sections={encounter.sections} lead />

        <nav className="scene__next">
          {links.length > 0 ? (
            <>
              <h3 className="panel__h3">
                {links.length > 1 ? 'The players choose' : 'Next'}
              </h3>
              {links.map(({ link: l, encounter: target }) => (
                <button
                  key={l.to}
                  type="button"
                  className="btn scene__choice"
                  onClick={() => onGo(l.to)}
                >
                  <span>{l.label}</span>
                  <small>
                    {target.kind === 'combat' ? 'a fight' : 'a scene'} · page {target.page}
                  </small>
                </button>
              ))}
            </>
          ) : fallback ? (
            <>
              <h3 className="panel__h3">Next</h3>
              <button
                type="button"
                className="btn scene__choice"
                onClick={() => onGo(`${fallback.n}${fallback.part ?? ''}`)}
              >
                <span>
                  {fallback.n}
                  {fallback.part ?? ''}. {fallback.title}
                </span>
                <small>the book gives no instruction here — this is simply what comes next</small>
              </button>
            </>
          ) : (
            <p className="muted">That's the end of the adventure.</p>
          )}
        </nav>
      </div>
    </div>
  );
}
