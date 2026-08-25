/**
 * The cream screen.
 *
 * A pack imported before the pack format changed stayed in IndexedDB, the scene
 * screen called `.map` on a `sections` that wasn't there any more, React threw,
 * and the app unmounted itself into a blank parchment-coloured rectangle. At a
 * table with children waiting that is the worst error message there is: nothing
 * to read, nothing to tap, no hint that the fix is thirty seconds of rebuilding.
 *
 * Two things had to be true afterwards, and this checks both:
 *
 *   1. a stale pack is recognised at load, not just at import, so it never
 *      reaches a screen that will choke on it — the library says so plainly;
 *   2. if something throws anyway, the boundary shows a message and a way out
 *      instead of a blank page.
 *
 *   node e2e/recovery.mjs [--headed]
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDist } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const packs = [
  path.join(repoRoot, 'packs/hero-kids-fantasy-rpg.hkpack'),
  path.join(repoRoot, 'packs/hero-kids-adventure-basement-o-rats.hkpack'),
];

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const site = await serveDist();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  headless: !process.argv.includes('--headed'),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2 });

/** Rewrite every stored manifest in place — this is the state a real iPad was in. */
const editStoredPacks = (fn) =>
  page.evaluate(async (source) => {
    const edit = new Function('manifest', source);
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('hero-kids');
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction('packs', 'readwrite');
    const store = tx.objectStore('packs');
    const rows = await new Promise((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
    });
    for (const row of rows) {
      edit(row.manifest);
      store.put(row);
    }
    await new Promise((resolve) => (tx.oncomplete = resolve));
  }, fn);

const blank = async () => (await page.evaluate(() => document.getElementById('root').innerHTML)).length === 0;

console.log('\nimport packs');
await page.goto(site.url, { waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file]', packs);
await page.waitForSelector('.encounters__row', { timeout: 30_000 });
check(true, 'packs imported');

console.log('\na pack left over from an older hkpack');
// Format 2: no per-section prose, no branch links, no combat/scene distinction.
await editStoredPacks(`
  manifest.format = 2;
  delete manifest.front;
  for (const e of manifest.encounters) { delete e.sections; delete e.links; delete e.kind; }
`);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.library', { timeout: 15_000 });

check(!(await blank()), 'the app still renders — no cream screen');
const notice = await page.locator('.library .error').innerText();
check(/older version of hkpack/.test(notice), `the library explains why: "${notice.replace(/\s+/g, ' ').trim()}"`);
check(
  /Basement O Rats/.test(notice) && /Fantasy RPG/.test(notice),
  'both stale packs are named, so he knows what to rebuild',
);
check(
  (await page.locator('.encounters__row').count()) === 0,
  'no encounters are offered from a pack that cannot be read',
);
await page.screenshot({ path: path.join(here, 'shots', '7-stale-pack.png') });

console.log('\nsomething throws anyway');
// A pack that claims the current format but is malformed — the case the version
// check cannot catch, and the reason the boundary exists at all.
await page.evaluate(() => indexedDB.deleteDatabase('hero-kids'));
await page.reload({ waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file]', packs);
await page.waitForSelector('.encounters__row', { timeout: 30_000 });
await editStoredPacks(`for (const e of manifest.encounters) delete e.sections;`);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.encounters__row', { timeout: 15_000 });
await page.locator('.encounters__button').first().click();
await page.waitForTimeout(600);

check(!(await blank()), 'a genuine crash still renders something');
check(await page.locator('.crash').isVisible(), 'the error boundary is showing');
check(
  await page.locator('.crash button:has-text("Reset this iPad")').isVisible(),
  'and offers a way out that does not need the Mac',
);
const explained = await page.locator('.crash').innerText();
check(/older version of\s+hkpack/.test(explained), 'it guesses the likely cause — a stale pack');
await page.screenshot({ path: path.join(here, 'shots', '8-crash.png') });

console.log('\nreset clears it');
page.on('dialog', (d) => void d.accept());
await page.locator('.crash button:has-text("Reset this iPad")').click();
await page.waitForSelector('.empty', { timeout: 15_000 });
check(
  (await page.locator('.empty h2').innerText()).includes('No content yet'),
  'the iPad is back to a clean library, ready for rebuilt packs',
);

await browser.close();
site.close();

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
