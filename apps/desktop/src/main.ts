import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import log from 'electron-log/main';
import { startApiSidecar, type SidecarHandle } from './sidecar.js';
import {
  getLastUpdateStatus,
  setLiveTournamentCount,
  setupAutoUpdater,
  dismissJustUpdatedNotice,
} from './updater.js';
import { installAppMenu } from './menu.js';
import { clearLastError, openLogsFolder, readLastError, writeLastError } from './errors.js';
import { pairDutchFromMain } from './pairDutch.js';
import {
  buildCsp,
  createCrashGuard,
  indexFileUrl,
  isAppPageUrl,
  isInsideWebRoot,
  isSafeExternalUrl,
  validateBootIssue,
} from './policy.js';
import { readBuildConfig } from './buildConfig.js';
import { reportMainError } from './mainSentry.js';
import {
  backupsDir,
  exportToFile,
  importFromFile,
  listSnapshots,
  openBackupsFolder,
  purgeTournamentsFromSnapshots,
  readSnapshot,
  saveSnapshot,
} from './backups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.setName('Chess Alokas');
// Must match electron-builder appId so Task Manager / jump lists don't show "Electron".
app.setAppUserModelId('com.chessalokas.desktop');
app.setPath('userData', path.join(app.getPath('appData'), 'Chess Alokas'));

// Initialized before the single-instance-lock check below so a launch that
// silently quits because a zombie/hung prior instance still holds the lock
// (indistinguishable to the user from "the app won't open") at least leaves
// a trace — previously nothing was logged for that path at all.
log.initialize();

// Remote Desktop's virtual GPU driver is a well-documented source of Electron
// windows that open but never paint anything (black screen) — disable
// hardware acceleration proactively there instead of waiting for a crash.
const isRemoteSession = /^RDP-Tcp#/i.test(process.env['SESSIONNAME'] ?? '');

const GPU_FLAG = path.join(app.getPath('userData'), 'disable-gpu');
const gpuDisabled = isRemoteSession || fs.existsSync(GPU_FLAG);
if (gpuDisabled) {
  app.disableHardwareAcceleration();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.warn('Single-instance lock held by another process — quitting this launch', {
    version: app.getVersion(),
  });
  app.quit();
}

log.info('Chess Alokas desktop starting', {
  packaged: app.isPackaged,
  version: app.getVersion(),
  gpuDisabled,
  remoteSession: isRemoteSession,
});

const PRODUCTION_API_URL = 'https://chess-manager.alokas.com/api';
// Environment overrides exist for development only; a packaged install always
// talks to production so another process cannot redirect its auth tokens.
const CLOUD_API_URL = app.isPackaged
  ? PRODUCTION_API_URL
  : (process.env['CHESS_ALOKAS_API_URL'] ?? PRODUCTION_API_URL);

const APP_PARTITION = 'persist:chess-alokas';
/** Never loaded: the error page navigates here and will-navigate turns it into a reload. */
const RETRY_URL = 'https://chess-alokas.invalid/retry';

let mainWindow: BrowserWindow | null = null;
let sidecar: SidecarHandle | null = null;
let apiBaseUrl = CLOUD_API_URL;

const isDev = !app.isPackaged && process.env['ELECTRON_DEV'] !== '0';
/** Local API sidecar is development-only; packaged builds have no secrets and use the cloud. */
const useLocalSidecar = !app.isPackaged && (isDev || process.env['DESKTOP_LOCAL_API'] === '1');

function webRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '../../web/dist');
}

function indexHtmlPath(): string {
  return path.join(webRoot(), 'index.html');
}

const crashGuard = createCrashGuard(3, 5 * 60_000);

// Only initialize the auto-updater when this process actually holds the
// single-instance lock; otherwise a duplicate launch would consume and delete
// pending-update.json / last-seen-version.txt before quitting.
const updater = gotLock
  ? setupAutoUpdater(() => mainWindow)
  : {
      check: async () => {},
      download: async () => {},
      install: async () => {},
      openDownloadPage: async () => {},
      announceJustUpdated: () => {},
    };

function loadFailHtml(message: string): string {
  const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Chess Alokas</title>
<style>
  html,body{margin:0;background:#071f17;color:#d4b98a;font-family:Georgia,serif;
    min-height:100vh;display:grid;place-items:center;text-align:center;padding:2rem}
  p{opacity:.85}
  button{margin-top:1rem;padding:.5rem 1rem;background:#d4b98a;color:#071f17;border:0;border-radius:6px;cursor:pointer}
</style></head>
<body>
  <div>
    <h1>Chess Alokas could not start</h1>
    <p>${safe}</p>
    <p>Your tournament data is stored on this computer. If this keeps happening, close the app and open it again. You can keep working on chess-manager.alokas.com.</p>
    <button onclick="location.href='${RETRY_URL}'">Try again</button>
  </div>
</body></html>`;
}

function showFailPage(message: string) {
  void mainWindow?.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(loadFailHtml(message))}`,
  );
}

