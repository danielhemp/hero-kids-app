/**
 * Reading a QR code with the camera.
 *
 * Safari has no `BarcodeDetector`, so the decoding is done in JavaScript with
 * jsQR against frames pulled off a <video>. It is bundled rather than fetched,
 * because the whole point is that this works with no network at all.
 */
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface Props {
  onCode: (code: string) => void;
  onCancel: () => void;
  hint: string;
}

const SCAN_INTERVAL_MS = 120;

export function QrScanner({ onCode, onCancel, hint }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();
  const [manual, setManual] = useState('');
  const found = useRef(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch {
        if (!cancelled) {
          setError(
            'No camera. Allow camera access for this site, or paste the code from the other iPad below.',
          );
        }
        return;
      }
      if (cancelled || !videoRef.current) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});

      timer = setInterval(() => {
        const video = videoRef.current;
        if (!video || !ctx || video.readyState < 2 || found.current) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        if (!canvas.width || !canvas.height) return;
        ctx.drawImage(video, 0, 0);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'dontInvert',
        });
        if (result?.data) {
          found.current = true;
          onCode(result.data);
        }
      }, SCAN_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onCode]);

  return (
    <div className="scanner">
      {error ? <p className="error">{error}</p> : <video ref={videoRef} playsInline muted />}
      <p className="muted">{hint}</p>

      <form
        className="scanner__manual"
        onSubmit={(event) => {
          event.preventDefault();
          if (manual.trim()) onCode(manual.trim());
        }}
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="…or paste the code"
          aria-label="Paste the code"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button type="submit" className="btn">
          Use code
        </button>
      </form>

      <button type="button" className="btn btn--quiet" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
