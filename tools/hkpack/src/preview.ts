/**
 * A single HTML page for checking a pack before it goes anywhere near an iPad.
 *
 * The important thing it shows is the grid overlay on every map: if the squares
 * do not sit on the printed lines, token snapping will be wrong all evening.
 * Everything else — card names from OCR, which map got matched to which
 * encounter, minis that came out with a chewed edge — is eyeballed here too.
 */
import type { Manifest } from './types.ts';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function renderPreview(manifest: Manifest): string {
  const mapById = new Map(manifest.maps.map((m) => [m.id, m]));

  const maps = manifest.maps
    .map((m) => {
      const { cols, rows, inset } = m.grid;
      const cellW = (m.width - inset.left - inset.right) / cols;
      const cellH = (m.height - inset.top - inset.bottom) / rows;
      const lines: string[] = [];
      for (let c = 0; c <= cols; c++) {
        const x = inset.left + c * cellW;
        lines.push(`<line x1="${x}" y1="${inset.top}" x2="${x}" y2="${m.height - inset.bottom}"/>`);
      }
      for (let r = 0; r <= rows; r++) {
        const y = inset.top + r * cellH;
        lines.push(`<line x1="${inset.left}" y1="${y}" x2="${m.width - inset.right}" y2="${y}"/>`);
      }
      // The positions read off the GM's copy of this map, drawn where the app
      // will put things. This is the check that matters for placement: the
      // numbers should land on the circles the book printed.
      for (const marker of m.markers ?? []) {
        const cx = inset.left + (marker.col + 0.5) * cellW;
        const cy = inset.top + (marker.row + 0.5) * cellH;
        const r = Math.min(cellW, cellH) * 0.42;
        lines.push(
          `<circle class="marker" cx="${cx}" cy="${cy}" r="${r}"/>` +
            `<text class="marker" x="${cx}" y="${cy}" font-size="${(r * 1.2).toFixed(0)}">` +
            `${marker.label === 'entry' ? 'H' : marker.label}</text>`,
        );
      }

      const users = manifest.encounters
        .filter((e) => (e.mapIds ?? []).includes(m.id))
        .map((e) => `Encounter ${e.n}${e.part ?? ''}`)
        .join(', ');
      return `<figure class="map">
  <div class="stack">
    <img src="${m.file}" width="${m.width}" height="${m.height}" alt="">
    <svg viewBox="0 0 ${m.width} ${m.height}" preserveAspectRatio="none">${lines.join('')}</svg>
  </div>
  <figcaption>
    <b>${m.id}</b> · page ${m.page} · ${m.width}×${m.height} @ ${m.ppi}dpi
    · <b>${cols}×${rows}</b> squares of ${cellW.toFixed(1)}px
    · ${
      (m.markers ?? []).length
        ? `<span class="ok">${(m.markers ?? []).filter((k) => k.label !== 'entry').length} printed positions${(m.markers ?? []).some((k) => k.label === 'entry') ? ' + entry' : ''}</span>`
        : '<span class="warn">no printed positions read</span>'
    }
    ${users ? `· <span class="ok">${escapeHtml(users)}</span>` : '<span class="warn">· unused</span>'}
  </figcaption>
</figure>`;
    })
    .join('\n');

  const cards = manifest.cards
    .map(
      (c) => `<figure class="card">
  <img src="${c.file}" alt="" loading="lazy">
  <figcaption>${c.name ? escapeHtml(c.name) : '<span class="warn">unnamed</span>'}
  <small>${c.kind} · ${c.id} · p${c.page}</small></figcaption>
</figure>`,
    )
    .join('\n');

  const tokens = manifest.tokens
    .map(
      (t) => `<figure class="token">
  <img src="${t.file}" alt="" loading="lazy">
  <figcaption><small>${t.id}<br>p${t.page}</small></figcaption>
</figure>`,
    )
    .join('\n');

  const encounters = manifest.encounters
    .map((e) => {
      const mapNames = (e.mapIds ?? [])
        .map((mid) => mapById.get(mid))
        .filter(Boolean)
        .map((m) => `<img class="thumb" src="${m!.file}" alt="" loading="lazy">`)
        .join('');
      const roster = Object.entries(e.monstersByHeroCount)
        .map(
          ([heroes, groups]) =>
            `<tr><td>${heroes} hero${heroes === '1' ? '' : 'es'}</td><td>${groups
              .map((g) => `${g.count} × ${escapeHtml(g.name)}`)
              .join(', ')}</td></tr>`,
        )
        .join('');
      const sections = e.sections
        .map(
          (s) => `<div class="sect">
        <h4>${escapeHtml(s.title)} <small>${s.key}</small></h4>
        ${s.readAloud.map((t) => `<blockquote>${escapeHtml(t)}</blockquote>`).join('')}
        ${(s.body ?? '')
          .split('\n\n')
          .filter(Boolean)
          .map((para) => `<p>${escapeHtml(para)}</p>`)
          .join('')}
      </div>`,
        )
        .join('');
      const links = e.links.length
        ? `<p class="links">Leads to: ${e.links
            .map((l) => `<b>${l.to}</b> — ${escapeHtml(l.label)}`)
            .join('<br>')}</p>`
        : '';
      return `<section class="encounter">
  <h3>${e.n}${e.part ?? ''}. ${escapeHtml(e.title)}
    <small>${e.kind} · page ${e.page}</small></h3>
  <div class="cols">
    <div>
      ${mapNames || (e.kind === 'combat' ? '<p class="warn">no map matched</p>' : '<p class="muted">no map — a scene</p>')}
      ${roster ? `<table>${roster}</table>` : '<p class="muted">no monsters</p>'}
      ${links}
    </div>
    <div>${sections}</div>
  </div>
</section>`;
    })
    .join('\n');

  const problems = manifest.unresolved.length
    ? `<ul class="problems">${manifest.unresolved
        .map((u) => `<li>page ${u.page}: ${escapeHtml(u.reason)}</li>`)
        .join('')}</ul>`
    : '<p class="ok">Nothing unresolved.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(manifest.title)} — pack preview</title>
<style>
  :root { color-scheme: light dark; --line: #d8d2c4; --warn: #b3541e; --ok: #2f6b3a; }
  body { font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0 auto; max-width: 1100px; padding: 2rem 1.25rem 6rem; }
  h1 { margin-bottom: .25rem; }
  h2 { margin-top: 3rem; border-bottom: 2px solid var(--line); padding-bottom: .3rem; }
  .muted, small { opacity: .65; }
  .warn { color: var(--warn); font-weight: 600; }
  .ok { color: var(--ok); }
  .stack { position: relative; }
  .stack img, .stack svg { display: block; width: 100%; height: auto; }
  .stack svg { position: absolute; inset: 0; }
  .stack line { stroke: #e0217d; stroke-width: 3; opacity: .55; }
  circle.marker { fill: none; stroke: #1667d6; stroke-width: 5; }
  text.marker { fill: #1667d6; font-weight: 700; text-anchor: middle; dominant-baseline: central; }
  figure { margin: 0 0 1.5rem; }
  figcaption { font-size: 13px; padding-top: .35rem; }
  .grid { display: grid; gap: 1rem; }
  .cards { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
  .tokens { grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); align-items: end; }
  .card img { width: 100%; border: 1px solid var(--line); border-radius: 4px; }
  .token img { width: 100%; height: auto; max-height: 130px; object-fit: contain; }
  .token figcaption { text-align: center; }
  .encounter { border-top: 1px solid var(--line); padding-top: 1rem; margin-top: 1.5rem; }
  .cols { display: grid; grid-template-columns: 300px 1fr; gap: 1.5rem; align-items: start; }
  .thumb { width: 100%; border: 1px solid var(--line); margin-bottom: .5rem; }
  blockquote { margin: 0 0 .75rem; padding-left: .9rem; border-left: 3px solid var(--line); font-style: italic; }
  table { border-collapse: collapse; font-size: 13px; width: 100%; }
  td { border-top: 1px solid var(--line); padding: .25rem .4rem; }
  .problems li { color: var(--warn); }
  .sect { margin-bottom: 1rem; }
  .sect h4 { margin: 0 0 .35rem; font-size: .95rem; }
  .sect h4 small { font-weight: 400; opacity: .5; }
  .links { font-size: 13px; background: #fffdf7; border: 1px solid var(--line); border-radius: 8px; padding: .5rem .7rem; }
  @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>${escapeHtml(manifest.title)}</h1>
<p class="muted">${manifest.kind} pack · ${manifest.source.file} · ${manifest.source.pages} pages ·
generated ${manifest.generated} · ${manifest.maps.length} maps, ${manifest.cards.length} cards,
${manifest.tokens.length} minis, ${manifest.encounters.length} encounters</p>

<h2>Check first</h2>
${problems}
<p>The blue circles are the monster positions read off the GM's copy of each map,
and <b>H</b> is where the heroes come in. They should sit on the numbers the book
printed. The pink overlay is where the app will snap tokens. It should sit on the printed
squares. If a map is out, fix <code>grid.inset</code> or <code>grid.cols</code>/<code>rows</code>
in <code>manifest.json</code>, or nudge it in the app's calibration overlay.</p>

<h2>Maps</h2>
${maps}

<h2>Adventure</h2>
${manifest.front
  .map(
    (s) => `<div class="sect"><h4>${escapeHtml(s.title)}</h4>
    ${s.readAloud.map((t) => `<blockquote>${escapeHtml(t)}</blockquote>`).join('')}
    ${(s.body ?? '').split('\n\n').filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>`,
  )
  .join('')}

<h2>Encounters</h2>
${encounters}

<h2>Cards</h2>
<div class="grid cards">${cards}</div>

<h2>Stand-up minis</h2>
<div class="grid tokens">${tokens}</div>
</body>
</html>
`;
}
