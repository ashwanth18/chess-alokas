/** The Chess Alokas mark. Sizes with the surrounding text and takes its colour. */
export function BrandCrown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ width: '1em', height: '1em', display: 'inline-block', verticalAlign: '-0.12em' }}
    >
      <circle cx="12" cy="4" r="2" />
      <circle cx="3.5" cy="7" r="2" />
      <circle cx="20.5" cy="7" r="2" />
      <path d="M3.9 9.600 7.600 13l3.200-7h2.400l3.200 7 3.700-3.400L18.400 18H5.600zM5 19.500h14a1 1 0 0 1 1 1v.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-.5a1 1 0 0 1 1-1z" />
    </svg>
  );
}