function loadFailMessage(errorCode: number, errorDescription: string): string {
  if (errorCode === -106) return 'No internet connection.';
  if (errorCode === -105 || errorCode === -109) return 'Could not look up the server name.';
  if (errorCode === -118) return 'Connection timed out.';
  if (errorCode === -6 || errorCode === -2) return 'The app page could not be loaded.';
  return errorDescription || `Page load failed (${errorCode}).`;
}

/** Bridge calls are honoured only from the app's own top-level page. */
function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || !mainWindow || event.sender !== mainWindow.webContents || frame.parent) return false;
  if (isDev) return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(frame.url);
  return isAppPageUrl(frame.url, indexFileUrl(indexHtmlPath()));
}

function onSync(channel: string, fn: (...args: unknown[]) => unknown) {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      log.warn('Rejected IPC from untrusted sender', channel);
      // sendSync callers block until returnValue is set.
      event.returnValue = null;
      return;
    }
    event.returnValue = fn(...args) ?? null;
  });
}

function handle(channel: string, fn: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      log.warn('Rejected IPC from untrusted sender', channel);
      throw new Error('Forbidden');
    }
    return fn(...args);
  });
}

function registerIpc() {
  onSync('desktop:get-api-base-url', () => apiBaseUrl);
  onSync('desktop:get-app-version', () => app.getVersion());
  onSync('desktop:get-user-data-path', () => app.getPath('userData'));

  handle('desktop:check-for-updates', () => updater.check());
  handle('desktop:download-update', () => updater.download());
  handle('desktop:install-update', () => updater.install());
  handle('desktop:open-download-page', () => updater.openDownloadPage());
  handle('desktop:get-update-status', () => getLastUpdateStatus());
  handle('desktop:dismiss-just-updated', () => dismissJustUpdatedNotice());
  onSync('desktop:get-last-error', () => readLastError());
  onSync('desktop:clear-last-error', () => clearLastError());
  onSync('desktop:report-boot-issue', (issue) => {
    const clean = validateBootIssue(issue);
    if (clean) writeLastError(clean);
  });
  handle('desktop:open-logs-folder', () => openLogsFolder());
  handle('desktop:pair-dutch', (input) => pairDutchFromMain(input));

  onSync('desktop:set-live-tournament-count', (count) => setLiveTournamentCount(count));
  handle('desktop:backup-save', (json, reason) => saveSnapshot(json, reason));
  handle('desktop:backup-list', () => listSnapshots());
  handle('desktop:backup-read', (name) => readSnapshot(name));
  handle('desktop:backup-export', (json) => exportToFile(mainWindow, json));
  handle('desktop:backup-import', () => importFromFile(mainWindow));
  handle('desktop:backup-open-folder', () => openBackupsFolder());
  handle('desktop:backup-purge-tournaments', (ids) => purgeTournamentsFromSnapshots(ids));
  onSync('desktop:backup-folder', () => backupsDir());
}

/**
 * Packaged page policy. file:// responses have no HTTP headers, so the app's
 * session serves them through this handler, which adds the CSP and refuses
 * anything outside the web root. The origin stays file://, so existing
 * IndexedDB and localStorage data keep opening.
 */
function installPagePolicy() {
  const ses = session.fromPartition(APP_PARTITION);
  const { supabaseUrl, sentryDsn } = readBuildConfig();
  const csp = buildCsp({
    html: fs.readFileSync(indexHtmlPath(), 'utf8'),
    apiBaseUrl,
    supabaseUrl,
    sentryDsn,
  });
  const rootUrl = pathToFileURL(webRoot()).href;
  ses.protocol.handle('file', async (request) => {
    if (!isInsideWebRoot(request.url, rootUrl)) {
      log.warn('Blocked file request outside the app');
      return new Response('Not found', { status: 404 });
    }
    const res = await net.fetch(request.url, { bypassCustomProtocolHandlers: true });
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', csp);
    return new Response(res.body, { status: res.status, headers });
  });

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(
      permission === 'geolocation' ||
        permission === 'clipboard-sanitized-write' ||
        permission === 'clipboard-read' ||
        permission === 'fullscreen',
    );
  });
}

async function loadApp() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isDev) {
    const viteUrl = process.env['VITE_DEV_SERVER_URL'] ?? 'http://localhost:5173';
    await mainWindow.loadURL(viteUrl);
    return;
  }
  // loadFile — never chess-alokas:// or app://. Windows 11 treats unknown
  // custom schemes as Store “get an app to open this link” prompts.
  await mainWindow.loadFile(indexHtmlPath());
}

