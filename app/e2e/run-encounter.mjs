/**
 * Drives the built app the way a GM would, at iPad size, and screenshots it.
 *
 * The check that matters is the last one: after dragging a mini across the map,
 * does it land centred on a printed square? Everything else in this app is
 * ordinary UI, but the grid maths is the part that would quietly ruin an
 * evening, and it cannot be verified by reading the code.
 *
 *   node e2e/run-encounter.mjs [packFile] [--headed]
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const packFile =
  process.argv.find((a) => a.endsWith('.hkpack')) ??
  path.join(repoRoot, 'packs/hero-kids-adventure-basement-o-rats.hkpack');
const corePack = path.join(repoRoot, 'packs/hero-kids-fantasy-rpg.hkpack');
const shots = path.join(here, 'shots');
mkdirSync(shots, { recursive: true });

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

// Serve dist/ ourselves so this is one self-contained command rather than
// "remember to start the preview server first".
const dist = path.resolve(here, '../dist');
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
const port = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});

// iPad Pro 11" logical viewport, landscape — how it will actually be used.
const context = await browser.newContext({
  viewport: { width: 1194, height: 834 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: false,
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('    [console error]', m.text());
});
page.on('pageerror', (e) => console.log('    [page error]', e.message));

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

console.log('\nimport packs');
await page.setInputFiles('input[type=file]', [corePack, packFile]);
await page.waitForSelector('.encounters__row', { timeout: 30_000 });
check(true, 'packs imported and encounters listed');
await page.screenshot({ path: path.join(shots, '1-library.png') });

console.log('\npick a party');
await page.click('button:has-text("Party")');
await page.waitForSelector('.party__card');
const cards = page.locator('.party__card');
await cards.nth(0).click();
await cards.nth(2).click();
check((await page.locator('.party__chosen li').count()) === 2, 'two heroes chosen');
await page.screenshot({ path: path.join(shots, '2-party.png') });
await page.click('button:has-text("Done")');

console.log('\nopen encounter 1');
await page.waitForSelector('.encounters__row');
await page.locator('.encounters__button').first().click();
// Encounters now open on their text; the board is a deliberate second step.
await page.waitForSelector('.scene__title', { timeout: 15_000 });
check(
  (await page.locator('.sect').count()) > 0,
  `the scene shows ${await page.locator('.sect').count()} sections of the book`,
);
await page.screenshot({ path: path.join(shots, '3a-scene.png') });
await page.click('button:has-text("Set up the board")');
await page.waitForSelector('.board__map');
await page.waitForTimeout(600);

const staged = await page.locator('.standee').count();
check(staged > 0, `${staged} minis staged on the map`);
check(
  (await page.locator('.standee--hero').count()) === 2,
  `both heroes staged (found ${await page.locator('.standee--hero').count()})`,
);
check((await page.locator('.readaloud').count()) > 0, 'read-aloud text is on the GM panel');
await page.screenshot({ path: path.join(shots, '3-encounter.png') });

console.log('\ndrag a mini');
// Read the grid geometry the app is using, so the assertion is about where the
// token ends up rather than about numbers this script made up.
const geometry = await page.evaluate(() => {
  const layer = document.querySelector('.board__layer');
  const map = document.querySelector('.board__map');
  const rect = layer.getBoundingClientRect();
  const scale = rect.width / map.width;
  return { left: rect.left, top: rect.top, scale, width: map.width, height: map.height };
});

const first = page.locator('.standee').first();
const before = await first.boundingBox();
const target = { x: geometry.left + geometry.width * 0.55 * geometry.scale, y: geometry.top + geometry.height * 0.62 * geometry.scale };

await page.mouse.move(before.x + before.width / 2, before.y + before.height * 0.85);
await page.mouse.down();
await page.mouse.move(target.x, target.y, { steps: 24 });
await page.screenshot({ path: path.join(shots, '4-dragging.png') });
await page.mouse.up();
await page.waitForTimeout(300);

const after = await first.boundingBox();
check(
  Math.hypot(after.x - before.x, after.y - before.y) > 50,
  'the mini moved',
);

// Where did it land relative to the grid? A token is drawn at a cell origin,
// so its offset from the grid inset must be a whole number of cells.
const gridFit = await page.evaluate(() => {
  const layer = document.querySelector('.board__layer');
  const mapEl = document.querySelector('.board__map');
  const standee = document.querySelector('.standee');
  const layerRect = layer.getBoundingClientRect();
  const scale = layerRect.width / mapEl.width;
  const rect = standee.getBoundingClientRect();
  return {
    x: (rect.left - layerRect.left) / scale,
    y: (rect.top - layerRect.top) / scale,
    w: rect.width / scale,
    h: rect.height / scale,
  };
});

const manifestGrid = await page.evaluate(async () => {
  const open = indexedDB.open('hero-kids');
  const db = await new Promise((res, rej) => {
    open.onsuccess = () => res(open.result);
    open.onerror = () => rej(open.error);
  });
  const read = (store, key) =>
    new Promise((res) => {
      const r = db.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => res(r.result);
    });

  // The board is a replay of the op log, so replay the two ops that decide
  // which map is on screen rather than reaching for a stored board.
  const log = await read('state', 'log');
  let packId;
  let mapId;
  for (const stamped of [...log.ops].sort((a, b) => a.lamport - b.lamport)) {
    if (stamped.op.t === 'scene') {
      packId = stamped.op.packId;
      mapId = stamped.op.mapId;
    }
    if (stamped.op.t === 'map') mapId = stamped.op.mapId;
  }

  const pack = await read('packs', packId);
  const map = pack.manifest.maps.find((m) => m.id === mapId);
  return { grid: map.grid, width: map.width, height: map.height };
});

const cellW =
  (manifestGrid.width - manifestGrid.grid.inset.left - manifestGrid.grid.inset.right) /
  manifestGrid.grid.cols;
const cellH =
  (manifestGrid.height - manifestGrid.grid.inset.top - manifestGrid.grid.inset.bottom) /
  manifestGrid.grid.rows;

const colOffset = (gridFit.x - manifestGrid.grid.inset.left) / cellW;
const rowOffset = (gridFit.y - manifestGrid.grid.inset.top) / cellH;
check(
  Math.abs(colOffset - Math.round(colOffset)) < 0.02 &&
    Math.abs(rowOffset - Math.round(rowOffset)) < 0.02,
  `the mini snapped to a whole square (col ${colOffset.toFixed(3)}, row ${rowOffset.toFixed(3)})`,
);
check(
  Math.abs(gridFit.w - cellW) < 1 && Math.abs(gridFit.h - cellH) < 1,
  `a mini's base is exactly one square (${gridFit.w.toFixed(1)}×${gridFit.h.toFixed(1)} vs ${cellW.toFixed(1)}×${cellH.toFixed(1)})`,
);

console.log('\nmark damage');
await first.click();
await page.waitForSelector('.tokenbar');
await page.locator('.tokenbar .pip', { hasText: 'KO' }).click();
await page.waitForTimeout(200);
check((await page.locator('.standee.is-ko').count()) === 1, 'a mini can be marked KO');

console.log('\nadd a monster mid-fight');
const beforeAdd = await page.locator('.standee--monster').count();
const addButton = page.locator('.roster button:has-text("Add")').first();
if (await addButton.count()) {
  await addButton.click();
  await page.waitForTimeout(200);
  check(
    (await page.locator('.standee--monster').count()) === beforeAdd + 1,
    'the roster can add another monster',
  );
}

await page.locator('.play__board').click({ position: { x: 20, y: 20 } });
await page.screenshot({ path: path.join(shots, '5-after.png') });

console.log('\nreload mid-encounter');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.board__map', { timeout: 15_000 });
await page.waitForTimeout(500);
check(
  (await page.locator('.standee').count()) > 0 && (await page.locator('.standee.is-ko').count()) === 1,
  'the board survived a reload, damage included',
);
await page.screenshot({ path: path.join(shots, '6-reloaded.png') });

await browser.close();
server.close();

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
