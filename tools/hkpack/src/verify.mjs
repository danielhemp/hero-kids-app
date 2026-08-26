/**
 * Sanity checks on built packs. Run after `npm run pack`.
 *
 * The expensive mistakes here are the silent ones: a grid that is subtly wrong
 * only shows up when tokens refuse to line up mid-encounter, and a manifest
 * pointing at a missing file only shows up on the iPad. So this opens every
 * pack, decodes every image, and checks the geometry is self-consistent.
 *
 * Needs `unzip` and ImageMagick's `identify` on PATH.
 *
 *   npm run verify            # checks ../../packs
 *   npm run verify -- <dir>   # checks somewhere else
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync as read } from 'node:fs';

/** Read the expected format straight from the source of truth. */
const PACK_FORMAT = Number(
  /PACK_FORMAT = (\d+)/.exec(
    read(new URL('./types.ts', import.meta.url), 'utf8'),
  )?.[1] ?? 1,
);

const packDir =
  process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packs');

let failures = 0;
const check = (ok, message) => {
  if (!ok) {
    failures++;
    console.log('   FAIL', message);
  }
};

const packs = readdirSync(packDir).filter((f) => f.endsWith('.hkpack'));
if (packs.length === 0) {
  console.log(`no packs in ${packDir} — run npm run pack first`);
  process.exit(1);
}

