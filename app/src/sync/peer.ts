/**
 * The link between the two iPads.
 *
 * A direct WebRTC data channel with no STUN, no TURN and no signalling server —
 * the two devices are on the same Wi-Fi and exchange their connection details by
 * showing each other a QR code. Everything here is shaped by three facts about
 * iPads:
 *
 *  1. Browsers hide local IP addresses behind `.local` mDNS names until a page
 *     has camera or microphone permission, so we ask for the camera first.
 *  2. iOS suspends WebRTC when a screen locks, and the transport dies about
 *     thirty seconds later. The connection is therefore disposable: the op log
 *     in IndexedDB is the truth, and re-pairing is a five-second re-scan.
 *  3. `iceConnectionState` lies after a suspension, so liveness is an
 *     application-level heartbeat instead.
 */
import { packSignal, readSdp, SignalError, unpackSignal, writeSdp, toCode, fromCode } from './signal.ts';
import type { StampedOp } from './oplog.ts';

export type PeerRole = 'gm' | 'player';

export type Message =
  | { t: 'hello'; actor: string; role: PeerRole; session: string }
  | { t: 'ops'; ops: StampedOp[] }
  | { t: 'ping' }
  | { t: 'pong' };

export type LinkState = 'idle' | 'pairing' | 'connecting' | 'live' | 'lost';

export interface PeerEvents {
  onState: (state: LinkState, detail?: string) => void;
  onMessage: (message: Message) => void;
}

const GATHER_TIMEOUT_MS = 3000;
const HEARTBEAT_MS = 4000;
const SILENCE_MS = 13_000;

/**
 * Ask for the camera before building the connection. Two things fall out of
 * this: the scanner has a stream ready, and — the part that matters — the page
 * becomes allowed to see real local IP addresses, without which the QR payload
 * would carry unresolvable `.local` names.
 */
export async function unlockLocalAddresses(): Promise<MediaStream | undefined> {
  if (!navigator.mediaDevices?.getUserMedia) return undefined;
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch {
    // Pairing can still work if the browser happens to publish host candidates
    // anyway; readSdp() gives a clear error if it does not.
    return undefined;
  }
}

function waitForGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    // Trickle ICE has nowhere to trickle to, so we wait for the full set — but
    // not for ever: on a quiet network the last candidate can hang.
    const timer = setTimeout(done, GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export class Peer {
  readonly role: PeerRole;
  readonly session: string;
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel;
  private events: PeerEvents;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastHeard = 0;
  private state: LinkState = 'idle';

  private constructor(role: PeerRole, session: string, events: PeerEvents) {
    this.role = role;
    this.session = session;
    this.events = events;
    // No ICE servers at all: everything is on one Wi-Fi network, and a STUN
    // lookup would only add a candidate that cannot be reached and bloat the QR.
    this.pc = new RTCPeerConnection({ iceServers: [] });
    // A pre-negotiated channel means neither side waits for the other to
    // announce it, which removes a whole class of ordering bug from a handshake
    // that is already being carried by a camera.
    this.channel = this.pc.createDataChannel('board', { negotiated: true, id: 0, ordered: true });
    this.channel.onopen = () => this.onOpen();
    this.channel.onclose = () => this.setState('lost', 'The link closed.');
    this.channel.onmessage = (event) => this.onData(event.data);
  }

  private setState(state: LinkState, detail?: string) {
    if (this.state === state) return;
    this.state = state;
    this.events.onState(state, detail);
  }

  private onOpen() {
    this.lastHeard = Date.now();
    this.setState('live');
    this.heartbeat = setInterval(() => {
      if (this.channel.readyState !== 'open') return;
      this.send({ t: 'ping' });
      // Don't trust iceConnectionState after a suspension — it can sit on
      // "connected" long after nothing is getting through.
      if (Date.now() - this.lastHeard > SILENCE_MS) {
        this.setState('lost', 'No answer from the other iPad. Pair again to catch up.');
      }
    }, HEARTBEAT_MS);
  }

  private onData(raw: unknown) {
    if (typeof raw !== 'string') return;
    this.lastHeard = Date.now();
    let message: Message;
    try {
      message = JSON.parse(raw) as Message;
    } catch {
      return;
    }
    if (message.t === 'ping') {
      this.send({ t: 'pong' });
      return;
    }
    if (message.t === 'pong') return;
    if (this.state !== 'live') this.setState('live');
    this.events.onMessage(message);
  }

  send(message: Message): void {
    if (this.channel.readyState !== 'open') return;
    this.channel.send(JSON.stringify(message));
  }

  get connected(): boolean {
    return this.channel.readyState === 'open';
  }

  close(): void {
    clearInterval(this.heartbeat);
    try {
      this.channel.close();
      this.pc.close();
    } catch {
      // closing twice is not interesting
    }
    this.setState('idle');
  }

  /** The GM iPad starts here and shows the resulting code. */
  static async host(session: string, events: PeerEvents): Promise<{ peer: Peer; code: string }> {
    const peer = new Peer('gm', session, events);
    peer.setState('pairing');
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    await waitForGathering(peer.pc);
    const sdp = peer.pc.localDescription?.sdp ?? offer.sdp ?? '';
    return { peer, code: toCode(packSignal(readSdp(sdp, 'offer'))) };
  }

  /** The player iPad scans the GM's code and answers with one of its own. */
  static async join(
    session: string,
    offerCode: string,
    events: PeerEvents,
  ): Promise<{ peer: Peer; code: string }> {
    const offer = unpackSignal(fromCode(offerCode));
    if (offer.role !== 'offer') throw new SignalError('That is an answer code, not an invitation.');

    const peer = new Peer('player', session, events);
    peer.setState('connecting');
    await peer.pc.setRemoteDescription({ type: 'offer', sdp: writeSdp(offer) });
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    await waitForGathering(peer.pc);
    const sdp = peer.pc.localDescription?.sdp ?? answer.sdp ?? '';
    return { peer, code: toCode(packSignal(readSdp(sdp, 'answer'))) };
  }

  /** The GM scans the player's answer to finish the handshake. */
  async accept(answerCode: string): Promise<void> {
    const answer = unpackSignal(fromCode(answerCode));
    if (answer.role !== 'answer') {
      throw new SignalError('That is an invitation code, not an answer.');
    }
    this.setState('connecting');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: writeSdp(answer) });
  }
}
