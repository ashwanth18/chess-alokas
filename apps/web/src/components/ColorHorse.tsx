type HorseColor = 'white' | 'black';

interface ColorHorseProps {
  color: HorseColor;
  className?: string;
}

/** White ♘ / black ♞ knight marks the player's color on a board. */
export default function ColorHorse({ color, className = '' }: ColorHorseProps) {
  return (
    <span
      className={`color-horse color-horse-${color}${className ? ` ${className}` : ''}`}
      aria-hidden
      title={color === 'white' ? 'White' : 'Black'}
    >
      {color === 'white' ? '♘' : '♞'}
    </span>
  );
}
