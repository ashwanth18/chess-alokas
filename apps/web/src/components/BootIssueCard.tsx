import { useEffect, useState } from 'react';
import {
  formatBootIssue,
  getLastBootIssue,
  subscribeBootIssue,
  type BootIssue,
} from '../lib/bootDiagnostics';
import { copySupportInfo } from '../lib/supportInfo';

export default function BootIssueCard({
  issue: forced,
}: {
  issue?: BootIssue | null;
}) {
  const [issue, setIssue] = useState<BootIssue | null>(forced ?? getLastBootIssue());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (forced !== undefined) {
      setIssue(forced);
      return;
    }
    return subscribeBootIssue(() => setIssue(getLastBootIssue()));
  }, [forced]);

  if (!issue) return null;

  return (
    <div className="form-error boot-issue" role="alert">
      <p>
        <strong>{issue.code}</strong>
        {' — '}
        {issue.message}
      </p>
      {issue.details ? <p className="form-hint-sm">{issue.details}</p> : null}
      <div className="boot-issue-actions">
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => {
            void (async () => {
              const res = await copySupportInfo({});
              if (!res.ok) {
                try {
                  await navigator.clipboard.writeText(formatBootIssue(issue));
                } catch {
                  /* ignore */
                }
              }
              setCopied(true);
            })();
          }}
        >
          {copied ? 'Copied' : 'Copy error details'}
        </button>
        {window.desktop?.openLogsFolder ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void window.desktop?.openLogsFolder?.()}
          >
            Open logs folder
          </button>
        ) : null}
      </div>
    </div>
  );
}
