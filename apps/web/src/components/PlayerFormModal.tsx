import { FormEvent, useState } from 'react';
import type { LocalParticipant } from '../db/local';
import { draftFromPlayer, validatePlayerDraft, type PlayerDraft } from '../lib/playerEditing';

type Props = {
  player: LocalParticipant | null;
  categories: { id: string; name: string }[];
  /** Separate-category tournaments only pair players who are in a category. */
  categoryRequired: boolean;
  /** Round the player already played in: moving them between categories would corrupt it. */
  lockedByRound: number | null;
  onSave: (draft: PlayerDraft) => Promise<void>;
  onClose: () => void;
};

export default function PlayerFormModal({
  player,
  categories,
  categoryRequired,
  lockedByRound,
  onSave,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<PlayerDraft>(() => draftFromPlayer(player));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof PlayerDraft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = validatePlayerDraft(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (categoryRequired && draft.categoryIds.length === 0) {
      setError('Choose a category, or this player will not be paired.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this player.');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={player ? `Edit ${player.name}` : 'Add player'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{player ? 'Edit player' : 'Add player'}</h2>
          <button type="button" className="btn btn-sm btn-ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <form className="auth-form" onSubmit={(e) => void submit(e)}>
          <label>
            Full name *
            <input className="input" value={draft.name} onChange={set('name')} required autoFocus />
          </label>
          <div className="player-form-grid">
            <label>
              Year of birth
              <input
                className="input"
                type="number"
                inputMode="numeric"
                value={draft.yearOfBirth}
                onChange={set('yearOfBirth')}
              />
            </label>
            <label>
              Gender
              <select className="input" value={draft.gender} onChange={set('gender')}>
                <option value="">—</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </label>
            <label>
              FIDE rating
              <input
                className="input"
                type="number"
                inputMode="numeric"
                value={draft.rating}
                onChange={set('rating')}
              />
            </label>
            <label>
              FIDE ID
              <input
                className="input"
                inputMode="numeric"
                value={draft.fideId}
                onChange={set('fideId')}
              />
            </label>
          </div>
          <label>
            School
            <input className="input" value={draft.school} onChange={set('school')} />
          </label>
          <label>
            Club
            <input className="input" value={draft.club} onChange={set('club')} />
          </label>
          <label>
            Email
            <input className="input" type="email" value={draft.email} onChange={set('email')} />
          </label>
          {categories.length > 0 && (
            <fieldset className="player-form-categories">
              <legend>Category{categoryRequired ? ' *' : ''}</legend>
              {lockedByRound != null && (
                <p className="form-hint">
                  Already paired in Round {lockedByRound}, so the category can’t change.
                </p>
              )}
              {categories.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    disabled={lockedByRound != null}
                    checked={draft.categoryIds.includes(c.id)}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        categoryIds: e.target.checked
                          ? [...d.categoryIds, c.id]
                          : d.categoryIds.filter((id) => id !== c.id),
                      }))
                    }
                  />
                  {c.name}
                </label>
              ))}
            </fieldset>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="player-form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : player ? 'Save changes' : 'Add player'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
