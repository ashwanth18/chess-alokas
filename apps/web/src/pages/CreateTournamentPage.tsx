import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STYLE_META } from '@chess-alokas/pairing-engine';
import { PRESET_FILTERS } from '@chess-alokas/shared';
import type { FilterGroup, FilterOp, TournamentStyle } from '@chess-alokas/shared';
import { db, nowIso } from '../db/local';
import { apiCreateTournament } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  DEFAULT_PRIZE_PLACES,
  MAX_PRIZE_PLACES,
  MIN_PRIZE_PLACES,
  clampPrizePlaces,
} from '../lib/prizePlaces';

interface CategoryDraft {
  id: string;
  name: string;
  filter: FilterGroup;
  /** Blank = inherit tournament default. */
  prizePlaces: number | null;
}

const FIELD_OPTIONS = ['age', 'gender', 'rating', 'club'] as const;
const OP_OPTIONS: FilterOp[] = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in'];
const OP_LABELS: Record<FilterOp, string> = {
  eq: '=',
  neq: '≠',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  in: 'in',
};

const PRESETS: Array<{ label: string; key: keyof typeof PRESET_FILTERS }> = [
  { label: 'Under 12', key: 'under12' },
  { label: 'Under 18', key: 'under18' },
  { label: 'Female', key: 'female' },
  { label: 'Male', key: 'male' },
];

function newCategory(): CategoryDraft {
  return {
    id: crypto.randomUUID(),
    name: '',
    filter: { logic: 'and', rules: [] },
    prizePlaces: null,
  };
}

