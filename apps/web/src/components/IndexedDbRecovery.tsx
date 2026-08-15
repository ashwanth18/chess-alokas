import { useState } from 'react';
import BootIssueCard from './BootIssueCard';
import { ensureDbOpen } from '../db/local';

export default function IndexedDbRecovery({ details }: { details?: string }) {
  const [busy, setBusy] = useState(false);
  const dataPath = window.desktop?.getUserDataPath?.();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Offline data could not open</h1>
        <p className="form-hint">
          Chess Alokas could not open its local database on this computer. This is usually another
          copy of the app still running, or Windows locking the store.
        </p>
        <ol className="form-hint" style={{ paddingLeft: '1.2rem', margin: '0.75rem 0' }}>
          <li>Close every Chess Alokas window.</li>
          <li>In Task Manager, end any leftover Chess Alokas process.</li>
          <li>Click Try again.</li>
        </ol>
        <BootIssueCard />
        {details ? <p className="form-hint-sm">{details}</p> : null}
        {dataPath ? (
          <p className="form-hint-sm">
            Data folder: <code>{dataPath}</code>
          </p>
        ) : null}
        <div className="boot-issue-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void ensureDbOpen().then((result) => {
                if (result.ok) window.location.reload();
                else setBusy(false);
              });
            }}
          >
            {busy ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      </div>
    </div>
  );
}
