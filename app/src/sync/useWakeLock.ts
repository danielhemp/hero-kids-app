/**
 * Hold the screen awake while a session is live.
 *
 * An iPad that dims and locks loses the WebRTC transport, and although
 * re-pairing only takes a re-scan, not needing one is better. The lock is also
 * dropped and re-taken around visibility changes, because iOS releases it
 * silently whenever the tab goes to the background.
 */
import { useEffect } from 'react';

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;

    let lock: WakeLockSentinel | undefined;
    let cancelled = false;

    const take = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        // Denied or unsupported; the session still works, the screen just sleeps.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void take();
    };

    void take();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
