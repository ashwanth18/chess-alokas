type HorseColor = 'white' | 'black';

interface ColorHorseProps {
  color: HorseColor;
  className?: string;
}

/** Filled knight silhouette — cream for white, dark for black. */
const KNIGHT_PATH =
  'M22 8c-3.5 0-6 2.5-6.5 5.5-.2 1.3 0 2.6.8 3.7-2 .6-3.5 2.5-4 4.8-.6 2.8.8 5.6 3.2 6.8-1.2 1.6-1.8 3.6-1.2 5.6.7 2.4 2.8 4 5.2 4h10c2.4 0 4.5-1.6 5.2-4 .6-2 .1-4-1.2-5.6 2.4-1.2 3.8-4 3.2-6.8-.5-2.3-2-4.2-4-4.8.8-1.1 1-2.4.8-3.7C28 10.5 25.5 8 22 8zm-2 3c.4 1 .9 1.8 1.5 2.6.6-.8 1.1-1.6 1.5-2.6-.6-.3-1.2-.4-1.5-.4s-.9.1-1.5.4z';

const STYLES: Record<HorseColor, { fill: string; stroke: string }> = {
  white: { fill: '#f5f0e8', stroke: '#4a3c28' },
  black: { fill: '#1a1208', stroke: '#8a7a60' },
};

export default function ColorHorse({ color, className = '' }: ColorHorseProps) {
  const { fill, stroke } = STYLES[color];

  return (
    <span
      className={`color-horse color-horse-${color}${className ? ` ${className}` : ''}`}
      title={color === 'white' ? 'White' : 'Black'}
    >
      <svg
        className="color-horse-svg"
        viewBox="0 0 44 44"
        aria-hidden
        focusable="false"
      >
        <path
          d={KNIGHT_PATH}
          fill={fill}
          stroke={stroke}
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
