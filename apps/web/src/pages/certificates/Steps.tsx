import { IconCheck } from '../../ui';

export type StepInfo = {
  key: string;
  title: string;
  /** What's done so far, in a few words: "Imaginary Bay Junior Rapid", "18 of 20 chosen". */
  summary: string;
  done: boolean;
};

/**
 * The five steps across the top. Every step stays clickable: real events aren't linear, and a late
 * entry means going back to recipients after issuing.
 */
export function Steps({ steps, current, onGo }: { steps: StepInfo[]; current: number; onGo: (i: number) => void }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <nav className="cw-steps" aria-label="Certificate steps">
      <p className="cw-steps__progress cw-small">
        {done} of {steps.length} steps done
      </p>
      <ol>
        {steps.map((s, i) => {
          const state = i === current ? 'current' : s.done ? 'done' : 'todo';
          return (
            <li key={s.key} className={`cw-step is-${state}`}>
              <button
                type="button"
                className="cw-step__btn"
                aria-current={i === current ? 'step' : undefined}
                onClick={() => onGo(i)}
              >
                <span className="cw-step__n ui-num" aria-hidden="true">
                  {s.done && i !== current ? <IconCheck size={14} /> : i + 1}
                </span>
                <span className="cw-step__text">
                  <span className="cw-step__title">
                    {s.title}
                    <span className="ui-vh">{s.done ? ', done' : ', not done yet'}</span>
                  </span>
                  <span className="cw-step__sum">{s.summary}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
