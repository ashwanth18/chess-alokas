import {
  DEFAULT_TIEBREAK_ORDER,
  TIEBREAK_LABELS,
  normalizeTiebreakOrder,
  type TiebreakKey,
} from '@chess-alokas/shared';

const OPTIONAL_KEYS = DEFAULT_TIEBREAK_ORDER.filter((k) => k !== 'seed');

type Props = {
  order: TiebreakKey[];
  sharedPlaces: boolean;
  onOrderChange: (order: TiebreakKey[]) => void;
  onSharedPlacesChange: (value: boolean) => void;
  /** Compact layout for settings modal */
  compact?: boolean;
};

export default function TiebreakOrderEditor({
  order,
  sharedPlaces,
  onOrderChange,
  onSharedPlacesChange,
  compact,
}: Props) {
  const enabled = normalizeTiebreakOrder(order);
  const enabledSet = new Set(enabled);

  function setEnabledOrder(next: TiebreakKey[]) {
    onOrderChange(normalizeTiebreakOrder(next));
  }

  function toggle(key: TiebreakKey, on: boolean) {
    if (key === 'seed') return;
    if (on) {
      const withoutSeed = enabled.filter((k) => k !== 'seed');
      setEnabledOrder([...withoutSeed, key, 'seed']);
    } else {
      setEnabledOrder(enabled.filter((k) => k !== key));
    }
  }

  function move(index: number, dir: -1 | 1) {
    const movable = enabled.filter((k) => k !== 'seed');
    const seedTail = enabled.includes('seed') ? (['seed'] as TiebreakKey[]) : [];
    const j = index + dir;
    if (j < 0 || j >= movable.length) return;
    const next = [...movable];
    const tmp = next[index]!;
    next[index] = next[j]!;
    next[j] = tmp;
    setEnabledOrder([...next, ...seedTail]);
  }

  return (
    <div className={`tiebreak-editor ${compact ? 'is-compact' : ''}`.trim()}>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={sharedPlaces}
          onChange={(e) => onSharedPlacesChange(e.target.checked)}
        />
        Shared places when performance tiebreaks match (e.g. 1, 2, 2, 4)
      </label>

      <p className={`form-hint${compact ? '-sm' : ''}`}>
        Score is always first. Choose which tiebreaks to use and their order. Seed stays last as
        a display fallback.
      </p>

      <ol className="tiebreak-order-list">
        {enabled
          .filter((k) => k !== 'seed')
          .map((key, index, arr) => (
            <li key={key} className="tiebreak-order-item">
              <label className="tiebreak-order-label">
                <input
                  type="checkbox"
                  checked
                  onChange={() => toggle(key, false)}
                />
                <span>
                  {index + 1}. {TIEBREAK_LABELS[key]}
                </span>
              </label>
              <span className="tiebreak-order-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={index === 0}
                  aria-label={`Move ${TIEBREAK_LABELS[key]} up`}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={index === arr.length - 1}
                  aria-label={`Move ${TIEBREAK_LABELS[key]} down`}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </span>
            </li>
          ))}
        <li className="tiebreak-order-item is-locked">
          <span>
            {enabled.filter((k) => k !== 'seed').length + 1}. {TIEBREAK_LABELS.seed}{' '}
            <span className="form-hint-sm">(always last)</span>
          </span>
        </li>
      </ol>

      <div className="tiebreak-add-row">
        <span className="form-hint-sm">Add:</span>
        {OPTIONAL_KEYS.filter((k) => !enabledSet.has(k)).map((key) => (
          <button
            key={key}
            type="button"
            className="btn btn-xs btn-outline"
            onClick={() => toggle(key, true)}
          >
            + {TIEBREAK_LABELS[key]}
          </button>
        ))}
        {OPTIONAL_KEYS.every((k) => enabledSet.has(k)) && (
          <span className="form-hint-sm">All rules enabled</span>
        )}
      </div>

      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => setEnabledOrder([...DEFAULT_TIEBREAK_ORDER])}
      >
        Reset to default
      </button>
    </div>
  );
}
