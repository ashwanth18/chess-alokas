import { useState, type ReactNode } from 'react';
import type { GameResult } from '@chess-alokas/shared';
import { MAX_CORRECTION_REASON, oldScoreWarning } from '../lib/lateCorrection';

export type CorrectionChoice = 'keep' | 'undo';

/** The small dialog for a late correction. Text kept to what changes the decision. */
export default function CorrectResultModal({
  round,
  board,
  from,
  laterRounds,
  undoRound,
  finished,
  online,
  busy,
  renderPicker,
  onCancel,
  onSave,
}: {
  round: number;
  board: number;
  from: string;
  /** Rounds paired after this one. */
  laterRounds: number[];
  /** The round that can be undone and paired again, if any. */
  undoRound: number | null;
  finished: boolean;
  online: boolean;
  busy: boolean;
  renderPicker: (value: string, onChange: (result: GameResult) => void) => ReactNode;
  onCancel: () => void;
  onSave: (input: { result: GameResult; reason: string; choice: CorrectionChoice }) => void;
}) {
  const [result, setResult] = useState<string>(from);
  const [reason, setReason] = useState('');
  const [choice, setChoice] = useState<CorrectionChoice>('keep');
  const warning = oldScoreWarning(laterRounds);
  const keepRound = undoRound ?? laterRounds.at(-1);
  const ready = result !== from && reason.trim().length > 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => !busy && onCancel()}>
      <div
        className="modal-card result-change-modal"
        role="dialog"
        aria-modal
        aria-labelledby="correct-result-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="correct-result-title">
          Correct Round {round}, Table {board}
        </h2>
        {finished && (
          <p className="form-hint stage-banner-warn" role="alert">
            This tournament is finished. Final standings may change.
          </p>
        )}
        {renderPicker(result, (next) => setResult(next))}
        <label>
          Reason
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX_CORRECTION_REASON}
            required
            autoFocus
          />
        </label>
        {warning && (
          <p className="form-hint stage-banner-warn" role="alert">
            {warning}
          </p>
        )}
        {undoRound != null && (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.35rem' }}>
            <label>
              <input
                type="radio"
                name="correction-choice"
                checked={choice === 'keep'}
                onChange={() => setChoice('keep')}
              />{' '}
              Keep Round {keepRound} pairings
            </label>
            <label>
              <input
                type="radio"
                name="correction-choice"
                checked={choice === 'undo'}
                disabled={!online}
                onChange={() => setChoice('undo')}
              />{' '}
              Undo Round {undoRound} and re-pair{online ? '' : ' (needs internet)'}
            </label>
          </fieldset>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !ready}
            onClick={() => onSave({ result: result as GameResult, reason: reason.trim(), choice })}
          >
            {busy ? 'Saving…' : 'Save correction'}
          </button>
        </div>
      </div>
    </div>
  );
}
