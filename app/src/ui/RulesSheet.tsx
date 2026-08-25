/**
 * The rulebook, over the top of whatever is already on screen.
 *
 * The question that sends a GM back to the printed book is never "what happens
 * in this adventure" — it is "how does knocked out work again", asked in the
 * middle of a fight with four children watching. So this is a sheet rather than
 * a screen: it opens over the board, answers the question, and closes, and the
 * fight underneath is exactly where it was.
 *
 * Search is the front door. Nineteen chapters is small enough to browse but far
 * too slow when somebody is waiting, and the word the GM reaches for — "potion",
 * "prone", "cover" — is usually the sub-heading it is printed under.
 */
import { useMemo, useState } from 'react';
import type { Chapter, Manifest, Section } from '../types.ts';
import { Sections } from './Sections.tsx';

interface Props {
  packs: Manifest[];
  onClose: () => void;
}

interface Hit {
  chapter: Chapter;
  section: Section;
}

/** Everything a section says, for matching against. */
const textOf = (s: Section) => `${s.title}\n${s.body ?? ''}\n${s.readAloud.join('\n')}`;

export function RulesSheet({ packs, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string>();

  // Every core pack's chapters, in printed order. Normally that is one book.
  const chapters = useMemo(
    () => packs.filter((p) => p.kind === 'core').flatMap((p) => p.chapters ?? []),
    [packs],
  );

  const hits = useMemo<Hit[]>(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const found: Hit[] = [];
    for (const chapter of chapters) {
      for (const section of chapter.sections) {
        if (textOf(section).toLowerCase().includes(needle)) found.push({ chapter, section });
      }
    }
    // A heading match is what you meant; a passing mention in the prose is not.
    return found.sort((a, b) => {
      const rank = (h: Hit) => (h.section.title.toLowerCase().includes(needle) ? 0 : 1);
      return rank(a) - rank(b);
    });
  }, [chapters, query]);

  const open = chapters.find((c) => c.key === openKey);
  const searching = query.trim().length >= 2;

  return (
    <div className="sheet" onClick={onClose}>
      <div
        className="sheet__inner sheet__inner--wide rules"
        role="dialog"
        aria-label="Rules"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rules__head">
          <h3>Rules</h3>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Close
          </button>
        </header>

        {chapters.length === 0 ? (
          <p className="muted">
            The rules come from the core Hero Kids pack. Add it on the library screen and they
            will show up here.
          </p>
        ) : (
          <>
            <input
              className="rules__search"
              type="search"
              value={query}
              placeholder="Search the rules — potion, prone, cover…"
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />

            {searching ? (
              hits.length === 0 ? (
                <p className="muted">Nothing in the rulebook matches “{query.trim()}”.</p>
              ) : (
                <div className="rules__hits">
                  <p className="muted">
                    {hits.length} {hits.length === 1 ? 'passage' : 'passages'}
                  </p>
                  {hits.map(({ chapter, section }, i) => (
                    <div className="rules__hit" key={`${chapter.key}-${section.key}-${i}`}>
                      <small className="rules__where">{chapter.title}</small>
                      <Sections sections={[section]} all />
                    </div>
                  ))}
                </div>
              )
            ) : open ? (
              <>
                <button type="button" className="btn btn--quiet" onClick={() => setOpenKey(undefined)}>
                  ‹ All chapters
                </button>
                <h3 className="rules__chapter">{open.title}</h3>
                {/* Open, like the printed page. Folding them would make every
                    lookup two taps, and a chapter is a page, not a menu. */}
                <Sections sections={open.sections} all />
              </>
            ) : (
              <ul className="rules__toc">
                {chapters.map((chapter) => (
                  <li key={chapter.key}>
                    <button type="button" onClick={() => setOpenKey(chapter.key)}>
                      <b>{chapter.title}</b>
                      <small>
                        {chapter.sections
                          .filter((s) => s.key !== 'intro')
                          .map((s) => s.title)
                          .join(' · ') || 'page ' + chapter.page}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
