/**
 * Do the minis land where the book put them?
 *
 * The GM's copy of each map carries numbered circles for the monsters and a
 * lettered circle for where the heroes come in; the printable copy carries
 * neither. hkpack recovers the positions by subtracting one from the other, and
 * this is the check that the recovery survived all the way to the board — that
 * setting up Encounter 1 puts a rat on circle 1 rather than in a row along the
 * top edge.
 *
 *   node e2e/placement.mjs [--headed]
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serveDist } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const core = path.join(repoRoot, 'packs/hero-kids-fantasy-rpg.hkpack');
const adventure = path.join(repoRoot, 'packs/hero-kids-adventure-basement-o-rats.hkpack');
mkdirSync(path.join(here, 'shots'), { recursive: true });

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

// Read the pack directly, so the expected positions come from the book rather
// than from the app repeating itself back to us.
const unpacked = mkdtempSync(path.join(tmpdir(), 'hkplace-'));
execFileSync('unzip', ['-q', adventure, 'manifest.json', '-d', unpacked]);
const manifest = JSON.parse(readFileSync(path.join(unpacked, 'manifest.json'), 'utf8'));

const first = manifest.encounters[0];
const map = manifest.maps.find((m) => m.id === (first.mapIds ?? [])[0]);
if (!map) {
  console.error('encounter 1 has no map — nothing to check');
  process.exit(1);
}
const circles = (map.markers ?? [])
  .filter((m) => /^\d+$/.test(m.label))
  .sort((a, b) => Number(a.label) - Number(b.label));
const entry = (map.markers ?? []).find((m) => m.label === 'entry');

console.log(`\nwhat the book printed on ${map.id}`);
check(circles.length >= 2, `${circles.length} numbered positions`);
check(Boolean(entry), `a hero entry at ${entry?.col},${entry?.row}`);

const site = await serveDist();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  headless: !process.argv.includes('--headed'),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1194, height: 834 }, hasTouch: true });
page.on('pageerror', (e) => console.log('    [error]', e.message));

await page.goto(site.url, { waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file]', [core, adventure]);
await page.waitForSelector('.encounters__row', { timeout: 30_000 });
await page.click('button:has-text("Party")');
await page.waitForSelector('.party__card');
await page.locator('.party__card').nth(0).click();
await page.locator('.party__card').nth(2).click();
await page.click('button:has-text("Done")');
await page.waitForSelector('.encounters__row');

console.log('\nset up encounter 1');
await page.locator('.encounters__button').first().click();
await page.waitForSelector('.scene__title');
await page.click('button:has-text("Set up the board")');
await page.waitForSelector('.board__map', { timeout: 15_000 });
await page.waitForTimeout(600);

/** Read each mini's grid cell back out of the board's own geometry. */
const placed = await page.evaluate(async () => {
  const db = await new Promise((resolve) => {
    const request = indexedDB.open('hero-kids');
    request.onsuccess = () => resolve(request.result);
  });
  const log = await new Promise((resolve) => {
    const request = db.transaction('state').objectStore('state').get('log');
    request.onsuccess = () => resolve(request.result);
  });
  let tokens = [];
  for (const stamped of [...log.ops].sort((a, b) => a.lamport - b.lamport)) {
    if (stamped.op.t === 'scene') tokens = stamped.op.tokens;
  }
  return tokens.map((t) => ({ side: t.side, name: t.name, col: t.col, row: t.row }));
});

const monsters = placed.filter((t) => t.side === 'monster');
const heroes = placed.filter((t) => t.side === 'hero');
console.log(`    ${monsters.map((m) => `${m.name}@${m.col},${m.row}`).join('  ')}`);

console.log('\nmonsters stand on their numbered circles');
check(monsters.length > 0, `${monsters.length} monsters staged`);
const wrong = monsters.filter((m, i) => {
  const circle = circles[i];
  return !circle || circle.col !== m.col || circle.row !== m.row;
});
check(
  wrong.length === 0,
  wrong.length === 0
    ? `all ${monsters.length} are on the circles the book printed, in order`
    : `${wrong.length} are not: ${wrong.map((m) => `${m.name}@${m.col},${m.row}`).join(', ')}`,
);

console.log('\nheroes come in where the book says');
check(heroes.length === 2, `${heroes.length} heroes staged`);
const far = heroes.filter(
  (h) => !entry || Math.hypot(h.col - entry.col, h.row - entry.row) > 2.5,
);
check(
  far.length === 0,
  far.length === 0
    ? `both are on or beside the entry at ${entry.col},${entry.row}`
    : `${far.length} started nowhere near it`,
);
check(
  new Set(placed.map((t) => `${t.col},${t.row}`)).size === placed.length,
  'no two minis were staged on the same square',
);

console.log('\nthe book’s positions are shown, not just used');
await page.locator('.panel__head .toggle input').check();
await page.waitForTimeout(200);
const shown = await page.locator('.board__marker').count();
check(shown === (map.markers ?? []).length, `${shown} printed positions drawn with the grid`);
await page.screenshot({ path: path.join(here, 'shots', '17-placement.png') });

console.log('\na scene with no monsters still works');
await page.click('button:has-text("‹ Scene")');
await page.waitForSelector('.scene__title');
await page.click('button:has-text("‹ Adventure")');
await page.waitForSelector('.encounters__row');
// Encounter 4 of Basement O Rats is pure role-playing: its map has an entry
// marker and no numbers at all, which used to be indistinguishable from a
// failed read.
await page.locator('.encounters__button').nth(3).click();
await page.waitForSelector('.scene__title');
check(
  (await page.locator('.scene__fight').count()) === 0,
  'the role-playing encounter does not offer a board',
);

await browser.close();
site.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
