import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { app, shell, type BrowserWindow } from 'electron';
import log from 'electron-log/main';
import type { AppUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';

export type UpdateStatusPayload = {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'just-updated'
    | 'error';
  currentVersion: string;
  previousVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
  /** When auto-install isn't possible (portable / unsigned mac), open this URL instead. */
  downloadPageUrl?: string;
  canInstall: boolean;
};

const RELEASES_PAGE = 'https://github.com/ashwanth18/chess-alokas/releases/latest';
const RELEASES_API = 'https://api.github.com/repos/ashwanth18/chess-alokas/releases/latest';
const PENDING_UPDATE_FILE = 'pending-update.json';

type PendingUpdateMarker = {
  from: string;
  to: string;
};

/** electron-updater is CommonJS; ESM named imports break in packaged Electron. */
function loadAutoUpdater(): AppUpdater | null {
  try {
    const require = createRequire(import.meta.url);
    const mod = require('electron-updater') as { autoUpdater: AppUpdater };
    return mod.autoUpdater;
  } catch (err) {
    log.error('Failed to load electron-updater — using GitHub download page only', err);
    return null;
  }
}

let lastStatus: UpdateStatusPayload = {
  status: 'idle',
  currentVersion: app.getVersion(),
  canInstall: false,
};

let startupJustUpdated: PendingUpdateMarker | null = null;

export function getLastUpdateStatus(): UpdateStatusPayload {
  if (startupJustUpdated) {
    return {
      status: 'just-updated',
      currentVersion: app.getVersion(),
      previousVersion: startupJustUpdated.from,
      version: startupJustUpdated.to,
      message: `Updated to v${startupJustUpdated.to}.`,
      canInstall: false,
    };
  }
  return { ...lastStatus, currentVersion: app.getVersion() };
}

function pendingUpdatePath(): string {
  return path.join(app.getPath('userData'), PENDING_UPDATE_FILE);
}

function writePendingUpdate(toVersion: string) {
  const marker: PendingUpdateMarker = {
    from: app.getVersion(),
    to: parseTag(toVersion),
  };
  try {
    fs.writeFileSync(pendingUpdatePath(), JSON.stringify(marker), 'utf8');
  } catch (err) {
    log.warn('Could not write pending-update marker', err);
  }
}

/** After silent install + relaunch, surface a one-shot “updated” notice. */
function consumePendingUpdate(): PendingUpdateMarker | null {
  const file = pendingUpdatePath();
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    fs.unlinkSync(file);
    const marker = JSON.parse(raw) as PendingUpdateMarker;
    const current = parseTag(app.getVersion());
    const expected = parseTag(marker.to ?? '');
    const from = parseTag(marker.from ?? '');
    if (!expected || current !== expected) {
      log.info('Pending update marker ignored', { current, expected, from });
      return null;
    }
    return { from: from || current, to: current };
  } catch (err) {
    log.warn('Could not read pending-update marker', err);
    return null;
  }
}

function isPortableBuild(): boolean {
  return Boolean(
    process.env['PORTABLE_EXECUTABLE_DIR'] ||
      process.env['PORTABLE_EXECUTABLE_FILE'] ||
      process.env['PORTABLE_EXECUTABLE_APP_FILENAME'],
  );
}

function canAutoInstall(updater: AppUpdater | null): boolean {
  if (!updater) return false;
  if (isPortableBuild()) return false;
  // Unsigned mac updates via electron-updater are unreliable; send users to the release page.
  if (process.platform === 'darwin') return false;
  return app.isPackaged;
}

function send(
  getWindow: () => BrowserWindow | null,
  payload: Omit<UpdateStatusPayload, 'currentVersion' | 'canInstall'> &
    Partial<Pick<UpdateStatusPayload, 'canInstall' | 'previousVersion'>>,
  updater: AppUpdater | null,
) {
  lastStatus = {
    currentVersion: app.getVersion(),
    canInstall: payload.canInstall ?? canAutoInstall(updater),
    ...payload,
  };
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('desktop:update-status', lastStatus);
}

function parseTag(tag: string): string {
  return tag.replace(/^v/i, '').trim();
}

function isNewer(remote: string, local: string): boolean {
  const toParts = (v: string) =>
    parseTag(v)
      .split('.')
      .map((p) => Number.parseInt(p.replace(/[^0-9].*$/, ''), 10) || 0);
  const a = toParts(remote);
  const b = toParts(local);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d > 0) return true;
    if (d < 0) return false;
  }
  return false;
}

/** Fallback when GitHub feed / latest.yml is missing: compare release tags via API. */
async function checkViaGithubApi(
  getWindow: () => BrowserWindow | null,
  updater: AppUpdater | null,
): Promise<boolean> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Chess-Alokas-Desktop',
      },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { tag_name?: string; html_url?: string };
    const remote = body.tag_name ? parseTag(body.tag_name) : '';
    if (!remote || !isNewer(remote, app.getVersion())) {
      send(
        getWindow,
        { status: 'not-available', message: 'You’re on the latest version.' },
        updater,
      );
      return true;
    }
    send(
      getWindow,
      {
        status: 'available',
        version: remote,
        message: `Version ${remote} is available.`,
        downloadPageUrl: body.html_url ?? RELEASES_PAGE,
        canInstall: false,
      },
      updater,
    );
    return true;
  } catch (err) {
    log.warn('GitHub release check failed', err);
    return false;
  }
}