for (const file of packs) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hkverify-'));
  execFileSync('unzip', ['-q', path.join(packDir, file), '-d', dir]);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

  console.log(`\n${file}\n   ${manifest.title} · ${manifest.kind} pack`);

  check(manifest.format === PACK_FORMAT, `pack format ${manifest.format}, expected ${PACK_FORMAT}`);
  check(typeof manifest.id === 'string' && manifest.id.length > 0, 'missing id');

  for (const asset of [...manifest.maps, ...manifest.cards, ...manifest.tokens]) {
    const onDisk = path.join(dir, asset.file);
    let size = 0;
    try {
      size = statSync(onDisk).size;
    } catch {
      // reported by the check below
    }
    check(size > 0, `${asset.id}: ${asset.file} is missing or empty`);
    if (size === 0) continue;
    const actual = execFileSync('identify', ['-format', '%wx%h', onDisk], {
      encoding: 'utf8',
    }).trim();
    check(
      actual === `${asset.width}x${asset.height}`,
      `${asset.id}: image is ${actual} but the manifest says ${asset.width}x${asset.height}`,
    );
  }

  for (const map of manifest.maps) {
    const { inset, cols, rows } = map.grid;
    const cellW = (map.width - inset.left - inset.right) / cols;
    const cellH = (map.height - inset.top - inset.bottom) / rows;
    // Printed squares are square; if ours are not, the pitch or the inset is wrong.
    check(
      Math.abs(cellW - cellH) / cellW < 0.03,
      `${map.id}: cells are not square (${cellW.toFixed(1)} × ${cellH.toFixed(1)})`,
    );
    check(cols >= 3 && rows >= 3, `${map.id}: implausible grid ${cols}×${rows}`);
    check(
      inset.left >= 0 && inset.right >= 0 && inset.top >= 0 && inset.bottom >= 0,
      `${map.id}: negative inset`,
    );
  }

  for (const map of manifest.maps) {
    const markers = map.markers ?? [];
    check(Array.isArray(map.markers), `${map.id}: no markers field`);
    const labels = markers.filter((k) => k.label !== 'entry').map((k) => k.label);
    check(
      new Set(labels).size === labels.length,
      `${map.id}: the same number was read twice (${labels.join(', ')})`,
    );
    for (const marker of markers) {
      check(
        marker.col >= 0 && marker.col < map.grid.cols && marker.row >= 0 && marker.row < map.grid.rows,
        `${map.id}: marker ${marker.label} at ${marker.col},${marker.row} is off the grid`,
      );
    }
    // The book numbers its circles 1, 2, 3… with no gaps. A gap means one was
    // misread, and the monster that belonged on it would be placed elsewhere.
    const numbers = labels.map(Number).sort((a, b) => a - b);
    check(
      numbers.every((n, i) => n === i + 1),
      `${map.id}: the numbers read are ${numbers.join(', ') || 'none'} — not a run from 1`,
    );
  }

  const mapIds = new Set(manifest.maps.map((m) => m.id));
  for (const e of manifest.encounters) {
    check(Number.isInteger(e.n) && e.n > 0, `encounter ${e.n}: bad number`);
    check(typeof e.title === 'string' && e.title.length > 1, `encounter ${e.n}: bad title`);
    for (const id of e.mapIds ?? []) {
      check(mapIds.has(id), `encounter ${e.n}: references unknown map ${id}`);
    }
    check(Array.isArray(e.sections), `encounter ${e.n}: no sections`);
    // The role-playing scenes are the ones that used to come out empty, so a
    // scene with nothing in it is the regression worth shouting about.
    check(
      e.sections.some((s) => s.body || s.readAloud.length),
      `encounter ${e.n} "${e.title}" has no text at all`,
    );
    for (const link of e.links ?? []) {
      check(
        manifest.encounters.some((other) => `${other.n}${other.part ?? ''}` === link.to),
        `encounter ${e.n}: link points at missing encounter ${link.to}`,
      );
    }
    for (const groups of Object.values(e.monstersByHeroCount)) {
      for (const g of groups) {
        check(g.count > 0 && g.count < 20, `encounter ${e.n}: odd count ${g.count} for ${g.name}`);
        // A monster name that ran on into the next sentence is the classic
        // parser failure here, and it always shows up as too many words.
        check(
          g.name.split(' ').length <= 4,
          `encounter ${e.n}: suspicious monster name "${g.name}"`,
        );
      }
    }
  }

  const withMap = manifest.encounters.filter((e) => (e.mapIds ?? []).length).length;
  const withText = manifest.encounters.filter((e) =>
    e.sections.some((s) => s.readAloud.length),
  ).length;
  const named = manifest.cards.filter((c) => c.name).length;
  console.log(
    `   ${manifest.maps.length} maps · ${manifest.cards.length} cards (${named} named) · ${manifest.tokens.length} minis`,
  );
  const scenes = manifest.encounters.filter((e) => e.kind === 'scene').length;
  const links = manifest.encounters.reduce((n, e) => n + (e.links?.length ?? 0), 0);
  console.log(
    `   ${manifest.encounters.length} encounters (${scenes} scenes, ${manifest.encounters.length - scenes} fights) · ` +
      `${withMap} with a map · ${withText} with read-aloud · ${links} branch links`,
  );
  // A core pack's whole job is the rules text, so a silent zero here is the
  // failure that matters: the chapters come from a heading style the extractor
  // has to recognise, and a book that changed its typesetting would yield none.
  if (manifest.kind === 'core') {
    const chapters = manifest.chapters ?? [];
    const words = chapters.reduce(
      (n, c) => n + c.sections.reduce((m, s) => m + (s.body ?? '').split(/\s+/).filter(Boolean).length, 0),
      0,
    );
    console.log(
      `   ${chapters.length} rules chapters · ${chapters.reduce((n, c) => n + c.sections.length, 0)} sections · ${words} words`,
    );
    check(chapters.length >= 5, 'the rulebook yielded almost no chapters — check the heading detection');
    const thin = chapters.filter((c) => !c.sections.some((s) => (s.body ?? '').length > 120));
    check(thin.length === 0, `chapters with no prose: ${thin.map((c) => c.title).join(', ')}`);
    for (const c of chapters) {
      check(!/^[A-Z\s!]+$/.test(c.title), `chapter title still in small caps: "${c.title}"`);
    }
  }

  if (manifest.kind === 'adventure') {
    const withMarkers = manifest.maps.filter((m) => (m.markers ?? []).length).length;
    const positions = manifest.maps.reduce(
      (n, m) => n + (m.markers ?? []).filter((k) => k.label !== 'entry').length,
      0,
    );
    const entries = manifest.maps.filter((m) => (m.markers ?? []).some((k) => k.label === 'entry')).length;
    console.log(
      `   ${positions} printed monster positions across ${withMarkers} maps · ${entries} with a hero entry`,
    );
    // A fight whose map carries fewer circles than the roster needs will still
    // work — the rest stage along the edge — but it is worth seeing.
    for (const e of manifest.encounters) {
      if (e.kind !== 'combat') continue;
      const biggest = Math.max(
        0,
        ...Object.values(e.monstersByHeroCount).map((groups) =>
          groups.reduce((n, g) => n + g.count, 0),
        ),
      );
      const map = manifest.maps.find((m) => m.id === (e.mapIds ?? [])[0]);
      const circles = (map?.markers ?? []).filter((k) => k.label !== 'entry').length;
      if (map && circles < biggest) {
        console.log(
          `   note: encounter ${e.n}${e.part ?? ''} needs up to ${biggest} positions but ${map.id} gave ${circles} — the rest stage along the edge`,
        );
      }
    }
  }

  for (const u of manifest.unresolved) console.log(`   note: ${u.reason}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
