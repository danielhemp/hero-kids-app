/**
 * Does a WebRTC data channel actually come up from the compacted QR payload?
 *
 * This is the load-bearing assumption of the whole two-iPad design: that an
 * offer can be reduced to ~70 bytes and rebuilt into an SDP the other end will
 * accept. If that is wrong, the pairing UI is wasted work — so it gets tested
 * on its own, before anything is built on top of it.
 *
 * Chromium is not Safari and this cannot prove iPadOS will behave. What it can
 * prove is that the packing is lossless, the template is well-formed, and the
 * handshake completes with no STUN, no TURN and no signalling server.
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

// Bundle the real signalling module — testing a copy would prove nothing.
const bundle = await build({
  entryPoints: [path.join(here, '../src/sync/signal.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'HKSignal',
  write: false,
  target: 'es2022',
});
const signalJs = bundle.outputFiles[0].text;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const context = await browser.newContext();
// Grant the camera so the browser publishes real host candidates rather than
// mDNS `.local` names — the same permission the app asks for before pairing.
await context.grantPermissions(['camera']);
const page = await context.newPage();
page.on('pageerror', (e) => console.log('    [page error]', e.message));
await page.goto('about:blank');
await page.addScriptTag({ content: signalJs });

const result = await page.evaluate(async () => {
  const { packSignal, unpackSignal, readSdp, writeSdp, toCode, fromCode } = window.HKSignal;
  const log = [];

  const host = new RTCPeerConnection({ iceServers: [] });
  const guest = new RTCPeerConnection({ iceServers: [] });
  const hostChannel = host.createDataChannel('board', { negotiated: true, id: 0 });
  const guestChannel = guest.createDataChannel('board', { negotiated: true, id: 0 });

  const gathered = (pc) =>
    pc.iceGatheringState === 'complete'
      ? Promise.resolve()
      : new Promise((resolve) => {
          const timer = setTimeout(resolve, 3000);
          pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') {
              clearTimeout(timer);
              resolve();
            }
          });
        });

  // --- host makes an invitation -------------------------------------------
  await host.setLocalDescription(await host.createOffer());
  await gathered(host);
  const originalOffer = host.localDescription.sdp;
  const offerSignal = readSdp(originalOffer, 'offer');
  const offerBytes = packSignal(offerSignal);
  const offerCode = toCode(offerBytes);

  log.push({ what: 'offer', sdpBytes: originalOffer.length, packed: offerBytes.length, code: offerCode.length, candidates: offerSignal.candidates.length });

  // --- guest answers -------------------------------------------------------
  const decodedOffer = unpackSignal(fromCode(offerCode));
  await guest.setRemoteDescription({ type: 'offer', sdp: writeSdp(decodedOffer) });
  await guest.setLocalDescription(await guest.createAnswer());
  await gathered(guest);
  const answerSignal = readSdp(guest.localDescription.sdp, 'answer');
  const answerBytes = packSignal(answerSignal);
  const answerCode = toCode(answerBytes);
  log.push({ what: 'answer', sdpBytes: guest.localDescription.sdp.length, packed: answerBytes.length, code: answerCode.length, candidates: answerSignal.candidates.length });

  // --- host accepts --------------------------------------------------------
  await host.setRemoteDescription({ type: 'answer', sdp: writeSdp(unpackSignal(fromCode(answerCode))) });

  const opened = await Promise.race([
    Promise.all([
      new Promise((r) => (hostChannel.readyState === 'open' ? r(true) : (hostChannel.onopen = () => r(true)))),
      new Promise((r) => (guestChannel.readyState === 'open' ? r(true) : (guestChannel.onopen = () => r(true)))),
    ]).then(() => true),
    new Promise((r) => setTimeout(() => r(false), 12_000)),
  ]);

  let echoed = null;
  if (opened) {
    echoed = await new Promise((resolve) => {
      guestChannel.onmessage = (e) => guestChannel.send(`echo:${e.data}`);
      hostChannel.onmessage = (e) => resolve(e.data);
      hostChannel.send('rats');
      setTimeout(() => resolve(null), 5000);
    });
  }

  // Round-trip fidelity: what came out of the code must be what went in.
  const same =
    JSON.stringify({ ...offerSignal, fingerprint: [...offerSignal.fingerprint] }) ===
    JSON.stringify({ ...decodedOffer, fingerprint: [...decodedOffer.fingerprint] });

  return { log, opened, echoed, same, ice: host.iceConnectionState };
});

for (const entry of result.log) {
  console.log(
    `  ${entry.what}: ${entry.sdpBytes} byte SDP -> ${entry.packed} bytes packed -> ` +
      `${entry.code} chars of QR text (${entry.candidates} candidate${entry.candidates === 1 ? '' : 's'})`,
  );
}

check(result.same, 'the packed code round-trips without losing anything');
for (const entry of result.log) {
  check(entry.packed < 200, `${entry.what} fits in a scannable code (${entry.packed} bytes)`);
}
check(result.opened, `the data channel opened (ice: ${result.ice})`);
check(result.echoed === 'echo:rats', `a message crossed the link (got ${JSON.stringify(result.echoed)})`);

await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nPairing spike passed');
process.exit(failures.length ? 1 : 0);