export function setupAutoUpdater(getWindow: () => BrowserWindow | null) {
  const autoUpdater = loadAutoUpdater();
  startupJustUpdated = consumePendingUpdate();
  if (startupJustUpdated) {
    log.info('App relaunched after update', startupJustUpdated);
    lastStatus = {
      status: 'just-updated',
      currentVersion: app.getVersion(),
      previousVersion: startupJustUpdated.from,
      version: startupJustUpdated.to,
      message: `Updated to v${startupJustUpdated.to}.`,
      canInstall: false,
    };
  }

  if (autoUpdater) {
    autoUpdater.logger = log;
    // Download as soon as an update is found — user only confirms restart.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => {
      send(getWindow, { status: 'checking', message: 'Checking for updates…' }, autoUpdater);
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      send(
        getWindow,
        {
          status: 'downloading',
          version: info.version,
          percent: 0,
          message: `Downloading v${info.version}…`,
          downloadPageUrl: RELEASES_PAGE,
          canInstall: canAutoInstall(autoUpdater),
        },
        autoUpdater,
      );
    });

    autoUpdater.on('update-not-available', () => {
      send(
        getWindow,
        { status: 'not-available', message: 'You’re on the latest version.' },
        autoUpdater,
      );
    });

    autoUpdater.on('download-progress', (p: ProgressInfo) => {
      send(
        getWindow,
        {
          status: 'downloading',
          percent: Math.round(p.percent),
          message: `Downloading update… ${Math.round(p.percent)}%`,
          canInstall: true,
        },
        autoUpdater,
      );
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      writePendingUpdate(info.version);
      send(
        getWindow,
        {
          status: 'downloaded',
          version: info.version,
          message: `v${info.version} ready — restart to install silently.`,
          canInstall: true,
        },
        autoUpdater,
      );
    });

    autoUpdater.on('error', (err: Error) => {
      log.error('autoUpdater error', err);
      void checkViaGithubApi(getWindow, autoUpdater).then((ok) => {
        if (!ok) {
          send(
            getWindow,
            {
              status: 'error',
              message: err.message || 'Update check failed',
              downloadPageUrl: RELEASES_PAGE,
              canInstall: false,
            },
            autoUpdater,
          );
        }
      });
    });
  }

  return {
    /** Push the post-install notice once the window can receive IPC. */
    announceJustUpdated() {
      if (!startupJustUpdated) return;
      send(
        getWindow,
        {
          status: 'just-updated',
          previousVersion: startupJustUpdated.from,
          version: startupJustUpdated.to,
          message: `Updated to v${startupJustUpdated.to}.`,
          canInstall: false,
        },
        autoUpdater,
      );
    },

    async check() {
      // Drop post-install notice once the normal update cycle starts.
      startupJustUpdated = null;
      send(getWindow, { status: 'checking', message: 'Checking for updates…' }, autoUpdater);
      if (!app.isPackaged || !canAutoInstall(autoUpdater)) {
        const ok = await checkViaGithubApi(getWindow, autoUpdater);
        if (!ok) {
          send(
            getWindow,
            {
              status: 'not-available',
              message: app.isPackaged
                ? 'Could not check for updates right now.'
                : 'Update checks run fully in packaged builds.',
            },
            autoUpdater,
          );
        }
        return;
      }

      try {
        await autoUpdater!.checkForUpdates();
      } catch (err) {
        log.warn('electron-updater check failed, using GitHub API', err);
        const ok = await checkViaGithubApi(getWindow, autoUpdater);
        if (!ok) {
          send(
            getWindow,
            {
              status: 'error',
              message: err instanceof Error ? err.message : 'Update check failed',
              downloadPageUrl: RELEASES_PAGE,
              canInstall: false,
            },
            autoUpdater,
          );
        }
      }
    },

    async download() {
      if (!canAutoInstall(autoUpdater)) {
        await shell.openExternal(RELEASES_PAGE);
        return;
      }
      try {
        await autoUpdater!.downloadUpdate();
      } catch (err) {
        log.error('downloadUpdate failed', err);
        send(
          getWindow,
          {
            status: 'error',
            message: err instanceof Error ? err.message : 'Download failed',
            downloadPageUrl: RELEASES_PAGE,
            canInstall: false,
          },
          autoUpdater,
        );
      }
    },

    install() {
      if (!canAutoInstall(autoUpdater)) {
        void shell.openExternal(RELEASES_PAGE);
        return;
      }
      if (lastStatus.version) writePendingUpdate(lastStatus.version);
      // Silent NSIS (/S) — no Next/Next wizard; relaunch after install.
      autoUpdater!.quitAndInstall(true, true);
    },

    openDownloadPage(url?: string) {
      void shell.openExternal(url || RELEASES_PAGE);
    },
  };
}
