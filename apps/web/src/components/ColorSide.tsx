type SideColor = 'white' | 'black';

interface ColorSideProps {
  color: SideColor;
  /** When true, use high-contrast styling for dark row backgrounds. */
  onDark?: boolean;
  /** Larger touch-friendly badge for floor / pairing cards. */
  size?: 'sm' | 'md';
}

/** Clear W/B badge + label for pairing sheets and floor scoring. */
export default function ColorSide({ color, onDark = false, size = 'sm' }: ColorSideProps) {
  const label = color === 'white' ? 'White' : 'Black';
  const letter = color === 'white' ? 'W' : 'B';

  return (
    <span
      className={`color-side color-side-${color}${onDark ? ' color-side-on-dark' : ''} color-side-${size}`}
      aria-label={`${label} pieces`}
    >
      <span className="color-side-swatch" aria-hidden>
        {letter}
      </span>
      <span className="color-side-label">{label}</span>
    </span>
  );
}
