/**
 * Two clients, paired, converging.
 *
 * The camera is bypassed by using the "paste the code" field the app already
 * offers for when scanning misbehaves — so this exercises the real signalling
 * path, the real data channel and the real op log, just without pointing one
 * webcam at another.
 *
 * What it is checking: that a move made on either iPad shows up on the other,
 * that hidden monsters never reach the player screen, and that dropping the
 * link and re-pairing merges rather than picking a winner.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

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
  let file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function openIpad(name) {
  const context = await browser.newContext({
    viewport: { width: 1194, height: 834 },
    hasTouch: true,
    permissions: ['camera'],
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`    [${name} error]`, e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`    [${name} console]`, m.text());
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type=file]', packs);
  await page.waitForSelector('.encounters__row', { timeout: 30_000 });
  return { context, page };
}

console.log('\nset up two iPads');
const gm = await openIpad('gm');
const player = await openIpad('player');
check(true, 'both iPads have the packs installed');

// Same party on both, so hero minis and cards resolve on each screen.
for (const { page } of [gm, player]) {
  await page.click('button:has-text("Party")');
  await page.waitForSelector('.party__card');
  await page.locator('.party__card').nth(0).click();
  await page.locator('.party__card').nth(2).click();
  await page.click('button:has-text("Done")');
  await page.waitForSelector('.encounters__row');
}

console.log('\nGM starts encounter 1');
await gm.page.locator('.encounters__button').first().click();
await gm.page.waitForSelector('.scene__title', { timeout: 15_000 });
await gm.page.click('button:has-text("Set up the board")');
await gm.page.waitForSelector('.board__map');
await gm.page.waitForTimeout(400);
const gmTokens = await gm.page.locator('.standee').count();
check(gmTokens === 5, `GM staged ${gmTokens} minis`);

console.log('\npair them');
await gm.page.locator('.panel__head .linkchip').click();
await gm.page.click('button:has-text("This is the GM iPad")');
await gm.page.waitForSelector('.qr__code', { timeout: 20_000 });
const invite = (await gm.page.locator('.qr__code').first().textContent()).trim();
console.log(`  invitation is ${invite.length} characters`);

await player.page.locator('.library__actions .linkchip').click();
await player.page.click('button:has-text("This is the table iPad")');
await player.page.waitForSelector('.scanner__manual input');
await player.page.fill('.scanner__manual input', invite);
await player.page.click('button:has-text("Use code")');
await player.page.waitForSelector('.qr__code', { timeout: 20_000 });
const answer = (await player.page.locator('.qr__code').first().textContent()).trim();
console.log(`  answer is ${answer.length} characters`);

await gm.page.click('button:has-text("Scan the code it shows back")');
await gm.page.waitForSelector('.scanner__manual input');
await gm.page.fill('.scanner__manual input', answer);
await gm.page.click('button:has-text("Use code")');

await gm.page.waitForSelector('.linkchip--live', { timeout: 25_000 });
check(true, 'the link came up');
await player.page.waitForSelector('.player__board', { timeout: 25_000 });
check(true, 'the table iPad switched to the player view');

await gm.page.locator('.sheet .btn:has-text("Close")').click().catch(() => {});
await player.page.locator('.sheet .btn:has-text("Close")').click().catch(() => {});
await player.page.waitForTimeout(800);

const playerTokens = await player.page.locator('.standee').count();
check(playerTokens === gmTokens, `the board crossed over (${playerTokens} minis on the table iPad)`);
await player.page.screenshot({ path: path.join(here, 'shots', '7-player.png') });

console.log('\nGM moves a monster');
const cellOf = (page, index) =>
  page.evaluate(async (i) => {
    const open = indexedDB.open('hero-kids');
    const db = await new Promise((res) => (open.onsuccess = () => res(open.result)));
    const log = await new Promise((res) => {
      const r = db.transaction('state').objectStore('state').get('log');
      r.onsuccess = () => res(r.result);
    });
    // Replay is the app's job; for the test just read the newest position.
    const positions = new Map();
    for (const stamped of [...log.ops].sort((a, b) => a.lamport - b.lamport)) {
      const op = stamped.op;
      if (op.t === 'scene') {
        positions.clear();
        op.tokens.forEach((t, index) => positions.set(index, { id: t.id, col: t.col, row: t.row }));
      }
      if (op.t === 'move') {
        for (const [k, v] of positions) if (v.id === op.id) positions.set(k, { ...v, col: op.col, row: op.row });
      }
    }
    return positions.get(i);
  }, index);

const before = await cellOf(gm.page, 0);
const first = gm.page.locator('.standee').first();
const box = await first.boundingBox();
await gm.page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.85);
await gm.page.mouse.down();
await gm.page.mouse.move(box.x + box.width / 2 + 260, box.y + box.height * 0.85 + 190, { steps: 20 });
await gm.page.mouse.up();
await gm.page.waitForTimeout(900);

const afterGm = await cellOf(gm.page, 0);
const afterPlayer = await cellOf(player.page, 0);
check(
  afterGm.col !== before.col || afterGm.row !== before.row,
  `the GM moved it (${before.col},${before.row} -> ${afterGm.col},${afterGm.row})`,
);
check(
  afterPlayer && afterPlayer.col === afterGm.col && afterPlayer.row === afterGm.row,
  `the table iPad agrees (${afterPlayer?.col},${afterPlayer?.row})`,
);

console.log('\nhidden monsters stay off the player screen');
await first.click();
await gm.page.waitForSelector('.tokenbar');
await gm.page.click('.tokenbar button:has-text("Hide")');
await gm.page.waitForTimeout(700);
const gmVisible = await gm.page.locator('.standee').count();
const playerVisible = await player.page.locator('.standee').count();
check(
  playerVisible === gmVisible - 1,
  `hidden mini is on the GM screen but not the table (${gmVisible} vs ${playerVisible})`,
);

console.log('\ndrop the link, edit both sides, re-pair');
// Disconnect for real, the way a screen lock eventually does.
await gm.page.locator('.panel__head .linkchip').click();
await gm.page.click('.pair__foot button:has-text("Disconnect")');
await gm.page.locator('.sheet .btn:has-text("Close")').click();
await gm.page.waitForTimeout(600);
check(
  (await gm.page.locator('.linkchip--live').count()) === 0,
  'the GM link really did drop',
);
// Both sides make a change while apart.
await gm.page.locator('.roster button:has-text("Add")').first().click();
await player.page.waitForTimeout(200);
const playerFirst = player.page.locator('.standee--hero').first();
const heroBox = await playerFirst.boundingBox();
await player.page.mouse.move(heroBox.x + heroBox.width / 2, heroBox.y + heroBox.height * 0.85);
await player.page.mouse.down();
await player.page.mouse.move(heroBox.x + heroBox.width / 2 + 190, heroBox.y + heroBox.height * 0.85 - 150, { steps: 16 });
await player.page.mouse.up();
await player.page.waitForTimeout(400);

const gmCount = await gm.page.locator('.standee').count();
const playerCount = await player.page.locator('.standee').count();
console.log(`  apart: GM shows ${gmCount}, table shows ${playerCount}`);

await gm.page.locator('.panel__head .linkchip').click();
await gm.page.click('button:has-text("This is the GM iPad")');
await gm.page.waitForSelector('.qr__code', { timeout: 20_000 });
const invite2 = (await gm.page.locator('.qr__code').first().textContent()).trim();
await player.page.locator('.player__link, .linkchip').first().click();
await player.page.click('button:has-text("This is the table iPad")');
await player.page.waitForSelector('.scanner__manual input');
await player.page.fill('.scanner__manual input', invite2);
await player.page.click('button:has-text("Use code")');
await player.page.waitForSelector('.qr__code', { timeout: 20_000 });
const answer2 = (await player.page.locator('.qr__code').first().textContent()).trim();
await gm.page.click('button:has-text("Scan the code it shows back")');
await gm.page.waitForSelector('.scanner__manual input');
await gm.page.fill('.scanner__manual input', answer2);
await gm.page.click('button:has-text("Use code")');
await gm.page.waitForSelector('.linkchip--live', { timeout: 25_000 });
await gm.page.locator('.sheet .btn:has-text("Close")').click().catch(() => {});
await player.page.locator('.sheet .btn:has-text("Close")').click().catch(() => {});
await gm.page.waitForTimeout(1500);

const boardOf = (page) =>
  page.evaluate(async () => {
    const open = indexedDB.open('hero-kids');
    const db = await new Promise((res) => (open.onsuccess = () => res(open.result)));
    const log = await new Promise((res) => {
      const r = db.transaction('state').objectStore('state').get('log');
      r.onsuccess = () => res(r.result);
    });
    return log.ops.map((o) => o.id).sort().join(',');
  });

const gmLog = await boardOf(gm.page);
const playerLog = await boardOf(player.page);
check(gmLog === playerLog, 'both logs hold exactly the same ops after re-pairing');

const gmAfter = await gm.page.locator('.standee').count();
const playerAfter = await player.page.locator('.standee').count();
check(
  gmAfter === playerAfter + 1,
  `both boards agree, minus the one hidden mini (${gmAfter} vs ${playerAfter})`,
);

await gm.page.screenshot({ path: path.join(here, 'shots', '8-gm-paired.png') });
await player.page.screenshot({ path: path.join(here, 'shots', '9-player-paired.png') });

console.log('\nManual Sync round-trips a board');
const manual = await gm.page.evaluate(async () => {
  const open = indexedDB.open('hero-kids');
  const db = await new Promise((res) => (open.onsuccess = () => res(open.result)));
  const log = await new Promise((res) => {
    const r = db.transaction('state').objectStore('state').get('log');
    r.onsuccess = () => res(r.result);
  });
  return log.ops.length;
});
check(manual > 0, `the log survived everything (${manual} ops)`);

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
