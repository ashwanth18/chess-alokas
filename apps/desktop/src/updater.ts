import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
  /** Direct installer asset URL (never a GitHub HTML page). */
  installerUrl?: string;
  /** Local path after a manual installer download. */
  localInstallerPath?: string;
  /** True when electron-updater can quitAndInstall silently (NSIS). */
  canInstall: boolean;
};

const RELEASES_API = 'https://api.github.com/repos/ashwanth18/chess-alokas/releases/latest';
const PENDING_UPDATE_FILE = 'pending-update.json';
const LAST_SEEN_VERSION_FILE = 'last-seen-version.txt';
const JUST_UPDATED_NOTICE_FILE = 'just-updated-notice.json';

type PendingUpdateMarker = {
  from: string;
  to: string;
};

type GithubReleaseAsset = {
  name: string;
  browser_download_url: string;
  size?: number;
};

type GithubRelease = {
  tag_name?: string;
  assets?: GithubReleaseAsset[];
};

/** electron-updater is CommonJS; ESM named imports break in packaged Electron. */
function loadAutoUpdater(): AppUpdater | null {
  try {
    const require = createRequire(import.meta.url);
    const mod = require('electron-updater') as { autoUpdater: AppUpdater };
    return mod.autoUpdater;
  } catch (err) {
    log.error('Failed to load electron-updater — using direct installer download', err);
    return null;
  }
}

let lastStatus: UpdateStatusPayload = {
  status: 'idle',
  currentVersion: app.getVersion(),
  canInstall: false,
};

/** Survives until the renderer dismisses it (not cleared by update checks). */
let activeJustUpdated: PendingUpdateMarker | null = null;

/** Cached installer URL / local path for portable, mac, or updater fallback. */
let pendingInstallerUrl: string | null = null;
let pendingLocalInstaller: string | null = null;
let downloadInFlight = false;

function userDataFile(name: string): string {
  return path.join(app.getPath('userData'), name);
}

function readJustUpdatedNoticeFile(): PendingUpdateMarker | null {
  try {
    const file = userDataFile(JUST_UPDATED_NOTICE_FILE);
    if (!fs.existsSync(file)) return null;
    const marker = JSON.parse(fs.readFileSync(file, 'utf8')) as PendingUpdateMarker;
    if (!marker?.from || !marker?.to) return null;
    return { from: parseTag(marker.from), to: parseTag(marker.to) };
  } catch {
    return null;
  }
}

function writeJustUpdatedNoticeFile(marker: PendingUpdateMarker) {
  try {
    fs.writeFileSync(userDataFile(JUST_UPDATED_NOTICE_FILE), JSON.stringify(marker), 'utf8');
  } catch (err) {
    log.warn('Could not write just-updated notice', err);
  }
}

