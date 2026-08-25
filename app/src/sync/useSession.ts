/**
 * One hook that owns the board, the log and the link to the other iPad.
 *
 * Local edits and edits arriving over the wire take exactly the same path —
 * both become stamped ops appended to the log, and the board is always the
 * replay of that log. There is no separate "apply a remote change" code path to
 * get subtly wrong.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardState } from '../types.ts';
import { loadLog, loadRole, saveLog, saveRole } from '../store/db.ts';
import {
  commit,
  makeActorId,
  materialise,
  newLog,
  receive,
  type LogState,
  type Op,
  type StampedOp,
} from './oplog.ts';
import { Peer, unlockLocalAddresses, type LinkState, type Message, type PeerRole } from './peer.ts';

export interface Session {
  ready: boolean;
  role: PeerRole;
  setRole: (role: PeerRole) => void;
  board: BoardState;
  /** make a change: stamped, stored, and sent to the other iPad if connected */
  dispatch: (op: Op) => void;

  link: LinkState;
  linkDetail?: string;
  /** the code this device is currently showing, if any */
  code?: string;
  pairing: 'idle' | 'showing-invite' | 'awaiting-answer' | 'showing-answer';
  startPairing: () => Promise<void>;
  joinWithCode: (code: string) => Promise<void>;
  acceptAnswer: (code: string) => Promise<void>;
  stopPairing: () => void;
  /** drop the link deliberately — also how you hand the table iPad to someone else */
  disconnect: () => void;
  /** everything the other iPad needs, for the Manual Sync code */
  exportOps: () => StampedOp[];
  importOps: (ops: StampedOp[]) => void;
}

export function useSession(): Session {
  const [log, setLog] = useState<LogState>(() => newLog(makeActorId()));
  const [role, setRoleState] = useState<PeerRole>('gm');
  const [ready, setReady] = useState(false);

  const [link, setLink] = useState<LinkState>('idle');
  const [linkDetail, setLinkDetail] = useState<string>();
  const [code, setCode] = useState<string>();
  const [pairing, setPairing] = useState<Session['pairing']>('idle');

  const peerRef = useRef<Peer>(null);
  // The log is read inside callbacks that outlive a render, so keep a ref in
  // step with it rather than capturing a stale copy.
  const logRef = useRef(log);
  logRef.current = log;

  useEffect(() => {
    void (async () => {
      const [savedLog, savedRole] = await Promise.all([loadLog(), loadRole()]);
      if (savedLog) {
        // Keep our own actor id: two devices restoring the same log must still
        // stamp their future edits differently.
        setLog({ ...savedLog, actor: savedLog.actor || makeActorId() });
      }
      if (savedRole) setRoleState(savedRole);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (ready) void saveLog(log);
  }, [log, ready]);

  const board = useMemo(() => materialise(log.ops), [log.ops]);

  const dispatch = useCallback((op: Op) => {
    setLog((current) => {
      const { log: next, stamped } = commit(current, op);
      peerRef.current?.send({ t: 'ops', ops: [stamped] });
      return next;
    });
  }, []);

  const absorb = useCallback((ops: StampedOp[]) => {
    setLog((current) => receive(current, ops));
  }, []);

  const events = useMemo(
    () => ({
      onState: (state: LinkState, detail?: string) => {
        setLink(state);
        setLinkDetail(detail);
        if (state === 'live') {
          setPairing('idle');
          setCode(undefined);
          // Whoever just connected may have been editing while apart, so both
          // sides open by sending everything they have; ids make the merge
          // idempotent.
          peerRef.current?.send({ t: 'ops', ops: logRef.current.ops });
        }
      },
      onMessage: (message: Message) => {
        if (message.t === 'ops') absorb(message.ops);
      },
    }),
    [absorb],
  );

  const startPairing = useCallback(async () => {
    peerRef.current?.close();
    setLinkDetail(undefined);
    // Ask for the camera first: it is what makes the browser willing to hand
    // out a real local IP address for the code.
    await unlockLocalAddresses();
    const { peer, code: invite } = await Peer.host(logRef.current.actor, events);
    peerRef.current = peer;
    setCode(invite);
    setPairing('showing-invite');
  }, [events]);

  const joinWithCode = useCallback(
    async (invite: string) => {
      peerRef.current?.close();
      setLinkDetail(undefined);
      await unlockLocalAddresses();
      const { peer, code: answer } = await Peer.join(logRef.current.actor, invite, events);
      peerRef.current = peer;
      setCode(answer);
      setPairing('showing-answer');
    },
    [events],
  );

  const acceptAnswer = useCallback(async (answer: string) => {
    await peerRef.current?.accept(answer);
    setPairing('idle');
  }, []);

  const stopPairing = useCallback(() => {
    setPairing('idle');
    setCode(undefined);
  }, []);

  const disconnect = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    setLink('idle');
    setLinkDetail(undefined);
    setPairing('idle');
    setCode(undefined);
  }, []);

  const setRole = useCallback((next: PeerRole) => {
    setRoleState(next);
    void saveRole(next);
  }, []);

  useEffect(() => () => peerRef.current?.close(), []);

  return {
    ready,
    role,
    setRole,
    board,
    dispatch,
    link,
    linkDetail,
    code,
    pairing,
    startPairing,
    joinWithCode,
    acceptAnswer,
    stopPairing,
    disconnect,
    exportOps: () => logRef.current.ops,
    importOps: absorb,
  };
}
