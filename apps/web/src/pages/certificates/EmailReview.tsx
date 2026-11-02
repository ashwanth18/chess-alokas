import { useId, useState } from 'react';
import { Button, IconSearch, Marker, PlayerName } from '../../ui';
import {
  FILTER_LABEL,
  STATUS_LABEL,
  countLine,
  filterRows,
  plural,
  selectAllIds,
  summarize,
  type ReviewFilter,
  type ReviewRow,
  type ReviewStatus,
} from './reviewLogic';

const TONE: Record<ReviewStatus, string> = {
  ready: 'plain',
  retry: 'wait',
  sent: 'go',
  'no-email': 'flag',
  'invalid-email': 'flag',
};

/**
 * Every certificate the bulk email could send, one row each, with a box to untick. Long lists get a
 * search and a filter. The parent owns what is ticked, so it can send exactly that.
 */
export function EmailReview({
  rows,
  ticked,
  onToggle,
  onSetMany,
  disabled = false,
  initialQuery = '',
  initialFilter = 'all',
}: {
  rows: ReviewRow[];
  ticked: Set<string>;
  onToggle: (issueId: string) => void;
  onSetMany: (issueIds: string[], on: boolean) => void;
  disabled?: boolean;
  initialQuery?: string;
  initialFilter?: ReviewFilter;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<ReviewFilter>(initialFilter);
  const searchId = useId();
  const filterId = useId();
  const summary = summarize(rows, ticked);
  const shown = filterRows(rows, ticked, query, filter);
  const narrowed = shown.length !== rows.length;

  const notes = [
    summary.alreadySent > 0 && `${summary.alreadySent} already sent`,
    summary.noEmail > 0 && `${summary.noEmail} with no email`,
    summary.invalidEmail > 0 && `${summary.invalidEmail} with an email that isn't valid`,
    summary.sharedRows > 0 && `${summary.sharedRows} share an address with someone else`,
  ].filter(Boolean) as string[];

  return (
    <div className="cw-review">
      <div className="cw-review__count" aria-live="polite">
        <p className="cw-review__line" data-testid="review-count">
          <strong>{countLine(summary)}</strong>
          {summary.willSend > 0 && summary.addresses !== summary.willSend && (
            <span>, to {plural(summary.addresses, 'address', 'addresses')}</span>
          )}
          {summary.resends > 0 && (
            <span className="ui-tone-wait">, including {plural(summary.resends, 'resend')}</span>
          )}
        </p>
        {notes.length > 0 && <p className="cw-review__notes">{notes.join('. ')}.</p>}
      </div>

      <div className="cw-review__tools">
        <div className="cw-search">
          <label htmlFor={searchId} className="ui-vh">
            Find a player or email
          </label>
          <IconSearch />
          <input
            id={searchId}
            className="ui-input cw-input"
            type="search"
            placeholder="Find a player or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="cw-inline-field" htmlFor={filterId}>
          <span>Show</span>
          <select
            id={filterId}
            className="ui-input cw-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value as ReviewFilter)}
          >
            {(Object.keys(FILTER_LABEL) as ReviewFilter[]).map((f) => (
              <option key={f} value={f}>
                {FILTER_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <div className="cw-review__bulk">
          <Button size="sm" disabled={disabled} onClick={() => onSetMany(selectAllIds(rows), true)}>
            Select all not yet sent
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={disabled || summary.willSend === 0}
            onClick={() => onSetMany(rows.map((r) => r.issueId), false)}
          >
            Select none
          </Button>
        </div>
      </div>

      {narrowed && (
        <p className="cw-small">
          Showing {shown.length} of {rows.length}.{' '}
          <button
            type="button"
            className="cw-link"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            Show everyone
          </button>
        </p>
      )}

      <div className="cw-table-wrap">
        <table className="cw-table cw-table--review">
          <caption className="ui-vh">Who this email goes to</caption>
          <colgroup>
            <col className="cw-col-check" />
            <col className="cw-col-name" />
            <col className="cw-col-email" />
            <col className="cw-col-type" />
            <col className="cw-col-status" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <span className="ui-vh">Send</span>
              </th>
              <th scope="col">Player</th>
              <th scope="col">Email</th>
              <th scope="col">Certificate</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const on = ticked.has(r.issueId) && r.selectable;
              const who = r.disambiguator ? `${r.name} (${r.disambiguator})` : r.name;
              return (
                <tr
                  key={r.issueId}
                  className={`cw-row${on ? ' is-on' : ''}${r.selectable ? '' : ' is-off'}`}
                  data-status={r.status}
                >
                  <td className="cw-cell-check">
                    <input
                      type="checkbox"
                      className="cw-check"
                      checked={on}
                      disabled={disabled || !r.selectable}
                      aria-label={r.selectable ? `Send to ${who}` : `${who}: ${STATUS_LABEL[r.status]}, can't send`}
                      onChange={() => onToggle(r.issueId)}
                    />
                  </td>
                  <td className="cw-cell-name">
                    <PlayerName name={r.name} disambiguator={r.disambiguator} />
                  </td>
                  <td className="cw-cell-email">
                    <span className="cw-label-sm" aria-hidden="true">
                      Email
                    </span>
                    {r.email ? <span className="cw-email">{r.email}</span> : <span className="cw-faint">None</span>}
                    {r.sharedWith > 0 && (
                      <span className="cw-small cw-shared">
                        Shared with {plural(r.sharedWith, 'other player')}
                      </span>
                    )}
                  </td>
                  <td className="cw-cell-type">
                    <span className="cw-label-sm" aria-hidden="true">
                      Certificate
                    </span>
                    {r.typeLabel}
                    {r.serial && <span className="cw-small ui-num">{r.serial}</span>}
                  </td>
                  <td className="cw-cell-status">
                    <span className={`cw-status ui-tone-${TONE[r.status]}`}>
                      <Marker hollow={r.status !== 'sent'} />
                      {STATUS_LABEL[r.status]}
                    </span>
                    {r.note && <span className="cw-small">{r.note}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="cw-empty-row">
            {query ? `No one matches "${query}".` : `No one in "${FILTER_LABEL[filter]}".`}
          </p>
        )}
      </div>
    </div>
  );
}
