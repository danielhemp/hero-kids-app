/**
 * The board as an append-only log of stamped operations.
 *
 * Two iPads on a kitchen table are a distributed system with a terrible
 * network: iOS suspends WebRTC the moment a screen locks, and the transport
 * fails about thirty seconds later. Storing the board as edits rather than as a
 * picture means a reconnection is a merge instead of a decision about whose
 * screen was right — both sides replay every op they have, in the same order,
 * and land in the same place.
 *
 * Ordering is a Lamport clock with the actor id as the tie-break, so it is
 * total and identical on both devices. Last write wins; conflicts are rare in
 * practice because the GM moves monsters and the kids move heroes.
 */
import type { BoardState, Health, Token } from '../types.ts';

export type Op =
  /** wipe the board and set up an encounter — the only op that drops history */
  | { t: 'scene'; packId: string; encounter: string; mapId: string; tokens: Token[] }
  | { t: 'map'; mapId: string }
  | { t: 'add'; token: Token }
  | { t: 'remove'; id: string }
  | { t: 'move'; id: string; col: number; row: number }
  | { t: 'health'; id: string; h: Health }
  | { t: 'hidden'; id: string; v: boolean }
  | { t: 'art'; id: string; art?: string };

export interface StampedOp {
  /** unique per op, so both sides can tell what the other already has */
  id: string;
  lamport: number;
  actor: string;
  op: Op;
}

export interface LogState {
  actor: string;
  lamport: number;
  ops: StampedOp[];
}

export function newLog(actor: string): LogState {
  return { actor, lamport: 0, ops: [] };
}

/** Total order, identical on both devices. */
export function compareOps(a: StampedOp, b: StampedOp): number {
  return a.lamport - b.lamport || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

let sequence = 0;
function opId(actor: string): string {
  sequence += 1;
  return `${actor}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

/** Stamp a local edit and append it. */
export function commit(log: LogState, op: Op): { log: LogState; stamped: StampedOp } {
  const lamport = log.lamport + 1;
  const stamped: StampedOp = { id: opId(log.actor), lamport, actor: log.actor, op };
  return { log: { ...log, lamport, ops: compact([...log.ops, stamped]) }, stamped };
}

/**
 * Fold in ops from the other device. The clock jumps past anything we receive so
 * our next edit sorts after it, which is the whole point of a Lamport clock.
 */
export function receive(log: LogState, incoming: StampedOp[]): LogState {
  const known = new Set(log.ops.map((o) => o.id));
  const fresh = incoming.filter((o) => !known.has(o.id));
  if (fresh.length === 0) return log;

  const lamport = Math.max(log.lamport, ...fresh.map((o) => o.lamport));
  return { ...log, lamport, ops: compact([...log.ops, ...fresh]) };
}

/**
 * Everything before the newest `scene` is history of a fight that is over, so
 * drop it. Without this the log grows for the length of a whole adventure and
 * every reconnection ships all of it.
 */
function compact(ops: StampedOp[]): StampedOp[] {
  const sorted = [...ops].sort(compareOps);
  let lastScene = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]!.op.t === 'scene') {
      lastScene = i;
      break;
    }
  }
  return lastScene <= 0 ? sorted : sorted.slice(lastScene);
}

const EMPTY: BoardState = { tokens: [] };

/** Replay the log into the board everyone sees. */
export function materialise(ops: StampedOp[]): BoardState {
  let state: BoardState = EMPTY;
  for (const stamped of [...ops].sort(compareOps)) {
    state = apply(state, stamped.op);
  }
  return state;
}

function apply(state: BoardState, op: Op): BoardState {
  switch (op.t) {
    case 'scene':
      return { packId: op.packId, encounter: op.encounter, mapId: op.mapId, tokens: op.tokens };
    case 'map':
      return { ...state, mapId: op.mapId };
    case 'add':
      // Replaying a log must be idempotent: the same add can arrive twice if a
      // reconnection overlaps a broadcast.
      return state.tokens.some((t) => t.id === op.token.id)
        ? state
        : { ...state, tokens: [...state.tokens, op.token] };
    case 'remove':
      return { ...state, tokens: state.tokens.filter((t) => t.id !== op.id) };
    case 'move':
      return patch(state, op.id, { col: op.col, row: op.row });
    case 'health':
      return patch(state, op.id, { health: op.h });
    case 'hidden':
      return patch(state, op.id, { hidden: op.v });
    case 'art':
      return patch(state, op.id, { art: op.art });
    default:
      return state;
  }
}

function patch(state: BoardState, id: string, change: Partial<Token>): BoardState {
  if (!state.tokens.some((t) => t.id === id)) return state;
  return { ...state, tokens: state.tokens.map((t) => (t.id === id ? { ...t, ...change } : t)) };
}

/** A short, stable id for this device, so ordering is deterministic. */
export function makeActorId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}