export default function CreateTournamentPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [style, setStyle] = useState<TournamentStyle>('swiss');
  const [rounds, setRounds] = useState(5);
  const [prizePlaces, setPrizePlaces] = useState(DEFAULT_PRIZE_PLACES);
  const [awardScope, setAwardScope] = useState<'overall' | 'per_category'>('per_category');
  const [mixCategories, setMixCategories] = useState(false);
  const [categories, setCategories] = useState<CategoryDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addCategory() {
    setCategories((cs) => [...cs, newCategory()]);
  }

  function removeCategory(id: string) {
    setCategories((cs) => cs.filter((c) => c.id !== id));
  }

  function updateCategory(id: string, patch: Partial<CategoryDraft>) {
    setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function applyPreset(catId: string, key: keyof typeof PRESET_FILTERS) {
    const preset = PRESET_FILTERS[key];
    updateCategory(catId, { filter: preset as FilterGroup });
  }

  function addRule(catId: string) {
    setCategories((cs) =>
      cs.map((c) => {
        if (c.id !== catId) return c;
        return {
          ...c,
          filter: {
            ...c.filter,
            rules: [
              ...c.filter.rules,
              { field: 'age', op: 'lt' as FilterOp, value: 12 },
            ],
          },
        };
      }),
    );
  }

  function removeRule(catId: string, ruleIdx: number) {
    setCategories((cs) =>
      cs.map((c) => {
        if (c.id !== catId) return c;
        return {
          ...c,
          filter: {
            ...c.filter,
            rules: c.filter.rules.filter((_, i) => i !== ruleIdx),
          },
        };
      }),
    );
  }

  function updateRule(
    catId: string,
    ruleIdx: number,
    patch: { field?: string; op?: FilterOp; value?: string | number },
  ) {
    setCategories((cs) =>
      cs.map((c) => {
        if (c.id !== catId) return c;
        return {
          ...c,
          filter: {
            ...c.filter,
            rules: c.filter.rules.map((r, i) =>
              i === ruleIdx ? { ...r, ...patch } : r,
            ),
          },
        };
      }),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Tournament name is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const tournamentId = crypto.randomUUID();
      const now = nowIso();

      await db.tournaments.put({
        id: tournamentId,
        name: name.trim(),
        date: date || null,
        style,
        rounds,
        status: 'draft',
        currentRound: 0,
        mixCategories,
        prizePlaces: clampPrizePlaces(prizePlaces),
        awardScope,
        ownerId: auth.user?.id ?? null,
        updatedAt: now,
        dirty: 1,
      });

      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i]!;
        await db.categories.put({
          id: cat.id,
          tournamentId,
          name: cat.name || `Category ${i + 1}`,
          filter: cat.filter,
          sortOrder: i,
          prizePlaces: cat.prizePlaces == null ? null : clampPrizePlaces(cat.prizePlaces),
          updatedAt: now,
          dirty: 1,
        });
      }

      // Try API in background (don't block UI)
      apiCreateTournament({
        id: tournamentId,
        name: name.trim(),
        date: date || null,
        style,
        rounds,
        mixCategories,
        prizePlaces: clampPrizePlaces(prizePlaces),
        awardScope,
        status: 'draft',
        currentRound: 0,
      }).catch(() => {});

      navigate(`/tournaments/${tournamentId}`);
    } catch (err) {
      setError('Failed to save tournament');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>New Tournament</h1>
      </div>

      <form className="form-card" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="form-group">
          <label htmlFor="name">Tournament Name</label>
          <input
            id="name"
            type="text"
            className="input"
            placeholder="e.g. Spring Open 2026"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="date">Date</label>
            <input
              id="date"
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="rounds">Rounds</label>
            <input
              id="rounds"
              type="number"
              className="input"
              min={1}
              max={20}
              value={rounds}
              onChange={(e) => setRounds(Math.max(1, parseInt(e.target.value) || 5))}
            />
          </div>

          <div className="form-group">
            <label htmlFor="prizePlaces">Prize places (top N)</label>
            <input
              id="prizePlaces"
              type="number"
              className="input"
              min={MIN_PRIZE_PLACES}
              max={MAX_PRIZE_PLACES}
              value={prizePlaces}
              onChange={(e) =>
                setPrizePlaces(clampPrizePlaces(parseInt(e.target.value, 10) || DEFAULT_PRIZE_PLACES))
              }
            />
            <span className="form-hint-sm">
              Top {prizePlaces} get podium styling and winner certificates.
            </span>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="awardScope">Winner certificate scope</label>
          <select
            id="awardScope"
            className="input"
            value={awardScope}
            onChange={(e) => setAwardScope(e.target.value as 'overall' | 'per_category')}
          >
            <option value="per_category">Per category</option>
            <option value="overall">Overall standings</option>
          </select>
        </div>

        <div className="form-group">
          <label>Pairing Style</label>
          <div className="style-grid">
            {(Object.entries(STYLE_META) as [TournamentStyle, { label: string; implemented: boolean }][]).map(
              ([key, meta]) => (
                <button
                  key={key}
                  type="button"
                  className={`style-card ${style === key ? 'active' : ''} ${!meta.implemented ? 'disabled' : ''}`}
                  onClick={() => meta.implemented && setStyle(key)}
                  disabled={!meta.implemented}
                >
                  <span className="style-name">{meta.label}</span>
                  {!meta.implemented && <span className="style-badge">Coming soon</span>}
                  {meta.implemented && <span className="style-badge available">Available</span>}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-header">
            <h3>Categories</h3>
            <button type="button" className="btn btn-sm btn-outline" onClick={addCategory}>
              + Add Category
            </button>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={mixCategories}
              onChange={(e) => setMixCategories(e.target.checked)}
            />
            <span>
              <strong>Allow mixed matches</strong>
              <span className="form-hint-sm">
                {mixCategories
                  ? 'Players from all categories share one pairing pool and one ranking.'
                  : 'Default: players only play within their category (e.g. U12 vs U12) with separate rankings.'}
              </span>
            </span>
          </label>

          {categories.length === 0 && (
            <p className="form-hint">
              Add categories like Under 12 / Under 18 so pairings and standings stay separate by default.
            </p>
          )}

          {categories.map((cat, ci) => (
            <div key={cat.id} className="category-block">
              <div className="category-header">
                <input
                  type="text"
                  className="input input-sm"
                  placeholder={`Category ${ci + 1} name`}
                  value={cat.name}
                  onChange={(e) => updateCategory(cat.id, { name: e.target.value })}
                />
                <label className="category-prize-override">
                  <span className="preset-label">Prize places</span>
                  <input
                    type="number"
                    className="input input-xs"
                    min={MIN_PRIZE_PLACES}
                    max={MAX_PRIZE_PLACES}
                    placeholder={String(prizePlaces)}
                    value={cat.prizePlaces ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      updateCategory(cat.id, {
                        prizePlaces: raw === '' ? null : clampPrizePlaces(parseInt(raw, 10)),
                      });
                    }}
                    title="Leave blank to use tournament default"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-danger"
                  onClick={() => removeCategory(cat.id)}
                >
                  Remove
                </button>
              </div>

              <div className="preset-row">
                <span className="preset-label">Presets:</span>
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className="btn btn-xs btn-outline"
                    onClick={() => applyPreset(cat.id, p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="rules-list">
                <div className="rules-header">
                  <span>Filter Rules</span>
                  <select
                    className="input input-xs"
                    value={cat.filter.logic}
                    onChange={(e) =>
                      updateCategory(cat.id, {
                        filter: { ...cat.filter, logic: e.target.value as 'and' | 'or' },
                      })
                    }
                  >
                    <option value="and">Match ALL (and)</option>
                    <option value="or">Match ANY (or)</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-xs btn-outline"
                    onClick={() => addRule(cat.id)}
                  >
                    + Rule
                  </button>
                </div>

                {cat.filter.rules.map((rule, ri) => (
                  <div key={ri} className="rule-row">
                    <select
                      className="input input-xs"
                      value={rule.field}
                      onChange={(e) => updateRule(cat.id, ri, { field: e.target.value })}
                    >
                      {FIELD_OPTIONS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                    <select
                      className="input input-xs"
                      value={rule.op}
                      onChange={(e) =>
                        updateRule(cat.id, ri, { op: e.target.value as FilterOp })
                      }
                    >
                      {OP_OPTIONS.map((op) => (
                        <option key={op} value={op}>
                          {OP_LABELS[op]}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      className="input input-xs"
                      value={String(rule.value)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = Number(raw);
                        updateRule(cat.id, ri, {
                          value: !isNaN(num) && raw !== '' ? num : raw,
                        });
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost btn-danger"
                      onClick={() => removeRule(cat.id, ri)}
                    >
                      ×
                    </button>
                  </div>
                ))}

                {cat.filter.rules.length === 0 && (
                  <p className="form-hint-sm">No rules — all participants match.</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create Tournament'}
          </button>
        </div>
      </form>
    </div>
  );
}
