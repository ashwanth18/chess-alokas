type SideColor = 'white' | 'black';

interface ColorSideProps {
  color: SideColor;
  /** When true, use high-contrast styling for dark row backgrounds. */
  onDark?: boolean;
}

/** Clear W/B badge + label for pairing sheets. */
export default function ColorSide({ color, onDark = false }: ColorSideProps) {
  const label = color === 'white' ? 'White' : 'Black';
  const letter = color === 'white' ? 'W' : 'B';

  return (
    <span
      className={`color-side color-side-${color}${onDark ? ' color-side-on-dark' : ''}`}
      aria-label={`${label} pieces`}
    >
      <span className="color-side-swatch" aria-hidden>
        {letter}
      </span>
      <span className="color-side-label">{label}</span>
    </span>
  );
}
