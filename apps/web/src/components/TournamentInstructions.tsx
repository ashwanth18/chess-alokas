import type { TournamentInstruction } from '../lib/tournamentProgress';

export default function TournamentInstructions({
  steps,
}: {
  steps: TournamentInstruction[];
}) {
  if (steps.length === 0) return null;

  return (
    <aside className="tournament-instructions" aria-label="Tournament next steps">
      <h2 className="instructions-heading">Next steps</h2>
      <ol className="instructions-list">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={`instruction instruction-${step.status}`}
          >
            <span className="instruction-marker" aria-hidden>
              {step.status === 'done' ? '✓' : step.status === 'current' ? index + 1 : '○'}
            </span>
            <div className="instruction-body">
              <span className="instruction-title">{step.title}</span>
              {step.description && (
                <span className="instruction-desc">{step.description}</span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
