import { useEffect, useId, useState } from 'react';

/** Keep in sync with computeStandings sort order in @chess-alokas/pairing-engine. */
export const TIEBREAK_RULES = [
  {
    name: 'Score',
    detail: 'Game points: win 1, draw ½, loss 0 (including forfeits). Bye awards 1 point.',
  },
  {
    name: 'Buchholz',
    detail: 'Sum of opponents’ scores. Bye rounds do not add an opponent.',
  },
  {
    name: 'Buchholz Cut-1',
    detail:
      'Buchholz minus the lowest opponent score. With fewer than two opponents, same as Buchholz.',
  },
  {
    name: 'Sonneborn-Berger',
    detail:
      'Sum of scores of players beaten, plus half the scores of players drawn with. Byes do not count.',
  },
  {
    name: 'Wins',
    detail: 'Number of decisive wins (including forfeit wins). Draws and byes do not count.',
  },
  {
    name: 'Rating',
    detail: 'Higher rating ranks ahead when earlier tiebreaks are equal.',
  },
  {
    name: 'Seed',
    detail: 'Lower seed number ranks ahead as the final fallback.',
  },
] as const;

type Props = {
  /** Compact label next to section titles */
  className?: string;
};

export default function TiebreakRulesHelp({ className }: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

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
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="modal-card tiebreak-help-modal"
            role="dialog"
            aria-modal
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId}>How tiebreaks work</h2>
            <p className="form-hint">
              When players have the same score, ranks are decided in this order (first difference
              wins):
            </p>
            <ol className="tiebreak-help-list">
              {TIEBREAK_RULES.map((rule, i) => (
                <li key={rule.name}>
                  <strong>
                    {i + 1}. {rule.name}
                  </strong>
                  <span>{rule.detail}</span>
                </li>
              ))}
            </ol>
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
