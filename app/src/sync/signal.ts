/**
 * Squeezing a WebRTC offer into a QR code.
 *
 * A data-channel SDP is around 2.5KB. That needs a QR code so dense that one
 * iPad cannot reliably read it off another iPad's screen, so we don't send the
 * SDP: we send the four things that actually vary — DTLS fingerprint, ICE
 * credentials and host candidates — and rebuild the SDP from a template at the
 * far end. That lands at roughly 70 bytes, a QR code that scans in a moment.
 *
 * This depends on the browser publishing real host IP addresses. WebKit and
 * Chromium both hide them behind `.local` mDNS names until the page has been
 * granted camera or microphone access — which is why pairing asks for the
 * camera *before* creating the peer connection, not when it opens the scanner.
 */

const MAGIC = 0x48; // 'H'
const VERSION = 1;

export type SignalRole = 'offer' | 'answer';

export interface Signal {
  role: SignalRole;
  fingerprint: Uint8Array; // 32 bytes, sha-256
  ufrag: string;
  pwd: string;
  candidates: { ip: string; port: number }[];
}

export class SignalError extends Error {}

// --- reading an SDP ---------------------------------------------------------

function line(sdp: string, prefix: string): string | undefined {
  for (const l of sdp.split(/\r?\n/)) {
    if (l.startsWith(prefix)) return l.slice(prefix.length).trim();
  }
  return undefined;
}

const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function readSdp(sdp: string, role: SignalRole): Signal {
  const fingerprintLine = line(sdp, 'a=fingerprint:sha-256 ');
  if (!fingerprintLine) throw new SignalError('This browser did not offer a SHA-256 fingerprint.');
  const fingerprint = Uint8Array.from(
    fingerprintLine.split(':').map((h) => Number.parseInt(h, 16)),
  );
  if (fingerprint.length !== 32) throw new SignalError('Unexpected fingerprint length.');

  const ufrag = line(sdp, 'a=ice-ufrag:');
  const pwd = line(sdp, 'a=ice-pwd:');
  if (!ufrag || !pwd) throw new SignalError('This browser did not offer ICE credentials.');

  const candidates: { ip: string; port: number }[] = [];
  for (const l of sdp.split(/\r?\n/)) {
    const raw = l.startsWith('a=candidate:') ? l.slice('a=candidate:'.length) : null;
    if (!raw) continue;
    const parts = raw.split(' ');
    // foundation component transport priority ip port typ <type>
    const ip = parts[4];
    const port = Number(parts[5]);
    const type = parts[parts.indexOf('typ') + 1];
    if (type !== 'host' || !ip || !IPV4.test(ip) || !Number.isFinite(port)) continue;
    if (candidates.some((c) => c.ip === ip && c.port === port)) continue;
    candidates.push({ ip, port });
  }

  if (candidates.length === 0) {
    throw new SignalError(
      'No local network address was offered. Allow camera access and try pairing again — ' +
        'browsers hide the address until a page has been granted a camera or microphone.',
    );
  }

  // Three is plenty: more only makes the code denser without helping ICE.
  return { role, fingerprint, ufrag, pwd, candidates: candidates.slice(0, 3) };
}

// --- the wire format --------------------------------------------------------

function writeString(out: number[], value: string) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 255) throw new SignalError('ICE credential too long to encode.');
  out.push(bytes.length, ...bytes);
}

export function packSignal(signal: Signal): Uint8Array {
  const out: number[] = [MAGIC, VERSION | (signal.role === 'answer' ? 0x10 : 0)];
  out.push(...signal.fingerprint);
  writeString(out, signal.ufrag);
  writeString(out, signal.pwd);
  out.push(signal.candidates.length);
  for (const candidate of signal.candidates) {
    for (const octet of candidate.ip.split('.')) out.push(Number(octet) & 0xff);
    out.push((candidate.port >> 8) & 0xff, candidate.port & 0xff);
  }
  return Uint8Array.from(out);
}

export function unpackSignal(bytes: Uint8Array): Signal {
  if (bytes.length < 40 || bytes[0] !== MAGIC) {
    throw new SignalError('That code is not a Hero Kids pairing code.');
  }
  const flags = bytes[1]!;
  if ((flags & 0x0f) !== VERSION) {
    throw new SignalError('That code came from a different version of the app.');
  }
  const role: SignalRole = flags & 0x10 ? 'answer' : 'offer';

  let at = 2;
  const fingerprint = bytes.slice(at, at + 32);
  at += 32;

  const decoder = new TextDecoder();
  const ufragLength = bytes[at++]!;
  const ufrag = decoder.decode(bytes.slice(at, at + ufragLength));
  at += ufragLength;
  const pwdLength = bytes[at++]!;
  const pwd = decoder.decode(bytes.slice(at, at + pwdLength));
  at += pwdLength;

  const count = bytes[at++]!;
  const candidates: { ip: string; port: number }[] = [];
  for (let i = 0; i < count; i++) {
    const ip = [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]].join('.');
    const port = (bytes[at + 4]! << 8) | bytes[at + 5]!;
    at += 6;
    candidates.push({ ip, port });
  }

  return { role, fingerprint, ufrag, pwd, candidates };
}

// --- rebuilding an SDP ------------------------------------------------------

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/**
 * The template is fixed because both ends are this same app. Only the parts
 * that carry identity travel; everything else is boilerplate that every
 * data-channel-only session shares.
 */
export function writeSdp(signal: Signal): string {
  const setup = signal.role === 'offer' ? 'actpass' : 'active';
  const lines = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=ice-ufrag:' + signal.ufrag,
    'a=ice-pwd:' + signal.pwd,
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 ' + hex(signal.fingerprint),
    'a=setup:' + setup,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ];
  signal.candidates.forEach((candidate, index) => {
    lines.push(
      `a=candidate:${index + 1} 1 udp ${2130706431 - index} ${candidate.ip} ${candidate.port} typ host`,
    );
  });
  lines.push('a=end-of-candidates');
  return lines.join('\r\n') + '\r\n';
}

// --- text form for the QR ---------------------------------------------------

export function toCode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromCode(code: string): Uint8Array {
  const normalised = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
