import { useEffect, useState } from 'react';
import type { DesktopUpdateStatus } from '../desktop';

const DISMISS_KEY = 'chess-alokas-dismissed-update';

type JustUpdatedNotice = {
  from: string;
  to: string;
};

function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function dismissVersion(version: string) {
  try {
    localStorage.setItem(DISMISS_KEY, version);
  } catch {
    /* ignore */
  }
}

function noticeFromStatus(status: DesktopUpdateStatus): JustUpdatedNotice | null {
  if (status.status !== 'just-updated' || !status.version) return null;
  return {
    from: status.previousVersion ?? status.currentVersion,
    to: status.version,
  };
}

export default function DesktopUpdateBanner() {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [justUpdated, setJustUpdated] = useState<JustUpdatedNotice | null>(null);

  useEffect(() => {
    if (!window.desktop?.isDesktop) return;

    void window.desktop.getUpdateStatus().then((next) => {
      setStatus(next);
      const notice = noticeFromStatus(next);
      if (notice) {
        setJustUpdated(notice);
        setHidden(false);
      }
    });

    if (!window.desktop.onUpdateStatus) return;
    return window.desktop.onUpdateStatus((next) => {
      const notice = noticeFromStatus(next);
      if (notice) {
        setJustUpdated(notice);
        setHidden(false);
        setStatus(next);
        return;
      }
      setStatus(next);
      if (
        (next.status === 'available' ||
          next.status === 'downloading' ||
          next.status === 'downloaded') &&
        next.version &&
        dismissedVersion() === next.version &&
        next.status !== 'downloaded'
      ) {
        setHidden(true);
      } else if (
        next.status === 'available' ||
        next.status === 'downloaded' ||
        next.status === 'downloading'
      ) {
        setHidden(false);
      }
    });
  }, []);

  if (!window.desktop?.isDesktop || hidden) return null;

  if (justUpdated) {
    return (
      <div className="desktop-update-banner is-success" role="status">
        <div className="desktop-update-banner-copy">
          <strong>Updated to v{justUpdated.to}</strong>
          <span>
            Chess Alokas restarted with the latest build
            {justUpdated.from !== justUpdated.to ? ` (was v${justUpdated.from})` : ''}.
          </span>
        </div>
        <div className="desktop-update-banner-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setJustUpdated(null);
              void window.desktop?.dismissJustUpdated?.();
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (!status) return null;

  const show =
    status.status === 'available' ||
    status.status === 'downloading' ||
    status.status === 'downloaded';
  if (!show) return null;

  const versionLabel = status.version ? `v${status.version}` : 'a new version';

  async function primaryAction() {
    if (!window.desktop) return;
    if (status?.status === 'downloaded') {
      await window.desktop.installUpdate();
      return;
    }
    if (status?.canInstall) {
      await window.desktop.downloadUpdate();
      return;
    }
    await window.desktop.openDownloadPage(status?.downloadPageUrl);
  }

  const primaryLabel =
    status.status === 'downloaded'
      ? 'Restart & update'
      : status.status === 'downloading'
        ? `Downloading… ${status.percent ?? 0}%`
        : status.canInstall
          ? 'Download update'
          : 'Get update';

  return (
    <div className="desktop-update-banner" role="status">
      <div className="desktop-update-banner-copy">
        <strong>
          {status.status === 'downloaded'
            ? 'Update ready'
            : status.status === 'downloading'
              ? 'Updating'
              : 'Update available'}
        </strong>
        <span>
          {status.message ||
            `${versionLabel} is ready. You’re on v${status.currentVersion}.`}
        </span>
        {status.status === 'downloading' && (
          <div
            className="desktop-update-progress"
            role="progressbar"
            aria-valuenow={status.percent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="desktop-update-progress-bar"
              style={{ width: `${Math.min(100, Math.max(0, status.percent ?? 0))}%` }}
            />
          </div>
        )}
      </div>
      <div className="desktop-update-banner-actions">
        {status.status === 'downloaded' || !status.canInstall ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void primaryAction()}
          >
            {primaryLabel}
          </button>
        ) : status.status === 'downloading' ? (
          <span className="desktop-update-pct">{status.percent ?? 0}%</span>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void primaryAction()}
          >
            {primaryLabel}
          </button>
        )}
        {(status.status === 'available' || status.status === 'downloading') && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              if (status.version) dismissVersion(status.version);
              setHidden(true);
            }}
          >
            Later
          </button>
        )}
      </div>
    </div>
  );
}
