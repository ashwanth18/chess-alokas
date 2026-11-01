import type { ReactNode } from 'react';

/** Chess pieces drawn as SVG, never Unicode glyphs, which change with the font. Decorative, so hidden from readers. */

type PieceProps = { className?: string };

/** The brand mark: a queen's crown. */
export function Crown({ className }: PieceProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="4" r="2" />
      <circle cx="3.5" cy="7" r="2" />
      <circle cx="20.5" cy="7" r="2" />
      <path d="M3.9 9.6 7.6 13l3.2-7h2.4l3.2 7 3.7-3.4L18.4 18H5.6zM5 19.5h14a1 1 0 0 1 1 1v.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-.5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function Knight({ className }: PieceProps) {
  return (
    <svg className={className} viewBox="0 0 64 80" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M31 3c1 2 1.6 4.2 1.7 6.3C42 11 56 19 56 41c0 9-2.4 17.5-4 24H19c0-9 3.6-14 8.6-19.4 3-3.2 5.4-6.8 5.4-11.6-3 3.6-6.8 5.600-11.400 6-1.800 2.800-4.200 5.200-7.400 5.200-3.800 0-6.800-3.200-6.800-7 0-2.400 1.200-4.400 2.800-6.400 4-5 7.800-9.800 10.600-15.200-.6-2.800-.6-5.400 0-8 3 .8 5 2.400 6.800 4.400C24.400 7 27.200 4.600 31 3zM22.500 20.500a2.600 2.600 0 1 0 0 5.200 2.600 2.600 0 0 0 0-5.200z"
      />
      <path d="M18 68h36a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3z" />
    </svg>
  );
}

export function Bishop({ className }: PieceProps) {
  return (
    <svg className={className} viewBox="0 0 48 80" fill="currentColor" aria-hidden="true">
      <circle cx="24" cy="5.5" r="4.5" />
      <path
        fillRule="evenodd"
        d="M24 11.500c7.500 6.500 14 15.500 14 24 0 6.200-3.400 10.600-7.400 13H34a2.500 2.500 0 0 1 0 5h-2.300c.5 5 2.300 8.600 5 11.500H11.300c2.700-2.900 4.500-6.500 5-11.500H14a2.500 2.500 0 0 1 0-5h3.400C13.400 46.100 10 41.700 10 35.500c0-8.500 6.500-17.500 14-24zm5.300 11.300-6.800 8.700 2.300 1.800 6.300-8.100c-.5-.8-1.100-1.600-1.800-2.400z"
      />
      <path d="M7 68h34a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3z" />
    </svg>
  );
}

/** Small pawn that marks White or Black beside a name. */
export function Pawn({ className, side }: PieceProps & { side?: 'w' | 'b' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" data-side={side} aria-hidden="true">
      <path d="M12 2.500a4 4 0 0 1 2.600 7H16a1 1 0 0 1 0 2.200h-1.700l1.200 6.300H8.500l1.200-6.300H8a1 1 0 0 1 0-2.200h1.400A4 4 0 0 1 12 2.500zM6.500 19h11a1.500 1.500 0 0 1 1.500 1.500v1a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-1A1.500 1.500 0 0 1 6.500 19z" />
    </svg>
  );
}

/** Line icons for the three roles, from Lucide (ISC licence). */
function Line({ className, children }: PieceProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function KingLine({ className }: PieceProps) {
  return (
    <Line className={className}>
      <path d="M4 20a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="m6.7 18-1-1C4.35 15.682 3 14.09 3 12a5 5 0 0 1 4.95-5c1.584 0 2.7.455 4.05 1.818C13.35 7.455 14.466 7 16.05 7A5 5 0 0 1 21 12c0 2.082-1.359 3.673-2.7 5l-1 1" />
      <path d="M10 4h4" />
      <path d="M12 2v6.818" />
    </Line>
  );
}

export function BishopLine({ className }: PieceProps) {
  return (
    <Line className={className}>
      <path d="M5 20a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M15 18c1.5-.615 3-2.461 3-4.923C18 8.769 14.5 4.462 12 2 9.5 4.462 6 8.77 6 13.077 6 15.539 7.5 17.385 9 18" />
      <path d="m16 7-2.5 2.5" />
      <path d="M9 2h6" />
    </Line>
  );
}

export function PawnLine({ className }: PieceProps) {
  return (
    <Line className={className}>
      <path d="M5 20a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="m14.5 10 1.5 8" />
      <path d="M7 10h10" />
      <path d="m8 18 1.5-8" />
      <circle cx="12" cy="6" r="4" />
    </Line>
  );
}
