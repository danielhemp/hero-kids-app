/**
 * Screen routing, and the seam between the two iPads.
 *
 * Every change to the board goes through `session.dispatch`, which stamps it,
 * stores it and — if the other iPad is connected — sends it. Nothing writes
 * board state directly, so there is exactly one path for an edit whether it
 * started here or across the table.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Encounter, EncounterLink, Health, Manifest, Party } from './types.ts';
import { encounterKey } from './types.ts';
import { deletePack, forgetAssetUrls, listPacks, loadParty, saveParty } from './store/db.ts';
import { artLookup, defaultPairing, findCard } from './store/pairing.ts';
import { spawnCell, stageEncounter, tokenId } from './store/stage.ts';
import { useSession } from './sync/useSession.ts';
import { useWakeLock } from './sync/useWakeLock.ts';
import { Library } from './ui/Library.tsx';
import { PairSheet, LinkChip } from './ui/PairSheet.tsx';
import { PartySetup } from './ui/PartySetup.tsx';
import { PlayerScreen } from './ui/PlayerScreen.tsx';
import { PlayScreen } from './ui/PlayScreen.tsx';
import { SceneScreen } from './ui/SceneScreen.tsx';

type Screen = 'library' | 'party' | 'scene' | 'board';

export function App() {
  const session = useSession();
  const [packs, setPacks] = useState<Manifest[]>([]);
  const [party, setParty] = useState<Party>({ heroes: [] });
  const [screen, setScreen] = useState<Screen>('library');
  const [packsReady, setPacksReady] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);

  const { board } = session;
  const ready = session.ready && packsReady;

  // A sleeping iPad drops the WebRTC link, so hold the screen awake once a
  // fight is on the table.
  useWakeLock(screen === 'board' || screen === 'scene');

  const [stalePacks, setStalePacks] = useState<{ id: string; title: string; format: number }[]>([]);

  const refreshPacks = useCallback(async () => {
    const installed = await listPacks();
    setPacks(installed.packs);
    setStalePacks(installed.stale);
  }, []);

  useEffect(() => {
    void (async () => {
      const [installed, savedParty] = await Promise.all([listPacks(), loadParty()]);
      setPacks(installed.packs);
      setStalePacks(installed.stale);
      if (savedParty) setParty(savedParty);
      setPacksReady(true);
    })();
  }, []);

  useEffect(() => {
    if (packsReady) void saveParty(party);
  }, [party, packsReady]);

  // Whatever the log says we were doing, go back to it — including after the
  // other iPad sends us a board we did not have.
  useEffect(() => {
    if (!ready || !board.position) return;
    // Come back to whatever was actually happening: if a fight for this
    // encounter is still laid out, reopen the board rather than making the GM
    // tap through the text again mid-battle.
    const fightInProgress = Boolean(board.mapId) && board.encounter === board.position.encounter;
    setScreen((s) => (s === 'library' ? (fightInProgress ? 'board' : 'scene') : s));
  }, [ready, board.position, board.mapId, board.encounter]);

  // Where the party is in the adventure, which is not the same thing as what is
  // laid out on the board: a conversation moves the party without disturbing the
  // fight the table iPad is showing.
  const here = board.position;
  const pack = packs.find((p) => p.id === here?.packId);
  const encounter = pack?.encounters.find((e) => encounterKey(e) === here?.encounter);

  const boardPack = packs.find((p) => p.id === board.packId);
  const boardEncounter = boardPack?.encounters.find((e) => encounterKey(e) === board.encounter);
  const map = boardPack?.maps.find((m) => m.id === board.mapId);

  /** Resolve an encounter's printed branches to the encounters they name. */
  const linksOf = (from: Encounter) =>
    (from.links ?? [])
      .map((l) => {
        const target = pack?.encounters.find((e) => encounterKey(e) === l.to);
        return target ? { link: l, encounter: target } : undefined;
      })
      .filter((x): x is { link: EncounterLink; encounter: Encounter } => Boolean(x));

  /** What simply comes next in print order, for scenes the book doesn't route. */
  const nextInOrder = (from: Encounter) => {
    const list = pack?.encounters ?? [];
    return list[list.findIndex((e) => encounterKey(e) === encounterKey(from)) + 1];
  };

  const goTo = useCallback(
    (chosenPack: Manifest, key: string) => {
      session.dispatch({ t: 'goto', packId: chosenPack.id, encounter: key });
      setScreen('scene');
    },
    [session],
  );

  const startFight = useCallback(
    (chosenPack: Manifest, chosenEncounter: Encounter) => {
      const mapId = chosenEncounter.mapIds?.[0] ?? chosenPack.maps[0]?.id;
      const chosenMap = chosenPack.maps.find((m) => m.id === mapId);
      if (!chosenMap) return;
      session.dispatch({
        t: 'scene',
        packId: chosenPack.id,
        encounter: encounterKey(chosenEncounter),
        mapId: chosenMap.id,
        tokens: stageEncounter({
          manifest: chosenPack,
          encounter: chosenEncounter,
          map: chosenMap,
          party,
        }),
      });
      setScreen('board');
    },
    [party, session],
  );

  if (!ready) return <div className="loading">Loading…</div>;

  const pairSheet = pairingOpen && (
    <PairSheet
      session={session}
      board={board}
      onClose={() => setPairingOpen(false)}
      onManualBoard={(incoming) => {
        // A scanned board replaces what we had; it arrives as a scene so the
        // log compacts and both iPads agree from here on.
        if (!incoming.packId || !incoming.encounter || !incoming.mapId) return;
        session.dispatch({
          t: 'scene',
          packId: incoming.packId,
          encounter: incoming.encounter,
          mapId: incoming.mapId,
          tokens: incoming.tokens,
        });
      }}
    />
  );

  if (screen === 'party') {
    return (
      <>
        <PartySetup packs={packs} party={party} onChange={setParty} onDone={() => setScreen('library')} />
        {pairSheet}
      </>
    );
  }

  // The table iPad follows the board and nothing else. While the GM reads a
  // conversation scene it simply keeps showing the last map, which is what was
  // asked for — a screen that blanks every time somebody talks is worse than one
  // that sits still.
  if (session.role === 'player' && boardPack && map) {
    return (
      <>
        <PlayerScreen
          pack={boardPack}
          map={map}
          tokens={board.tokens}
          party={party}
          connected={session.link === 'live'}
          onOpenPairing={() => setPairingOpen(true)}
          onMove={(id, col, row) => session.dispatch({ t: 'move', id, col, row })}
        />
        {pairSheet}
      </>
    );
  }

  if (screen === 'scene' && pack && encounter) {
    return (
      <>
        <SceneScreen
          pack={pack}
          encounter={encounter}
          links={linksOf(encounter)}
          fallback={nextInOrder(encounter)}
          link={<LinkChip session={session} />}
          onOpenPairing={() => setPairingOpen(true)}
          onGo={(key) => goTo(pack, key)}
          onStartFight={() => startFight(pack, encounter)}
          onExit={() => setScreen('library')}
        />
        {pairSheet}
      </>
    );
  }

  if (screen === 'board' && boardPack && boardEncounter && map) {
    return (
      <>
        <PlayScreen
          pack={boardPack}
          encounter={boardEncounter}
          map={map}
          tokens={board.tokens}
          partySize={Math.max(1, party.heroes.length)}
          link={<LinkChip session={session} />}
          onOpenPairing={() => setPairingOpen(true)}
          onMove={(id, col, row) => session.dispatch({ t: 'move', id, col, row })}
          onHealth={(id, h: Health) => session.dispatch({ t: 'health', id, h })}
          onToggleHidden={(id) => {
            const token = board.tokens.find((t) => t.id === id);
            if (token) session.dispatch({ t: 'hidden', id, v: !token.hidden });
          }}
          onSetArt={(id, art) => session.dispatch({ t: 'art', id, art })}
          onRemove={(id) => session.dispatch({ t: 'remove', id })}
          onAdd={(name, side) => {
            const pairing = defaultPairing(boardPack);
            const art = artLookup(boardPack, pairing);
            const card = side === 'monster' ? findCard(pairing.monsterCards, name) : undefined;
            const at = spawnCell(map, board.tokens, side);
            const sameName = board.tokens.filter((t) => t.name.replace(/ \d+$/, '') === name).length;
            session.dispatch({
              t: 'add',
              token: {
                id: tokenId(),
                side,
                name: sameName > 0 ? `${name} ${sameName + 1}` : name,
                packId: boardPack.id,
                art: card ? art.fileForCard(card.id) : undefined,
                cardId: card?.id,
                col: at.col,
                row: at.row,
                health: 0,
                hidden: false,
              },
            });
          }}
          onChooseMap={(mapId) => session.dispatch({ t: 'map', mapId })}
          onRestage={() => startFight(boardPack, boardEncounter)}
          onBackToScene={() => setScreen('scene')}
          onExit={() => setScreen('library')}
        />
        {pairSheet}
      </>
    );
  }

  return (
    <>
      <Library
        packs={packs}
        stalePacks={stalePacks}
        partySize={Math.max(1, party.heroes.length)}
        link={<LinkChip session={session} />}
        onOpenPairing={() => setPairingOpen(true)}
        onImported={() => void refreshPacks()}
        onOpenParty={() => setScreen('party')}
        onPlay={(chosenPack, chosenEncounter) => goTo(chosenPack, encounterKey(chosenEncounter))}
        onDeletePack={async (packId) => {
          forgetAssetUrls(packId);
          await deletePack(packId);
          await refreshPacks();
        }}
      />
      {pairSheet}
    </>
  );
}
