/**
 * Looking a rule up in the middle of a fight.
 *
 * This is the question that sends a GM back to the printed book — "how does
 * knocked out work again?" — asked with four children waiting. So the check is
 * not only that the rulebook is in the app, but that reaching it costs the board
 * nothing: same map, same minis, same damage, when the sheet closes.
 *
 *   node e2e/rules.mjs [--headed]
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { serveDist } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packs = [
  path.join(here, '../../packs/hero-kids-fantasy-rpg.hkpack'),
  path.join(here, '../../packs/hero-kids-adventure-basement-o-rats.hkpack'),
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
  headless: !process.argv.includes('--headed'),
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

console.log('\nthe rulebook came through');
await page.click('.library__actions button:has-text("Rules")');
await page.waitForSelector('.rules');
const chapters = await page.locator('.rules__toc li').count();
check(chapters >= 15, `${chapters} chapters listed`);
const titles = await page.locator('.rules__toc b').allInnerTexts();
console.log('    ', titles.join(' · '));
check(
  titles.some((t) => /Rolling for Stuff/i.test(t)) && titles.some((t) => /Glossary/i.test(t)),
  'the chapters run from the rules of play through to the glossary',
);
check(
  !titles.some((t) => /^[A-Z !]+$/.test(t)),
  'no chapter is still shouting in the small caps the book set it in',
);
check(
  !titles.some((t) => t.length < 4),
  'no chapter is a stray drop cap — the "C" of CREDITS used to become one',
);
await page.screenshot({ path: path.join(here, 'shots', '14-rules.png'), fullPage: true });

console.log('\na chapter reads as printed');
await page.locator('.rules__toc button', { hasText: 'Health and Damage' }).click();
await page.waitForSelector('.rules__chapter');
const chapter = await page.locator('.rules').innerText();
check(/Knocked Out/i.test(chapter), 'its sub-headings are there');
check(/health boxes/i.test(chapter), 'and the prose under them');
await page.locator('button:has-text("‹ All chapters")').click();

console.log('\nsearch');
await page.fill('.rules__search', 'potion');
await page.waitForTimeout(300);
const hits = await page.locator('.rules__hit').count();
check(hits > 0, `"potion" finds ${hits} passage${hits === 1 ? '' : 's'}`);
check(
  /Potions/i.test(await page.locator('.rules__hit').first().innerText()),
  'the section actually headed "Potions" is ranked first, not a passing mention',
);
check(
  (await page.locator('.rules__hit .sect.is-open').count()) > 0,
  'a search result is open — the passage is the answer, not another thing to tap',
);
await page.screenshot({ path: path.join(here, 'shots', '15-rules-search.png'), fullPage: true });
await page.fill('.rules__search', 'zzzzz');
await page.waitForTimeout(300);
check(
  /Nothing in the rulebook matches/.test(await page.locator('.rules').innerText()),
  'and a miss says so rather than showing an empty box',
);
await page.locator('.rules button:has-text("Close")').click();

console.log('\nnow do it mid-fight');
await page.locator('.encounters__button').first().click();
await page.waitForSelector('.scene__title');
await page.click('button:has-text("Set up the board")');
await page.waitForSelector('.board__map', { timeout: 15_000 });
await page.waitForTimeout(500);

// Bank the state of the fight, damage included, then go and read a rule.
await page.locator('.standee').first().click();
await page.waitForSelector('.tokenbar');
await page.locator('.tokenbar .pip', { hasText: 'KO' }).click();
await page.waitForTimeout(200);
const before = await page.evaluate(() =>
  [...document.querySelectorAll('.standee')].map((s) => `${s.className}@${s.style.transform}`).join('|'),
);
check(before.includes('is-ko'), 'a mini is marked KO before we go looking');

await page.click('.panel__head button:has-text("Rules")');
await page.waitForSelector('.rules');
await page.fill('.rules__search', 'knocked out');
await page.waitForTimeout(300);
const answer = await page.locator('.rules__hits').innerText();
check(/knocked out/i.test(answer), 'the rule is on screen over the board');
check(
  await page.locator('.board__map').isVisible(),
  'and the fight is still underneath rather than replaced',
);
await page.screenshot({ path: path.join(here, 'shots', '16-rules-midfight.png') });

await page.locator('.rules button:has-text("Close")').click();
await page.waitForTimeout(300);
const after = await page.evaluate(() =>
  [...document.querySelectorAll('.standee')].map((s) => `${s.className}@${s.style.transform}`).join('|'),
);
check(after === before, 'closing it leaves every mini exactly where it was, damage included');

console.log('\nand from a conversation scene');
await page.click('button:has-text("‹ Scene")');
await page.waitForSelector('.scene__title');
await page.click('.scene__tools button:has-text("Rules")');
await page.waitForSelector('.rules');
check(await page.locator('.rules__toc').isVisible(), 'the same sheet opens from the book screen');

await browser.close();
site.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