function reloadAfterFailure() {
  loadApp().catch((err: unknown) => {
    log.error('Reload failed', err);
  });
}

async function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: `Chess Alokas ${app.getVersion()}`,
    show: true,
    // Notion-style: content under a hidden titlebar; native controls overlay the UI.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 18 } }
      : {
          titleBarOverlay: {
            color: '#071f17',
            symbolColor: '#d4b98a',
            height: 36,
          },
        }),
    backgroundColor: '#071f17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: APP_PARTITION,
    },
  });

  const showWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    updater.announceJustUpdated();
    setTimeout(() => {
      void updater.check();
    }, 2500);
  };

  mainWindow.once('ready-to-show', () => {
    showWindow();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === RETRY_URL) {
      event.preventDefault();
      crashGuard.reset();
      clearLastError();
      reloadAfterFailure();
      return;
    }
    if (isDev && /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(url)) return;
    if (!isDev && isAppPageUrl(url, indexFileUrl(indexHtmlPath()))) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (errorCode === -3) return; // ERR_ABORTED (normal on navigation)
      if (!isMainFrame) return;
      if (validatedURL.startsWith('data:')) return;
      const message = loadFailMessage(errorCode, errorDescription);
      writeLastError({
        code: 'PAGE_LOAD_FAILED',
        message,
        details: `${errorCode} ${errorDescription} ${validatedURL}`,
      });
      showFailPage(message);
    },
  );
  mainWindow.webContents.on('unresponsive', () => {
    writeLastError({
      code: 'WINDOW_UNRESPONSIVE',
      message: 'The window stopped responding.',
    });
    reportMainError('WINDOW_UNRESPONSIVE', 'The window stopped responding.');
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const message = `Display process ended (${details.reason}).`;
    writeLastError({
      code: 'RENDERER_CRASH',
      message,
      details: JSON.stringify(details),
    });
    reportMainError('RENDERER_CRASH', `${message} exitCode=${details.exitCode}`);
    if (details.reason === 'clean-exit' || !mainWindow || mainWindow.isDestroyed()) return;
    if (crashGuard.allow()) {
      log.warn('Reloading after renderer crash');
      setTimeout(reloadAfterFailure, 500);
    } else {
      // Repeated crashes: stop the loop and let the person decide.
      log.error('Renderer keeps crashing; showing the error page');
      showFailPage('The display process keeps stopping.');
    }
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  await loadApp();
}

async function boot() {
  // Black-screen reports (window opens, nothing ever paints) are otherwise
  // undiagnosable from here — the compositor failing is invisible to every
  // other lifecycle event this file listens for. Log actual GPU feature
  // status so the next report comes with real data instead of a guess.
  try {
    log.info('GPU feature status', app.getGPUFeatureStatus());
  } catch (err) {
    log.warn('Could not read GPU feature status', err);
  }

  registerIpc();
  installAppMenu({
    checkForUpdates: () => {
      void updater.check();
    },
  });

  if (useLocalSidecar) {
    try {
      sidecar = await startApiSidecar();
      apiBaseUrl = sidecar.baseUrl;
      log.info('API sidecar ready at', apiBaseUrl);
    } catch (err) {
      log.error('Failed to start API sidecar', err);
      apiBaseUrl = CLOUD_API_URL;
      log.info('Falling back to cloud API', apiBaseUrl);
    }
  } else {
    apiBaseUrl = CLOUD_API_URL;
    log.info('Using cloud API', apiBaseUrl);
  }

  if (!isDev) installPagePolicy();

  await createWindow();
}

app.whenReady().then(() => {
  if (!gotLock) return;
  boot().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    writeLastError({ code: 'BOOT_FAILED', message: e.message, details: e.stack });
    reportMainError('BOOT_FAILED', e.message, e.stack);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU') return;
  try {
    fs.writeFileSync(GPU_FLAG, new Date().toISOString(), 'utf8');
    log.error('GPU process gone — next launch will disable hardware acceleration', details);
    reportMainError('GPU_PROCESS_GONE', `GPU process ended (${details.reason}).`);
  } catch {
    /* ignore */
  }
});

app.on('before-quit', () => {
  void sidecar?.stop();
});

process.on('uncaughtException', (err) => {
  writeLastError({
    code: 'MAIN_UNCAUGHT',
    message: err.message,
    details: err.stack,
  });
  reportMainError('MAIN_UNCAUGHT', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  writeLastError({
    code: 'MAIN_UNHANDLED_REJECTION',
    message: err.message,
    details: err.stack,
  });
  reportMainError('MAIN_UNHANDLED_REJECTION', err.message, err.stack);
});
