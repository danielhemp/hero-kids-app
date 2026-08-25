/**
 * A QR code drawn to a canvas, big and high-contrast enough for one iPad to
 * read off another across a table.
 */
import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface Props {
  value: string;
  size?: number;
  label?: string;
}

export function QrCode({ value, size = 320, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 2,
      // Medium correction survives a camera at an angle without making the
      // code noticeably denser.
      errorCorrectionLevel: 'M',
      color: { dark: '#2b2018ff', light: '#fffdf7ff' },
    });
  }, [value, size]);

  // A pairing code is about a hundred characters, which is short enough to read
  // out or type if a camera is being difficult — worth showing, because the
  // alternative when scanning fails is being stuck.
  const typeable = value.length <= 200;

  return (
    <figure className="qr">
      <canvas ref={canvasRef} width={size} height={size} />
      {label && <figcaption>{label}</figcaption>}
      {typeable ? (
        <code className="qr__code">{value}</code>
      ) : (
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => void navigator.clipboard?.writeText(value)}
        >
          Copy the code instead
        </button>
      )}
    </figure>
  );
}
