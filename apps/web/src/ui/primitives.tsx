import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { IconClose } from './icons';
import { resultSpoken, resultText, type ResultCode } from './results';
import { describeAsOf, describeSync, type SyncFacts } from './sync';

/* ── Piece ───────────────────────────────────────────────────────────────────
 * A square, never a circle, and physically correct in every theme. Put a word or a fixed column
 * next to it: colour is never the only signal.
 */
export type PieceColor = 'white' | 'black';

export function Piece({ color, label }: { color: PieceColor; label?: string }) {
  return (
    <span
      className={`ui-piece ui-piece--${color}`}
      role="img"
      aria-label={label ?? (color === 'white' ? 'White' : 'Black')}
    />
  );
}

/* ── Marker ──────────────────────────────────────────────────────────────────
 * Solid means delivered. Hollow means only on this device. Used everywhere status appears.
 */
export function Marker({ hollow = false }: { hollow?: boolean }) {
  return <span className={`ui-marker${hollow ? ' ui-marker--hollow' : ''}`} aria-hidden="true" />;
}

/* ── Result ──────────────────────────────────────────────────────────────────
 * Pen colour until the round is confirmed, then ink, like a paper sheet. Hollow marker while the
 * result hasn't reached the cloud.
 */
export function Result({
  result,
  confirmed = false,
  unsent = false,
}: {
  result: ResultCode | null | undefined;
  confirmed?: boolean;
  unsent?: boolean;
}) {
  const text = resultText(result);
  if (!text) {
    return (
      <span className="ui-result ui-result--none">
        <span aria-hidden="true">–</span>
        <span className="ui-vh">{resultSpoken(result)}</span>
      </span>
    );
  }
  return (
    <span className={`ui-result${confirmed ? ' ui-result--confirmed' : ''}`}>
      {unsent && <Marker hollow />}
      <span aria-hidden="true">{text}</span>
      <span className="ui-vh">
        {resultSpoken(result)}
        {unsent ? ', not sent yet' : ''}
      </span>
    </span>
  );
}

/* ── Button ──────────────────────────────────────────────────────────────── */
export type ButtonVariant = 'default' | 'primary' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** For a router `<Link>` that must look like a button: `<Link className={buttonClass({...})}>`. */
export function buttonClass({
  variant = 'default',
  size = 'md',
  block = false,
}: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean } = {}): string {
  return [
    'ui-btn',
    variant !== 'default' && `ui-btn--${variant}`,
    size !== 'md' && `ui-btn--${size}`,
    block && 'ui-btn--block',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button({
  variant,
  size,
  block,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}) {
  const base = buttonClass({ variant, size, block });
  return (
    <button type={type} className={className ? `${base} ${className}` : base} {...rest}>
      {children}
    </button>
  );
}

/* ── StatusLine ──────────────────────────────────────────────────────────────
 * The honest sync state on the desk. Feed it `useDeskSync()` facts. See sync.ts for the rules.
 */
export function StatusLine(facts: SyncFacts & { actions?: ReactNode }) {
  const { actions, ...rest } = facts;
  const lines = describeSync(rest);
  return (
    <div className="ui-status" role="status">
      {lines.map((line) => (
        <span key={line.key} className={`ui-status__item ui-tone-${line.tone}`}>
          {line.marker !== 'none' && <Marker hollow={line.marker === 'hollow'} />}
          {line.text}
        </span>
      ))}
      {actions ? <span className="ui-status__actions">{actions}</span> : null}
    </div>
  );
}

/** Parent and hall pages: always say how old the data is, and never blank out. */
export function AsOf({ asOf, connected }: { asOf: string | null; connected: boolean | null }) {
  const text = describeAsOf(asOf, connected);
  if (!text) return null;
  return (
    <span className={`ui-asof${connected === false ? ' ui-tone-wait' : ''}`} role="status">
      {connected === false && <Marker hollow />}
      {text}
    </span>
  );
}

/* ── Field ───────────────────────────────────────────────────────────────────
 * Label above, hint under the label, error below. For a select or textarea, pass a render function
 * as children and spread the props it gives you.
 */
type ControlProps = { id: string; className: string; 'aria-describedby'?: string; 'aria-invalid'?: true };

export function Field({
  label,
  hint,
  error,
  optional,
  children,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Shows "optional" next to the label. Parents can't otherwise tell what's required. */
  optional?: boolean;
  children?: (control: ControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control: ControlProps = {
    id: inputProps.id ?? id,
    className: 'ui-input',
    ...(hintId || errorId ? { 'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') } : {}),
    ...(error ? { 'aria-invalid': true as const } : {}),
  };
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={control.id}>
        {label}
        {optional && <span className="ui-field__optional"> optional</span>}
      </label>
      {hint && (
        <span className="ui-field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {children ? children(control) : <input {...inputProps} {...control} />}
      {error && (
        <span className="ui-field__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/* ── Sheet ───────────────────────────────────────────────────────────────────
 * Native <dialog>, so focus trapping and Esc come free. `sheet` rises from the bottom within thumb
 * reach, and `modal` is centred for the desk. Controlled: the parent owns `open`.
 */
export function Sheet({
  open,
  onClose,
  title,
  variant = 'sheet',
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  variant?: 'sheet' | 'modal';
  /** Extra classes on the dialog, for a page that needs another width. */
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`ui-sheet ui-sheet--${variant}${className ? ` ${className}` : ''}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click on the dialog element itself, not its content, is a click on the backdrop.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="ui-sheet__body">
        <header className="ui-sheet__head">
          <h2 id={titleId} className="ui-sheet__title">
            {title}
          </h2>
          <button type="button" className="ui-btn ui-btn--quiet ui-sheet__close" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
