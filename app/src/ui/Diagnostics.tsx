/**
 * "It didn't connect" — this says why.
 *
 * Reachable from the pairing sheet. Runs the checks in the same order the real
 * handshake does, so whatever fails here is what failed there.
 */
import { useEffect, useState } from 'react';
import { runDiagnostics, type Report } from '../sync/diagnose.ts';

export function Diagnostics({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<Report>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void runDiagnostics().then((result) => {
      if (live) setReport(result);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__inner sheet__inner--wide" onClick={(e) => e.stopPropagation()}>
        <h3>Pairing check</h3>

        {!report ? (
          <p className="muted">Checking… this asks for the camera, which is part of the test.</p>
        ) : (
          <>
            <ul className="diag">
              {report.findings.map((finding) => (
                <li key={finding.label} className={`diag--${String(finding.ok)}`}>
                  <b>{finding.label}</b>
                  <span>{finding.detail}</span>
                </li>
              ))}
            </ul>

            <div className="pair__foot">
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  void navigator.clipboard?.writeText(report.text).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy this report'}
              </button>
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            </div>

            <details className="diag__raw">
              <summary>Raw report</summary>
              <pre>{report.text}</pre>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
