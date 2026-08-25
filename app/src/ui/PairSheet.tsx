/**
 * Pairing the two iPads, and the fallback for when that cannot work.
 *
 * The handshake is deliberately two codes rather than one: WebRTC needs an
 * offer *and* an answer, and there is no server to carry either. So the GM shows
 * a code, the player scans it and shows one back, and the GM scans that. About
 * five seconds, and it is the same five seconds after a screen lock drops the
 * link mid-fight.
 */
import { useState } from 'react';
import type { Session } from '../sync/useSession.ts';
import type { BoardState } from '../types.ts';
import { packBoard, unpackBoard } from '../sync/manual.ts';
import { QrCode } from './QrCode.tsx';
import { QrScanner } from './QrScanner.tsx';
import { Diagnostics } from './Diagnostics.tsx';

interface Props {
  session: Session;
  board: BoardState;
  onClose: () => void;
  onManualBoard: (board: BoardState) => void;
}

type Mode = 'choose' | 'host' | 'join' | 'manual-show' | 'manual-scan';

export function PairSheet({ session, board, onClose, onManualBoard }: Props) {
  const [mode, setMode] = useState<Mode>('choose');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);

  const guard = async (work: () => Promise<void>) => {
    setError(undefined);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__inner sheet__inner--wide" onClick={(e) => e.stopPropagation()}>
        <header className="pair__head">
          <h3>Connect the iPads</h3>
          <LinkChip session={session} />
        </header>

        {error && <p className="error">{error}</p>}

        {mode === 'choose' && (
          <div className="pair__choose">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setMode('host');
                session.setRole('gm');
                void guard(session.startPairing);
              }}
            >
              This is the GM iPad
              <small>Show an invitation for the table iPad to scan</small>
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => {
                setMode('join');
                session.setRole('player');
                setScanning(true);
              }}
            >
              This is the table iPad
              <small>Scan the GM's invitation</small>
            </button>

            <hr />

            <button type="button" className="btn btn--quiet" onClick={() => setMode('manual-show')}>
              Manual Sync — show the board as a code
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setMode('manual-scan')}>
              Manual Sync — copy a board from the other iPad
            </button>
            <p className="muted">
              Manual Sync is for Wi-Fi that blocks device-to-device traffic, which some guest
              networks do. Slower, but it always works.
            </p>

            <hr />

            <button type="button" className="btn btn--quiet" onClick={() => setChecking(true)}>
              Pairing won't connect? Run a check
            </button>
          </div>
        )}

        {mode === 'host' && (
          <div className="pair__step">
            {session.code ? (
              <>
                <QrCode value={session.code} label="1. The table iPad scans this" />
                {scanning ? (
                  <QrScanner
                    hint="2. Now scan the code the table iPad is showing back."
                    onCancel={() => setScanning(false)}
                    onCode={(code) => {
                      setScanning(false);
                      void guard(async () => {
                        await session.acceptAnswer(code);
                      });
                    }}
                  />
                ) : (
                  <button type="button" className="btn btn--primary" onClick={() => setScanning(true)}>
                    2. Scan the code it shows back
                  </button>
                )}
              </>
            ) : (
              <p className="muted">Getting an invitation ready…</p>
            )}
          </div>
        )}

        {mode === 'join' && (
          <div className="pair__step">
            {scanning ? (
              <QrScanner
                hint="Point this at the invitation on the GM's iPad."
                onCancel={() => setScanning(false)}
                onCode={(code) => {
                  setScanning(false);
                  void guard(async () => {
                    await session.joinWithCode(code);
                  });
                }}
              />
            ) : session.code ? (
              <QrCode value={session.code} label="Now hold this up for the GM to scan" />
            ) : (
              <button type="button" className="btn btn--primary" onClick={() => setScanning(true)}>
                Scan the GM's invitation
              </button>
            )}
          </div>
        )}

        {mode === 'manual-show' && (
          <div className="pair__step">
            <QrCode value={packBoard(board)} size={380} label="Scan this with the other iPad" />
          </div>
        )}

        {mode === 'manual-scan' && (
          <div className="pair__step">
            <QrScanner
              hint="Point this at the board code on the other iPad."
              onCancel={() => setMode('choose')}
              onCode={(code) =>
                void guard(async () => {
                  onManualBoard(unpackBoard(code));
                  onClose();
                })
              }
            />
          </div>
        )}

        <footer className="pair__foot">
          {session.link !== 'idle' && (
            <button type="button" className="btn btn--quiet" onClick={session.disconnect}>
              Disconnect
            </button>
          )}
          {mode !== 'choose' && (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setScanning(false);
                setMode('choose');
                session.stopPairing();
              }}
            >
              ‹ Back
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
      {checking && <Diagnostics onClose={() => setChecking(false)} />}
    </div>
  );
}

export function LinkChip({ session }: { session: Session }) {
  const label: Record<Session['link'], string> = {
    idle: 'Not connected',
    pairing: 'Waiting to pair',
    connecting: 'Connecting…',
    live: 'Connected',
    lost: 'Link lost',
  };
  return (
    <span className={`linkchip linkchip--${session.link}`} title={session.linkDetail}>
      {label[session.link]}
    </span>
  );
}
