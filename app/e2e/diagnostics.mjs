/**
 * The pairing check, checked.
 *
 * Its whole job is to be trustworthy when someone is standing in a kitchen
 * wondering why two iPads won't talk — so it needs to give the right answer in
 * both directions: green when the browser is behaving, and specific when it
 * isn't. Here it is run with the camera granted and again with it blocked.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { serveDist } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packs = [
  path.join(here, '../../packs/hero-kids-fantasy-rpg.hkpack'),
  path.join(here, '../../packs/hero-kids-adventure-basement-o-rats.hkpack'),
];

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const site = await serveDist();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  // A fake camera device, but NOT --use-fake-ui-for-media-stream: that would
  // auto-grant and make the "camera refused" half of this test meaningless.
  args: ['--no-sandbox', '--use-fake-device-for-media-stream'],
});

async function report({ camera }) {
  const context = await browser.newContext({
    viewport: { width: 1194, height: 834 },
    permissions: camera ? ['camera'] : [],
  });
  const page = await context.newPage();
  await page.goto(site.url, { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type=file]', packs);
  await page.waitForSelector('.encounters__row', { timeout: 30_000 });
  await page.locator('.library__actions .linkchip').click();
  await page.click('button:has-text("Run a check")');
  await page.waitForSelector('.diag li', { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('.diag li').length >= 7, { timeout: 30_000 });

  const findings = await page.evaluate(() =>
    [...document.querySelectorAll('.diag li')].map((li) => ({
      label: li.querySelector('b').textContent,
      detail: li.querySelector('span').textContent,
      state: li.className.replace('diag--', ''),
    })),
  );
  return { page, context, findings };
}

console.log('\nwith the camera allowed');
const allowed = await report({ camera: true });
for (const f of allowed.findings) console.log(`    ${f.label}: ${f.detail}`);

const find = (findings, label) => findings.find((f) => f.label === label);
check(find(allowed.findings, 'WebRTC')?.state === 'true', 'WebRTC is reported available');
check(find(allowed.findings, 'Camera')?.state === 'true', 'the camera is reported granted');
check(
  find(allowed.findings, 'Addresses after camera')?.state === 'true',
  'a usable address was found after the camera was granted',
);
check(
  /browser tab/.test(find(allowed.findings, 'Works offline')?.detail ?? ''),
  'it notices this is a browser tab rather than a Home Screen app',
);
await allowed.page.screenshot({ path: path.join(here, 'shots', '10-diagnostics.png') });
await allowed.context.close();

console.log('\nwith the camera blocked');
const blocked = await report({ camera: false });
const camera = find(blocked.findings, 'Camera');
check(camera?.state === 'false', `a refused camera is reported as a failure (${camera?.detail})`);
check(
  /allow camera|Settings|no camera/i.test(camera?.detail ?? ''),
  'and the message says what to do about it',
);
await blocked.context.close();

await browser.close();
site.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
