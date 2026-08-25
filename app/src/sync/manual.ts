/**
 * Manual Sync: the whole board in one QR code.
 *
 * Insurance for the evening when WebRTC cannot work at all — guest Wi-Fi with
 * client isolation turned on blocks device-to-device traffic outright, and no
 * amount of clever signalling gets around it. Showing the board as a code and
 * photographing it with the other iPad is slow, but it always works, and it is
 * the same picture at both ends.
 *
 * The board is sent rather than the op log: a log grows over an evening, a
 * board does not.
 */
import { deflateSync, inflateSync } from 'fflate';
import type { BoardState } from '../types.ts';

const MAGIC = 'HKB1';

/**
 * Field names are most of a token's JSON, and there are a lot of tokens, so
 * they travel as a tuple. Roughly halves the code's density.
 */
type PackedToken = [
  id: string,
  side: 0 | 1,
  name: string,
  packId: string,
  art: string,
  cardId: string,
  col: number,
  row: number,
  health: number,
  hidden: 0 | 1,
];

interface PackedBoard {
  p?: string;
  e?: string;
  m?: string;
  t: PackedToken[];
}

export function packBoard(board: BoardState): string {
  const packed: PackedBoard = {
    p: board.packId,
    e: board.encounter,
    m: board.mapId,
    t: board.tokens.map((token) => [
      token.id,
      token.side === 'hero' ? 0 : 1,
      token.name,
      token.packId,
      token.art ?? '',
      token.cardId ?? '',
      token.col,
      token.row,
      token.health,
      token.hidden ? 1 : 0,
    ]),
  };
  const bytes = deflateSync(new TextEncoder().encode(JSON.stringify(packed)), { level: 9 });
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return MAGIC + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unpackBoard(code: string): BoardState {
  const trimmed = code.trim();
  if (!trimmed.startsWith(MAGIC)) throw new Error('That is not a Hero Kids board code.');
  const body = trimmed.slice(MAGIC.length).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(body.padEnd(Math.ceil(body.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const packed = JSON.parse(new TextDecoder().decode(inflateSync(bytes))) as PackedBoard;

  return {
    packId: packed.p,
    encounter: packed.e,
    mapId: packed.m,
    tokens: packed.t.map(([id, side, name, packId, art, cardId, col, row, health, hidden]) => ({
      id,
      side: side === 0 ? 'hero' : 'monster',
      name,
      packId,
      art: art || undefined,
      cardId: cardId || undefined,
      col,
      row,
      health: health as 0 | 1 | 2 | 3,
      hidden: hidden === 1,
    })),
  };
}
