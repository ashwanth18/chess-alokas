import { useId, useState } from 'react';
import {
  DEFAULT_STICKER_FORMAT,
  STICKER_FORMATS,
  buildTableStickerPdf,
  downloadPdfBytes,
  isStickerFormat,
  stickerFilename,
  type StickerFormat,
  type StickerTable,
} from '../lib/tableStickers';

const FORMAT_KEY = 'chess-alokas:sticker-format';

function savedFormat(): StickerFormat {
  try {
    const value = localStorage.getItem(FORMAT_KEY);
    return isStickerFormat(value) ? value : DEFAULT_STICKER_FORMAT;
  } catch {
    return DEFAULT_STICKER_FORMAT;
  }
}

/** Format picker plus the "Download QR stickers" button for the floor panel. */
export default function TableStickerDownload({
  tournamentName,
  tables,
  buttonClassName,
}: {
  tournamentName: string;
  tables: StickerTable[] | undefined;
  buttonClassName: string;
}) {
  const id = useId();
  const [format, setFormat] = useState<StickerFormat>(savedFormat);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = tables?.length ?? 0;
  const hint = STICKER_FORMATS.find((f) => f.id === format)?.hint;

  const download = async () => {
    if (!tables?.length) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = await buildTableStickerPdf(tournamentName, tables, { format });
      downloadPdfBytes(stickerFilename(tournamentName, format), bytes);
    } catch {
      setError('Could not make the PDF. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '0.3rem', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
        <select
          aria-label="Sticker format"
          className="input input-sm"
          style={{ width: 'auto', maxWidth: '100%' }}
          value={format}
          disabled={busy}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            const next = e.target.value;
            if (!isStickerFormat(next)) return;
            setFormat(next);
            try {
              localStorage.setItem(FORMAT_KEY, next);
            } catch {
              /* private mode: the choice just isn't remembered */
            }
          }}
        >
          {STICKER_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={buttonClassName}
          disabled={count === 0 || busy}
          onClick={() => void download()}
        >
          {busy ? 'Preparing PDF…' : `Download QR stickers${count > 0 ? ` (${count})` : ''}`}
        </button>
      </div>
      <p id={`${id}-hint`} className="form-hint" style={{ margin: 0 }}>
        {hint}
      </p>
      {error && (
        <p className="form-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
