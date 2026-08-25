/**
 * Something broke — say so, rather than showing a blank screen.
 *
 * A React tree that throws unmounts itself, leaving an empty page in the body
 * colour. That happened for real: a pack imported before the format changed had
 * no `sections`, the scene screen called `.map` on undefined, and the app became
 * a featureless cream rectangle with nothing to click and nothing to read.
 *
 * At a table with children waiting, "is something off?" is the worst possible
 * error message. This one names the fault and offers the way out.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
  detail?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ detail: info.componentStack ?? undefined });
    console.error('Hero Kids crashed:', error, info);
  }

  /**
   * Everything the app holds is either re-importable (packs) or a board that can
   * be re-staged, so wiping is a real fix rather than a last resort — but it is
   * still destructive, hence the confirmation.
   */
  private async reset() {
    if (!confirm('Remove the installed packs and the current board from this iPad?')) return;
    try {
      indexedDB.deleteDatabase('hero-kids');
      if ('caches' in window) {
        for (const key of await caches.keys()) await caches.delete(key);
      }
      const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
      for (const registration of registrations) await registration.unregister();
    } finally {
      location.reload();
    }
  }

  render() {
    const { error, detail } = this.state;
    if (!error) return this.props.children;

    // A pack from before a format change is the failure this has actually seen,
    // so it gets named rather than buried in a stack trace.
    const looksLikeStalePack = /reading '(map|length|filter)'/.test(error.message);

    return (
      <div className="crash">
        <div className="crash__inner">
          <h1>Something went wrong</h1>
          <p className="crash__message">{error.message}</p>

          {looksLikeStalePack && (
            <p>
              This usually means a content pack on this iPad was built with an older version
              of <code>hkpack</code>. Rebuild the packs on the Mac, then reset here and import
              them again.
            </p>
          )}

          <div className="crash__actions">
            <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
              Reload
            </button>
            <button type="button" className="btn" onClick={() => void this.reset()}>
              Reset this iPad's data
            </button>
          </div>

          <p className="muted">
            Resetting removes the installed packs and the current board. Nothing on the Mac is
            touched, and packs can be imported again.
          </p>

          {detail && (
            <details className="crash__detail">
              <summary>Technical detail</summary>
              <pre>
                {error.stack}
                {detail}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
