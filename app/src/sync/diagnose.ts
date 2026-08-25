/**
 * Working out why pairing didn't work.
 *
 * Pairing depends on a chain of browser behaviours that are invisible when they
 * fail: the page has to be a secure context, the camera has to be granted, and
 * — the subtle one — the browser only stops masking local IP addresses behind
 * `.local` mDNS names *after* a camera or microphone has been granted. If any
 * link breaks, the symptom is the same unhelpful "it didn't connect".
 *
 * So this gathers ICE candidates twice, once before touching the camera and
 * once after, and reports the difference. That single comparison is what turns
 * a failure on an iPad into something actionable.
 */

export interface Finding {
  label: string;
  ok: boolean | 'unknown';
  detail: string;
}

export interface Report {
  findings: Finding[];
  /** plain text, for pasting into a message */
  text: string;
}

const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

interface Gathered {
  host: string[];
  mdns: string[];
  other: string[];
  error?: string;
}

async function gatherCandidates(timeoutMs = 4000): Promise<Gathered> {
  const result: Gathered = { host: [], mdns: [], other: [] };
  let pc: RTCPeerConnection | undefined;
  try {
    pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('probe', { negotiated: true, id: 0 });
    await pc.setLocalDescription(await pc.createOffer());

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      pc!.addEventListener('icegatheringstatechange', () => {
        if (pc!.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      });
      if (pc!.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });

    for (const line of (pc.localDescription?.sdp ?? '').split(/\r?\n/)) {
      if (!line.startsWith('a=candidate:')) continue;
      const parts = line.slice('a=candidate:'.length).split(' ');
      const address = parts[4] ?? '';
      const type = parts[parts.indexOf('typ') + 1] ?? '?';
      if (type !== 'host') result.other.push(`${type} ${address}`);
      else if (IPV4.test(address)) result.host.push(address);
      else if (address.endsWith('.local')) result.mdns.push(address);
      else result.other.push(`host ${address}`);
    }
  } catch (err) {
    result.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  } finally {
    pc?.close();
  }
  return result;
}

function describe(gathered: Gathered): string {
  if (gathered.error) return `failed — ${gathered.error}`;
  const bits: string[] = [];
  if (gathered.host.length) bits.push(`${gathered.host.length} usable (${gathered.host.join(', ')})`);
  if (gathered.mdns.length) bits.push(`${gathered.mdns.length} masked as .local`);
  if (gathered.other.length) bits.push(`${gathered.other.length} other`);
  return bits.length ? bits.join(', ') : 'none at all';
}

export async function runDiagnostics(): Promise<Report> {
  const findings: Finding[] = [];

  // 1. Secure context. Everything else depends on it and the failure is silent.
  findings.push({
    label: 'Secure page',
    ok: window.isSecureContext,
    detail: window.isSecureContext
      ? `yes — ${window.location.origin}`
      : `no — ${window.location.origin}. The camera, offline install and pairing all need https. ` +
        'Install the app from its published address instead of a LAN address.',
  });

  // 2. Is WebRTC even here?
  const hasRtc = typeof RTCPeerConnection !== 'undefined';
  findings.push({
    label: 'WebRTC',
    ok: hasRtc,
    detail: hasRtc ? 'available' : 'this browser has no RTCPeerConnection',
  });

  // 3. Addresses before the camera is granted — expected to be masked.
  const before = hasRtc ? await gatherCandidates() : { host: [], mdns: [], other: [], error: 'skipped' };
  findings.push({
    label: 'Addresses before camera',
    ok: 'unknown',
    detail: describe(before),
  });

  // 4. The camera itself.
  let cameraDetail = 'not attempted';
  let cameraOk: boolean | 'unknown' = 'unknown';
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      cameraOk = true;
      cameraDetail = `granted — ${stream.getVideoTracks()[0]?.label || 'camera'}`;
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      cameraOk = false;
      const name = err instanceof Error ? err.name : 'error';
      cameraDetail =
        name === 'NotAllowedError'
          ? 'refused — allow camera access for this site in Settings, then run this again'
          : `${name} — ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    cameraOk = false;
    cameraDetail = 'this browser exposes no camera API';
  }
  findings.push({ label: 'Camera', ok: cameraOk, detail: cameraDetail });

  // 5. Addresses after the camera — the one that decides whether pairing works.
  const after = hasRtc ? await gatherCandidates() : { host: [], mdns: [], other: [], error: 'skipped' };
  findings.push({
    label: 'Addresses after camera',
    ok: after.host.length > 0,
    detail:
      describe(after) +
      (after.host.length === 0
        ? ' — pairing cannot work without a usable address. Both iPads must be on the same Wi-Fi, ' +
          'and the camera must be granted to this exact site.'
        : ''),
  });

  // 6. Offline install.
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  const sw = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  // Judged on the cache, not on being on the Home Screen: a browser tab with a
  // warm cache still works offline, and flagging that red during development
  // would cry wolf.
  findings.push({
    label: 'Works offline',
    ok: Boolean(sw),
    detail: `${sw ? 'offline cache ready' : 'no offline cache yet'}, ${
      standalone ? 'running from the Home Screen' : 'running in a browser tab'
    }`,
  });

  // 7. Nice to have, not fatal.
  findings.push({
    label: 'Keeps the screen awake',
    ok: 'wakeLock' in navigator,
    detail: 'wakeLock' in navigator ? 'supported' : 'not supported — the screen may sleep and drop the link',
  });

  const text = [
    'Hero Kids pairing check',
    new Date().toISOString(),
    navigator.userAgent,
    '',
    ...findings.map(
      (f) => `${f.ok === true ? '[ok]  ' : f.ok === false ? '[FAIL]' : '[info]'} ${f.label}: ${f.detail}`,
    ),
  ].join('\n');

  return { findings, text };
}
