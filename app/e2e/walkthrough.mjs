/**
 * Walking an adventure the way it is actually run.
 *
 * Reign of the Dragon opens with a conversation, not a fight, and branches at
 * Encounter 4 and again at 7. This drives that route — scene, fight, scene,
 * choose a branch — and checks the app is carrying the book rather than making
 * you keep it open beside the iPad.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { serveDist } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packs = [
  path.join(here, '../../packs/hero-kids-fantasy-rpg.hkpack'),
  path.join(here, '../../packs/hero-kids-adventure-reign-of-the-dragon.hkpack'),
];
mkdirSync(path.join(here, 'shots'), { recursive: true });

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const site = await serveDist();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1194, height: 834 }, hasTouch: true });
page.on('pageerror', (e) => console.log('    [error]', e.message));

await page.goto(site.url, { waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file]', packs);
await page.waitForSelector('.encounters__row', { timeout: 30_000 });
await page.click('button:has-text("Party")');
await page.waitForSelector('.party__card');
await page.locator('.party__card').nth(0).click();
await page.locator('.party__card').nth(2).click();
await page.click('button:has-text("Done")');
await page.waitForSelector('.encounters__row');

const title = () => page.locator('.scene__title').innerText();
const sectionTitles = () =>
  page.evaluate(() => [...document.querySelectorAll('.sect__head')].map((h) => h.innerText.trim().replace(/^[▸▾]\s*/, '').split('\n')[0]));

console.log('\nEncounter 1 — a conversation, no map');
await page.locator('.encounters__button').first().click();
await page.waitForSelector('.scene__title');
check(/Dragon Came to Dinner/.test(await title()), `opened on "${(await title()).replace(/\n/g, ' ')}"`);
check(
  (await page.locator('.scene__fight').count()) === 0,
  'it is not offering to set up a board for a conversation',
);

const sections = await sectionTitles();
console.log('    sections:', sections.join(' · '));
check(sections.includes('Role-Playing'), 'the Role-Playing section is there');

// The whole point: the role-playing prose used to be dropped by the extractor.
// Address it by index — "role-playing" also appears in the intro's prose, so
// matching on text alone picks up two sections.
const rpIndex = sections.indexOf('Role-Playing');
const roleplay = page.locator('.sect').nth(rpIndex);
// It opens by default — a conversation scene's whole content is this section —
// so only click if something has closed it.
if (!(await roleplay.evaluate((el) => el.classList.contains('is-open')))) {
  await roleplay.locator('.sect__head').click();
  await page.waitForTimeout(200);
}
check(
  await roleplay.evaluate((el) => el.classList.contains('is-open')),
  'the Role-Playing section is open on arrival, not folded away',
);
const roleplayText = await roleplay.innerText();
check(
  /Give the beast to us/i.test(roleplayText),
  "the cultist leader's challenge is in the app",
);
check(
  /weaker than I look/i.test(roleplayText),
  "the dragon's warning about fighting is in the app",
);
await page.screenshot({ path: path.join(here, 'shots', '11-scene.png'), fullPage: true });

console.log('\nmove on through the book');
const step = async (expect) => {
  await page.locator('.scene__choice').first().click();
  await page.waitForTimeout(300);
  const t = (await title()).replace(/\n/g, ' ');
  check(new RegExp(expect, 'i').test(t), `arrived at "${t}"`);
};
await step('Defenders of the Beast');

check(
  (await page.locator('.scene__fight').count()) === 1,
  'this one offers to set up the board — it is a fight',
);
await page.click('button:has-text("Set up the board")');
await page.waitForSelector('.board__map', { timeout: 15_000 });
await page.waitForTimeout(500);
check((await page.locator('.standee').count()) > 0, 'the fight is laid out');
await page.screenshot({ path: path.join(here, 'shots', '12-fight.png') });

console.log('\nback to the text without disturbing the board');
await page.click('button:has-text("‹ Scene")');
await page.waitForSelector('.scene__title');
check(/Defenders of the Beast/.test(await title()), 'back on the scene');
await step('Planning the Journey');

console.log('\nthe branch');
const choices = await page.locator('.scene__choice').count();
check(choices === 2, `the book's two routes are offered as buttons (${choices})`);
const labels = await page.locator('.scene__choice span').allInnerTexts();
console.log('    ', labels.join('  |  '));
await page.locator('.scene__choice').nth(1).click();
await page.waitForTimeout(300);
check(/Northern Woods/i.test(await title()), `took the second route to "${(await title()).replace(/\n/g, ' ')}"`);
await page.screenshot({ path: path.join(here, 'shots', '13-branch.png'), fullPage: true });

console.log('\nthe position survives a reload');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.scene__title', { timeout: 15_000 });
check(/Northern Woods/i.test(await title()), 'still on the branch we chose');

await browser.close();
site.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
