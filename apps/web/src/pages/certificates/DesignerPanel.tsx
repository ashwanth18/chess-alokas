import { useId } from 'react';
import type { CertificateField, CertificateRow } from '@chess-alokas/certificates';
import { Button } from '../../ui';
import { certificateColumnLabel, certificateColumnSample } from '../../lib/certificateColumns';

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 72;

const PRESETS = [
  { label: 'Small', size: 14 },
  { label: 'Medium', size: 22 },
  { label: 'Large', size: 36 },
  { label: 'Title', size: 48 },
] as const;

function FontSize({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const id = useId();
  const v = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value));
  return (
    <div className="cw-size">
      <div className="cw-size__top">
        <label htmlFor={id}>{label}</label>
        <span className="ui-num">{v} pt</span>
      </div>
      <div className="cw-size__row">
        <Button size="sm" aria-label="Smaller" onClick={() => onChange(Math.max(FONT_SIZE_MIN, v - 2))}>
          -
        </Button>
        <input
          id={id}
          type="range"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          value={v}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <Button size="sm" aria-label="Larger" onClick={() => onChange(Math.min(FONT_SIZE_MAX, v + 2))}>
          +
        </Button>
      </div>
      <div className="cw-size__presets" role="group" aria-label="Preset sizes">
        {PRESETS.map((p) => (
          <button
            key={p.size}
            type="button"
            className={`cw-chip${v === p.size ? ' is-on' : ''}`}
            aria-pressed={v === p.size}
            onClick={() => onChange(p.size)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Beside the template: what can go on the certificate, the text size, and what's placed already.
 * Choose a field here, then click the page (or press Place) to put it there.
 */
export function DesignerPanel({
  columns,
  sample,
  selectedColumn,
  onSelectColumn,
  fields,
  selectedFieldId,
  onSelectField,
  onRemoveField,
  placeFontSize,
  onFontSize,
  onPlaceCentre,
}: {
  columns: string[];
  sample: CertificateRow | undefined;
  selectedColumn: string;
  onSelectColumn: (col: string) => void;
  fields: CertificateField[];
  selectedFieldId: string | null;
  onSelectField: (id: string) => void;
  onRemoveField: (id: string) => void;
  placeFontSize: number;
  onFontSize: (size: number) => void;
  onPlaceCentre: () => void;
}) {
  const selectedField = fields.find((f) => f.id === selectedFieldId) ?? null;
  return (
    <div className="cw-dpanel">
      <section className="cw-dpanel__block" aria-labelledby="cw-fields-h">
        <h3 id="cw-fields-h" className="cw-h3">
          1. Choose a field
        </h3>
        {columns.length === 0 ? (
          <p className="cw-small">Fields appear once there are recipients: choose a tournament or import a CSV in step 1.</p>
        ) : (
          <div className="cw-cols" role="radiogroup" aria-label="Field to place">
            {columns.map((col) => {
              const example = certificateColumnSample(col, sample);
              const on = selectedColumn === col;
              return (
                <button
                  key={col}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`cw-col${on ? ' is-on' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', col);
                    onSelectColumn(col);
                  }}
                  onClick={() => onSelectColumn(col)}
                >
                  <span className="cw-col__name">{certificateColumnLabel(col)}</span>
                  <span className="cw-col__eg">{example ? `e.g. ${example}` : 'Empty for now'}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="cw-dpanel__block" aria-labelledby="cw-size-h">
        <h3 id="cw-size-h" className="cw-h3">
          2. {selectedField ? 'Size of the selected field' : 'Pick a size'}
        </h3>
        <FontSize
          label={selectedField ? certificateColumnLabel(selectedField.sourceColumn) : 'Text size'}
          value={selectedField?.fontSize ?? placeFontSize}
          onChange={onFontSize}
        />
      </section>

      <section className="cw-dpanel__block" aria-labelledby="cw-place-h">
        <h3 id="cw-place-h" className="cw-h3">
          3. Place it
        </h3>
        <p className="cw-small">Click where it goes on the certificate, or drag the field there.</p>
        <Button size="sm" disabled={columns.length === 0} onClick={onPlaceCentre}>
          Put {certificateColumnLabel(selectedColumn)} in the middle
        </Button>
      </section>

      <section className="cw-dpanel__block" aria-labelledby="cw-placed-h">
        <h3 id="cw-placed-h" className="cw-h3">
          On the certificate ({fields.length})
        </h3>
        {fields.length === 0 ? (
          <p className="cw-small">Nothing placed yet. Most certificates need at least the full name.</p>
        ) : (
          <ul className="cw-placed">
            {fields.map((f) => (
              <li key={f.id} className={selectedFieldId === f.id ? 'is-on' : ''}>
                <button type="button" className="cw-placed__pick" onClick={() => onSelectField(f.id)} aria-pressed={selectedFieldId === f.id}>
                  <span>{certificateColumnLabel(f.sourceColumn)}</span>
                  <span className="cw-small ui-num">{f.fontSize} pt</span>
                </button>
                <Button size="sm" variant="quiet" onClick={() => onRemoveField(f.id)} aria-label={`Remove ${certificateColumnLabel(f.sourceColumn)}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
