/**
 * Screen routing, and the seam between the two iPads.
 *
 * Every change to the board goes through `session.dispatch`, which stamps it,
 * stores it and — if the other iPad is connected — sends it. Nothing writes
 * board state directly, so there is exactly one path for an edit whether it
 * started here or across the table.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Encounter, Health, Manifest, Party } from './types.ts';
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

type Screen = 'library' | 'party' | 'play';

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
  useWakeLock(screen === 'play');

  const refreshPacks = useCallback(async () => setPacks(await listPacks()), []);

  useEffect(() => {
    void (async () => {
      const [installed, savedParty] = await Promise.all([listPacks(), loadParty()]);
      setPacks(installed);
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
    if (ready && board.encounter && board.mapId) setScreen('play');
  }, [ready, board.encounter, board.mapId]);

  const pack = packs.find((p) => p.id === board.packId);
  const encounter = pack?.encounters.find((e) => encounterKey(e) === board.encounter);
  const map = pack?.maps.find((m) => m.id === board.mapId);

  const startEncounter = useCallback(
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
      setScreen('play');
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

  if (screen === 'play' && pack && encounter && map) {
    if (session.role === 'player') {
      return (
        <>
          <PlayerScreen
            pack={pack}
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

    return (
      <>
        <PlayScreen
          pack={pack}
          encounter={encounter}
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
            const pairing = defaultPairing(pack);
            const art = artLookup(pack, pairing);
            const card = side === 'monster' ? findCard(pairing.monsterCards, name) : undefined;
            const at = spawnCell(map, board.tokens, side);
            const sameName = board.tokens.filter((t) => t.name.replace(/ \d+$/, '') === name).length;
            session.dispatch({
              t: 'add',
              token: {
                id: tokenId(),
                side,
                name: sameName > 0 ? `${name} ${sameName + 1}` : name,
                packId: pack.id,
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
          onRestage={() => startEncounter(pack, encounter)}
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
        partySize={Math.max(1, party.heroes.length)}
        link={<LinkChip session={session} />}
        onOpenPairing={() => setPairingOpen(true)}
        onImported={() => void refreshPacks()}
        onOpenParty={() => setScreen('party')}
        onPlay={startEncounter}
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
