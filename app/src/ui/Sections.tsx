/**
 * Rendering the book's prose.
 *
 * One renderer for both screens, because a scene and a fight are the same thing
 * on the page — a run of headed sections, some of which contain boxed text to
 * read out. The only difference is which sections lead and which stay folded.
 */
import { useState } from 'react';
import type { Section } from '../types.ts';

/**
 * Sections that open by default: what the GM needs the moment they arrive.
 * `background` and `intro` are the adventure's opening pages — both are almost
 * entirely boxed text to read out, so they lead; the prep notes printed between
 * them (duration, improvisation, structure) stay folded until asked for.
 */
const OPEN_BY_DEFAULT = new Set(['intro', 'background', 'rolePlaying', 'exploration', 'combatIntro']);

/** The conclusion gives away how the scene ends, so it stays shut until asked for. */
const ALWAYS_CLOSED = new Set(['conclusion']);

export function Sections({ sections, lead }: { sections: Section[]; lead?: boolean }) {
  return (
    <>
      {sections.map((section, index) => (
        <SectionBlock
          key={`${section.key}-${index}`}
          section={section}
          open={Boolean(lead) && OPEN_BY_DEFAULT.has(section.key) && !ALWAYS_CLOSED.has(section.key)}
        />
      ))}
    </>
  );
}

function SectionBlock({ section, open }: { section: Section; open: boolean }) {
  const [expanded, setExpanded] = useState(open);

  return (
    <section className={`sect ${expanded ? 'is-open' : ''}`}>
      <button type="button" className="sect__head" onClick={() => setExpanded((v) => !v)}>
        <span className="sect__caret">{expanded ? '▾' : '▸'}</span>
        {section.title}
        {!expanded && section.readAloud.length > 0 && (
          <span className="sect__badge">{section.readAloud.length} to read</span>
        )}
      </button>

      {expanded && (
        <div className="sect__body">
          {section.readAloud.map((text, i) => (
            <ReadAloud key={i} text={text} />
          ))}
          {section.body
            ?.split('\n\n')
            .filter(Boolean)
            .map((para, i) => <Paragraph key={i} text={para} />)}
        </div>
      )}
    </section>
  );
}

/**
 * Boxed text, tapped to dim once it has been read — an evening's worth of these
 * scroll past and it is easy to lose your place.
 */
export function ReadAloud({ text }: { text: string }) {
  const [read, setRead] = useState(false);
  return (
    <blockquote className={`readaloud ${read ? 'is-read' : ''}`} onClick={() => setRead((v) => !v)}>
      {text}
    </blockquote>
  );
}

/** The books use bullets heavily; a run of them reads far better as a list. */
function Paragraph({ text }: { text: string }) {
  if (!text.includes('•')) return <p>{text}</p>;

  const [intro, ...items] = text.split('•');
  return (
    <>
      {intro?.trim() && <p>{intro.trim()}</p>}
      <ul className="bullets">
        {items.map((item, i) => item.trim() && <li key={i}>{item.trim()}</li>)}
      </ul>
    </>
  );
}
