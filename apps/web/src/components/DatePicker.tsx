import { useEffect, useId, useMemo, useRef, useState } from 'react';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar YYYY-MM-DD (avoids UTC shift from toISOString). */
export function toDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, day] = value.split('-').map(Number);
  if (y == null || m == null || day == null) return null;
  const d = new Date(y, m - 1, day);
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) return null;
  return d;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function formatDisplay(value: string): string {
  const d = parseDateValue(value);
  if (!d) return 'Pick a date';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Monday-first grid of days for the visible month (null = padding). */
function buildMonthGrid(month: Date): Array<Date | null> {
  const first = startOfMonth(month);
  const year = first.getFullYear();
  const m = first.getMonth();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  // JS: Sun=0 … Sat=6 → Mon-first index
  const startPad = (first.getDay() + 6) % 7;
  const cells: Array<Date | null> = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(year, m, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export type DatePickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
};

export default function DatePicker({
  id,
  value,
  onChange,
  disabled,
  allowClear = true,
  className,
}: DatePickerProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseDateValue(value), [value]);
  const [viewMonth, setViewMonth] = useState(() =>
    startOfMonth(selected ?? new Date()),
  );

  useEffect(() => {
    if (selected) setViewMonth(startOfMonth(selected));
  }, [selected]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const grid = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const todayStr = toDateValue(new Date());

  return (
    <div
      className={`date-picker ${open ? 'is-open' : ''} ${className ?? ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        id={inputId}
        className="date-picker-trigger input"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className="date-picker-trigger-icon" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect
              x="3"
              y="5"
              width="18"
              height="16"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.75"
            />
            <path
              d="M3 10h18M8 3v4M16 3v4"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className={selected ? 'date-picker-value' : 'date-picker-placeholder'}>
          {formatDisplay(value)}
        </span>
        {allowClear && selected && !disabled ? (
          <span
            className="date-picker-clear"
            role="button"
            tabIndex={0}
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
              setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onChange('');
                setOpen(false);
              }
            }}
          >
            ×
          </span>
        ) : null}
      </button>

      {open && (
        <div className="date-picker-popover" role="dialog" aria-label="Choose date">
          <div className="date-picker-toolbar">
            <button
              type="button"
              className="date-picker-nav"
              aria-label="Previous month"
              onClick={() =>
                setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
              }
            >
              ‹
            </button>
            <div className="date-picker-month">{monthLabel(viewMonth)}</div>
            <button
              type="button"
              className="date-picker-nav"
              aria-label="Next month"
              onClick={() =>
                setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
              }
            >
              ›
            </button>
          </div>

          <div className="date-picker-weekdays">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="date-picker-grid">
            {grid.map((cell, i) => {
              if (!cell) {
                return <span key={`e-${i}`} className="date-picker-day is-empty" />;
              }
              const iso = toDateValue(cell);
              const isSelected = value === iso;
              const isToday = iso === todayStr;
              return (
                <button
                  key={iso}
                  type="button"
                  className={[
                    'date-picker-day',
                    isSelected ? 'is-selected' : '',
                    isToday ? 'is-today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                >
                  {cell.getDate()}
                </button>
              );
            })}
          </div>

          <div className="date-picker-footer">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                const t = toDateValue(new Date());
                onChange(t);
                setViewMonth(startOfMonth(new Date()));
                setOpen(false);
              }}
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