function clearJustUpdatedNoticeFile() {
  try {
    const file = userDataFile(JUST_UPDATED_NOTICE_FILE);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

function justUpdatedPayload(marker: PendingUpdateMarker): UpdateStatusPayload {
  return {
    status: 'just-updated',
    currentVersion: app.getVersion(),
    previousVersion: marker.from,
    version: marker.to,
    message: `Updated to v${marker.to}.`,
    canInstall: false,
  };
}

export function getLastUpdateStatus(): UpdateStatusPayload {
  if (activeJustUpdated) return justUpdatedPayload(activeJustUpdated);
  return { ...lastStatus, currentVersion: app.getVersion() };
}

export function dismissJustUpdatedNotice(): UpdateStatusPayload {
  activeJustUpdated = null;
  clearJustUpdatedNoticeFile();
  if (lastStatus.status === 'just-updated') {
    lastStatus = {
      status: 'idle',
      currentVersion: app.getVersion(),
      canInstall: false,
    };
  }
  return getLastUpdateStatus();
}

function writePendingUpdate(toVersion: string) {
  const marker: PendingUpdateMarker = {
    from: app.getVersion(),
    to: parseTag(toVersion),
  };
  try {
    fs.writeFileSync(userDataFile(PENDING_UPDATE_FILE), JSON.stringify(marker), 'utf8');
  } catch (err) {
    log.warn('Could not write pending-update marker', err);
  }
}

/** After silent install + relaunch, surface a one-shot “updated” notice. */
function consumePendingUpdate(): PendingUpdateMarker | null {
  const file = userDataFile(PENDING_UPDATE_FILE);
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

/**
 * Detect a version bump via pending install marker or last-seen file.
 * Persists a dismissible notice so login delay / update checks don't wipe it.
 */
function detectVersionBumpNotice(): PendingUpdateMarker | null {
  const current = parseTag(app.getVersion());
  const lastSeenPath = userDataFile(LAST_SEEN_VERSION_FILE);

  let notice = consumePendingUpdate();

  if (!notice) {
    try {
      if (fs.existsSync(lastSeenPath)) {
        const previous = parseTag(fs.readFileSync(lastSeenPath, 'utf8'));
        if (previous && previous !== current) {
          notice = { from: previous, to: current };
        }
      }
    } catch (err) {
      log.warn('Could not read last-seen version', err);
    }
  }

  if (notice) {
    writeJustUpdatedNoticeFile(notice);
  } else {
    notice = readJustUpdatedNoticeFile();
  }

  try {
    fs.writeFileSync(lastSeenPath, current, 'utf8');
  } catch (err) {
    log.warn('Could not write last-seen version', err);
  }

  return notice;
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
  // Unsigned mac updates via electron-updater are unreliable; use direct .dmg download.
  if (process.platform === 'darwin') return false;
  return app.isPackaged;
}

function preferredInstallerName(): string {
  if (process.platform === 'win32') {
    return isPortableBuild()
      ? 'Chess-Alokas-Portable-win-x64.exe'
      : 'Chess-Alokas-Setup-win-x64.exe';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64'
      ? 'Chess-Alokas-mac-arm64.dmg'
      : 'Chess-Alokas-mac-x64.dmg';
  }
  return 'Chess-Alokas-linux-x86_64.AppImage';
}

function pickInstallerAsset(assets: GithubReleaseAsset[] | undefined): GithubReleaseAsset | null {
  if (!assets?.length) return null;
  const preferred = preferredInstallerName();
  const exact = assets.find((a) => a.name === preferred);
  if (exact) return exact;
  // Fallbacks if naming drifts slightly
  if (process.platform === 'win32') {
    return (
      assets.find((a) => /Setup.*\.exe$/i.test(a.name)) ??
      assets.find((a) => /Portable.*\.exe$/i.test(a.name)) ??
      null
    );
  }
  if (process.platform === 'darwin') {
    const archHint = process.arch === 'arm64' ? 'arm64' : 'x64';
    return (
      assets.find((a) => a.name.toLowerCase().includes(archHint) && a.name.endsWith('.dmg')) ??
      assets.find((a) => a.name.endsWith('.dmg')) ??
      null
    );
  }
  return assets.find((a) => a.name.endsWith('.AppImage')) ?? null;
}

function send(
  getWindow: () => BrowserWindow | null,
  payload: Omit<UpdateStatusPayload, 'currentVersion' | 'canInstall'> &
    Partial<Pick<UpdateStatusPayload, 'canInstall' | 'previousVersion'>>,
  updater: AppUpdater | null,
) {
  lastStatus = {
    ...payload,
    currentVersion: app.getVersion(),
    canInstall: payload.canInstall ?? canAutoInstall(updater),
    installerUrl: payload.installerUrl ?? pendingInstallerUrl ?? undefined,
    localInstallerPath: payload.localInstallerPath ?? pendingLocalInstaller ?? undefined,
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

async function fetchLatestRelease(): Promise<GithubRelease | null> {
  const res = await fetch(RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Chess-Alokas-Desktop',
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as GithubRelease;
}

/** Fallback when electron-updater feed is missing or unsupported: compare tags + pick installer. */
async function checkViaGithubApi(
  getWindow: () => BrowserWindow | null,
  updater: AppUpdater | null,
): Promise<boolean> {
  try {
    const body = await fetchLatestRelease();
    if (!body) return false;
    const remote = body.tag_name ? parseTag(body.tag_name) : '';
    if (!remote || !isNewer(remote, app.getVersion())) {
      send(
        getWindow,
        { status: 'not-available', message: 'You’re on the latest version.' },
        updater,
      );
      return true;
    }
    const asset = pickInstallerAsset(body.assets);
    pendingInstallerUrl = asset?.browser_download_url ?? null;
    pendingLocalInstaller = null;
    if (!pendingInstallerUrl) {
      send(
        getWindow,
        {
          status: 'error',
          version: remote,
          message: `v${remote} is available, but no installer was found for this platform.`,
          canInstall: false,
        },
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
        installerUrl: pendingInstallerUrl,
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

async function downloadInstallerFile(
  getWindow: () => BrowserWindow | null,
  updater: AppUpdater | null,
  url: string,
  version: string | undefined,
): Promise<void> {
  if (downloadInFlight) return;
  downloadInFlight = true;
  try {
    send(
      getWindow,
      {
        status: 'downloading',
        version,
        percent: 0,
        message: `Downloading v${version ?? 'update'}…`,
        installerUrl: url,
        canInstall: false,
      },
      updater,
    );

    const res = await fetch(url, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'Chess-Alokas-Desktop',
      },
      redirect: 'follow',
    });
    if (!res.ok || !res.body) {
      throw new Error(`Download failed (${res.status})`);
    }

    const total = Number(res.headers.get('content-length') || 0);
    const fileName =
      preferredInstallerName().replace(/(\.\w+)$/, (_m, ext: string) =>
        version ? `-${version}${ext}` : ext,
      ) || path.basename(new URL(url).pathname);
    const dest = path.join(app.getPath('downloads'), fileName);
    const tmp = `${dest}.part`;

    let received = 0;
    let lastPct = -1;
    const nodeReadable = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
    const fileStream = fs.createWriteStream(tmp);

    nodeReadable.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (total > 0) {
        const pct = Math.min(99, Math.round((received / total) * 100));
        if (pct !== lastPct) {
          lastPct = pct;
          send(
            getWindow,
            {
              status: 'downloading',
              version,
              percent: pct,
              message: `Downloading update… ${pct}%`,
              installerUrl: url,
              canInstall: false,
            },
            updater,
          );
        }
      }
    });

    await pipeline(nodeReadable, fileStream);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(tmp, dest);

    pendingLocalInstaller = dest;
    if (version) writePendingUpdate(version);
    send(
      getWindow,
      {
        status: 'downloaded',
        version,
        percent: 100,
        message: `v${version ?? 'Update'} downloaded — click Install to open the installer.`,
        installerUrl: url,
        localInstallerPath: dest,
        canInstall: false,
      },
      updater,
    );
  } catch (err) {
    log.error('Installer download failed', err);
    send(
      getWindow,
      {
        status: 'error',
        version,
        message: err instanceof Error ? err.message : 'Download failed',
        installerUrl: url,
        canInstall: false,
      },
      updater,
    );
  } finally {
    downloadInFlight = false;
  }
}

async function ensureInstallerUrl(): Promise<string | null> {
  if (pendingInstallerUrl) return pendingInstallerUrl;
  if (lastStatus.installerUrl) {
    pendingInstallerUrl = lastStatus.installerUrl;
    return pendingInstallerUrl;
  }
  const body = await fetchLatestRelease();
  const asset = pickInstallerAsset(body?.assets);
  pendingInstallerUrl = asset?.browser_download_url ?? null;
  return pendingInstallerUrl;
}

async function openLocalInstaller(localPath: string): Promise<void> {
  const err = await shell.openPath(localPath);
  if (err) {
    throw new Error(err);
  }
  // Give the OS a moment to launch the installer, then quit so files aren't locked.
  setTimeout(() => {
    app.quit();
  }, 1200);
}

export function setupAutoUpdater(getWindow: () => BrowserWindow | null) {
  const autoUpdater = loadAutoUpdater();
  activeJustUpdated = detectVersionBumpNotice();
  if (activeJustUpdated) {
    log.info('App relaunched after update', activeJustUpdated);
    lastStatus = justUpdatedPayload(activeJustUpdated);
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
              canInstall: false,
            },
            autoUpdater,
          );
        }
      });
    });
  }

  async function download() {
    if (canAutoInstall(autoUpdater)) {
      try {
        await autoUpdater!.downloadUpdate();
      } catch (err) {
        log.error('downloadUpdate failed', err);
        const url = await ensureInstallerUrl();
        if (url) {
          await downloadInstallerFile(getWindow, autoUpdater, url, lastStatus.version);
          return;
        }
        send(
          getWindow,
          {
            status: 'error',
            message: err instanceof Error ? err.message : 'Download failed',
            canInstall: false,
          },
          autoUpdater,
        );
      }
      return;
    }

    const url = await ensureInstallerUrl();
    if (!url) {
      send(
        getWindow,
        {
          status: 'error',
          message: 'No installer available for this platform.',
          canInstall: false,
        },
        autoUpdater,
      );
      return;
    }
    await downloadInstallerFile(getWindow, autoUpdater, url, lastStatus.version);
  }

  async function install() {
    if (canAutoInstall(autoUpdater) && lastStatus.status === 'downloaded' && !pendingLocalInstaller) {
      if (lastStatus.version) writePendingUpdate(lastStatus.version);
      // Silent NSIS (/S) — no Next/Next wizard; relaunch after install.
      autoUpdater!.quitAndInstall(true, true);
      return;
    }

    const local = pendingLocalInstaller || lastStatus.localInstallerPath;
    if (local && fs.existsSync(local)) {
      try {
        if (lastStatus.version) writePendingUpdate(lastStatus.version);
        await openLocalInstaller(local);
      } catch (err) {
        send(
          getWindow,
          {
            status: 'error',
            version: lastStatus.version,
            message: err instanceof Error ? err.message : 'Could not open installer',
            localInstallerPath: local,
            canInstall: false,
          },
          autoUpdater,
        );
      }
      return;
    }

    // Nothing ready yet — download first (never open a browser).
    await download();
  }

  return {
    /** Push the post-install notice once the window can receive IPC. */
    announceJustUpdated() {
      if (!activeJustUpdated) return;
      send(
        getWindow,
        {
          status: 'just-updated',
          previousVersion: activeJustUpdated.from,
          version: activeJustUpdated.to,
          message: `Updated to v${activeJustUpdated.to}.`,
          canInstall: false,
        },
        autoUpdater,
      );
    },

    async check() {
      // Keep activeJustUpdated until the user dismisses — do not clear here.
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
        log.warn('electron-updater check failed, using direct installer download', err);
        const ok = await checkViaGithubApi(getWindow, autoUpdater);
        if (!ok) {
          send(
            getWindow,
            {
              status: 'error',
              message: err instanceof Error ? err.message : 'Update check failed',
              canInstall: false,
            },
            autoUpdater,
          );
        }
      }
    },

    download,
    install,

    /** Kept for IPC compat; always downloads in-app — never opens GitHub. */
    openDownloadPage(_url?: string) {
      return download();
    },
  };
}
