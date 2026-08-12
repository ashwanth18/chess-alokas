import { useEffect, useId, useState } from 'react';
import {
  DEFAULT_TIEBREAK_ORDER,
  TIEBREAK_LABELS,
  normalizeTiebreakOrder,
  type TiebreakKey,
} from '@chess-alokas/shared';

const RULE_DETAILS: Record<TiebreakKey, string> = {
  buchholz: 'Sum of opponents’ scores. Bye rounds do not add an opponent.',
  buchholzCut1:
    'Buchholz minus the lowest opponent score. With fewer than two opponents, same as Buchholz.',
  sonnebornBerger:
    'Sum of scores of players beaten, plus half the scores of players drawn with. Byes do not count.',
  progressive: 'Sum of the player’s running score after each round (rewards early points).',
  directEncounter:
    'If two tied players played each other, the winner ranks higher. A draw or no mutual game leaves them tied for this step.',
  wins: 'Number of decisive wins (including forfeit wins). Draws and byes do not count.',
  rating: 'Higher rating ranks ahead when earlier tiebreaks are equal (display order within a shared place).',
  seed: 'Lower seed number ranks ahead as the final fallback (display order within a shared place).',
};

type Props = {
  className?: string;
  order?: TiebreakKey[] | null;
  sharedPlaces?: boolean;
};

export default function TiebreakRulesHelp({
  className,
  order,
  sharedPlaces = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const keys = normalizeTiebreakOrder(order ?? DEFAULT_TIEBREAK_ORDER);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span className={`tiebreak-help ${className ?? ''}`.trim()}>
      <button
        type="button"
        className="tiebreak-help-btn"
        aria-label="How tiebreaks work"
        title="How tiebreaks work"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden className="tiebreak-help-icon">
          i
        </span>
        <span className="tiebreak-help-label">Tiebreaks</span>
      </button>

      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="modal-card tiebreak-help-modal"
            role="dialog"
            aria-modal
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId}>How tiebreaks work</h2>
            <p className="form-hint">
              Rank by <strong>Score</strong> first, then this order (first difference wins):
            </p>
            <ol className="tiebreak-help-list">
              <li>
                <strong>1. Score</strong>
                <span>
                  Game points: win 1, draw ½, loss 0 (including forfeits). Bye awards 1 point.
                </span>
              </li>
              {keys.map((key, i) => (
                <li key={key}>
                  <strong>
                    {i + 2}. {TIEBREAK_LABELS[key]}
                  </strong>
                  <span>{RULE_DETAILS[key]}</span>
                </li>
              ))}
            </ol>
            {sharedPlaces ? (
              <p className="form-hint">
                <strong>Shared places:</strong> if players remain equal on all performance
                tiebreaks (before rating/seed), they share a rank (e.g. 1, 2, 2, 4). Rating and
                seed only decide list order within that tie.
              </p>
            ) : (
              <p className="form-hint">
                Shared places are off — rating/seed always force a unique rank number.
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
