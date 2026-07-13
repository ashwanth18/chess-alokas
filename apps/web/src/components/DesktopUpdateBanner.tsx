import { useEffect, useState } from 'react';
import type { DesktopUpdateStatus } from '../desktop';

const DISMISS_KEY = 'chess-alokas-dismissed-update';

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

export default function DesktopUpdateBanner() {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!window.desktop?.onUpdateStatus) return;
    return window.desktop.onUpdateStatus((next) => {
      setStatus(next);
      if (next.status === 'available' && next.version && dismissedVersion() === next.version) {
        setHidden(true);
      } else if (next.status === 'available' || next.status === 'downloaded' || next.status === 'downloading') {
        setHidden(false);
      }
    });
  }, []);

  if (!window.desktop?.isDesktop || !status || hidden) return null;

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
      ? 'Restart to update'
      : status.status === 'downloading'
        ? `Downloading… ${status.percent ?? 0}%`
        : status.canInstall
          ? 'Download update'
          : 'Get update';

  return (
    <div className="desktop-update-banner" role="status">
      <div className="desktop-update-banner-copy">
        <strong>Update available</strong>
        <span>
          {status.message ||
            `${versionLabel} is ready. You’re on v${status.currentVersion}.`}
        </span>
      </div>
      <div className="desktop-update-banner-actions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={status.status === 'downloading'}
          onClick={() => void primaryAction()}
        >
          {primaryLabel}
        </button>
        {status.status === 'available' && (
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
