import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

/** Extract /t/{slug} from a full QR URL or bare slug path. */
export function extractTableSlug(text: string): string | null {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    const m = url.pathname.match(/\/t\/([^/?#]+)/);
    if (m?.[1]) return decodeURIComponent(m[1]);
  } catch {
    /* not a full URL */
  }
  const path = trimmed.match(/\/t\/([^/?#]+)/);
  if (path?.[1]) return decodeURIComponent(path[1]);
  return null;
}

export default function TableQrScanner({
  onSlug,
  onClose,
}: {
  onSlug: (slug: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const scanner = new Html5Qrcode('floor-qr-reader');
    scannerRef.current = scanner;

    void scanner
      .start(
        { facingMode: 'environment' },
        { fps: 8, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          const slug = extractTableSlug(decoded);
          if (!slug) {
            setError('QR is not a table link');
            return;
          }
          void scanner.stop().finally(() => onSlug(slug));
        },
        () => undefined,
      )
      .catch((err: unknown) => {
        setError(
          err instanceof Error
            ? err.message
            : 'Camera unavailable — use your phone camera app instead',
        );
      });

    return () => {
      const s = scannerRef.current;
      if (s?.isScanning) {
        void s.stop().catch(() => undefined);
      }
    };
  }, [onSlug]);

  return (
    <div className="qr-scanner-overlay" role="dialog" aria-modal aria-label="Scan table QR">
      <div className="qr-scanner-sheet">
        <h2>Scan next table</h2>
        <p className="form-hint">Point the camera at a table QR sticker.</p>
        <div id="floor-qr-reader" className="qr-scanner-view" />
        {error && <p className="form-error">{error}</p>}
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
