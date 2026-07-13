import { useEffect, useId, useState } from 'react';

export type NumberFieldProps = {
  id?: string;
  label?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** When true, empty is allowed and reports null (e.g. optional overrides). */
  allowEmpty?: boolean;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
  /** Extra error from the parent (e.g. form-level). */
  error?: string | null;
  required?: boolean;
};

function parseWholeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^-?\d+$/.test(trimmed)) return Number.NaN;
  return Number.parseInt(trimmed, 10);
}

export function validateWholeNumber(
  raw: string,
  opts: { min?: number; max?: number; allowEmpty?: boolean; required?: boolean } = {},
): string | null {
  const n = parseWholeNumber(raw);
  if (n === null) {
    if (opts.allowEmpty && !opts.required) return null;
    return 'Enter a number';
  }
  if (!Number.isFinite(n)) return 'Enter a whole number';
  if (opts.min != null && n < opts.min) return `Must be at least ${opts.min}`;
  if (opts.max != null && n > opts.max) return `Must be at most ${opts.max}`;
  return null;
}

/**
 * Free-typing number input: no live min/max clamping (so “10” is easy to type).
 * Shows an inline validation error instead.
 */
export default function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  allowEmpty = false,
  className,
  inputClassName = 'input',
  placeholder,
  disabled,
  hint,
  error: externalError,
  required,
}: NumberFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [text, setText] = useState(() => (value == null ? '' : String(value)));
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (focused) return;
    setText(value == null ? '' : String(value));
  }, [value, focused]);

  const localError = validateWholeNumber(text, { min, max, allowEmpty, required });
  const showError = Boolean(externalError) || (touched && Boolean(localError));
  const errorText = externalError || localError;

  function emitFromRaw(raw: string) {
    const err = validateWholeNumber(raw, { min, max, allowEmpty, required });
    if (err) {
      onChange(null);
      return;
    }
    onChange(parseWholeNumber(raw));
  }

  return (
    <div className={className ?? 'form-group'}>
      {label && <label htmlFor={fieldId}>{label}</label>}
      <input
        id={fieldId}
        type="text"
        inputMode="numeric"
        className={`${inputClassName}${showError ? ' input-invalid' : ''}`}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={showError || undefined}
        aria-describedby={showError ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          // Digits only (optional leading minus for completeness).
          const raw = e.target.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '');
          setText(raw);
          emitFromRaw(raw);
        }}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
          emitFromRaw(text);
        }}
      />
      {hint && !showError && (
        <span id={`${fieldId}-hint`} className="form-hint-sm">
          {hint}
        </span>
      )}
      {showError && errorText && (
        <span id={`${fieldId}-error`} className="field-error" role="alert">
          {errorText}
        </span>
      )}
    </div>
  );
}
