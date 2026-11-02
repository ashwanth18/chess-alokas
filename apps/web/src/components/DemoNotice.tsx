import type { ReactNode } from 'react';

/** A plain strip saying that what's on screen is fictional. Colours are fixed so it reads on any theme. */
export function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="note"
      style={{
        margin: '0 0 1rem',
        padding: '0.6rem 0.85rem',
        border: '1px solid #b98a1d',
        borderRadius: '0.5rem',
        background: '#fff6dc',
        color: '#4a3500',
        fontSize: '0.92rem',
        lineHeight: 1.4,
      }}
    >
      {children}
    </p>
  );
}

export function DemoBadge() {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.1rem 0.45rem',
        border: '1px solid #b98a1d',
        borderRadius: '999px',
        background: '#fff6dc',
        color: '#4a3500',
        fontSize: '0.75rem',
        fontWeight: 700,
      }}
    >
      Demo
    </span>
  );
}
