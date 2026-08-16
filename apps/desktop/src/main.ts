import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import log from 'electron-log/main';
import { startApiSidecar, type SidecarHandle } from './sidecar.js';
import { getLastUpdateStatus, setupAutoUpdater, dismissJustUpdatedNotice } from './updater.js';
import { installAppMenu } from './menu.js';
import { openLogsFolder, readLastError, writeLastError } from './errors.js';
import { APP_INDEX_URL, APP_SCHEME, registerAppProtocol } from './appProtocol.js';
import { pairDutchFromMain, type DesktopDutchInput } from './pairDutch.js';

function isSafeExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('mailto:');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.setName('Chess Alokas');
// Must match electron-builder appId so Task Manager / jump lists don't show "Electron".
app.setAppUserModelId('com.chessalokas.desktop');
app.setPath('userData', path.join(app.getPath('appData'), 'Chess Alokas'));

const GPU_FLAG = path.join(app.getPath('userData'), 'disable-gpu');
if (fs.existsSync(GPU_FLAG)) {
  app.disableHardwareAcceleration();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

log.initialize();
log.info('Chess Alokas desktop starting', {
  packaged: app.isPackaged,
  version: app.getVersion(),
  gpuDisabled: fs.existsSync(GPU_FLAG),
});

const CLOUD_API_URL =
  process.env['CHESS_ALOKAS_API_URL'] ?? 'https://chess-manager.alokas.com/api';

let mainWindow: BrowserWindow | null = null;
let sidecar: SidecarHandle | null = null;
let apiBaseUrl = CLOUD_API_URL;

const isDev = !app.isPackaged && process.env['ELECTRON_DEV'] !== '0';
/** Packaged builds use the cloud API by default (no secrets on the device). */
const useLocalSidecar = isDev || process.env['DESKTOP_LOCAL_API'] === '1';

const updater = setupAutoUpdater(() => mainWindow);

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
    <p>Quit the app from Task Manager, then open it again. You can keep working on chess-manager.alokas.com.</p>
    <button onclick="location.reload()">Try again</button>
  </div>
</body></html>`;
}

function loadFailMessage(errorCode: number, errorDescription: string): string {
  if (errorCode === -106) return 'No internet connection.';
  if (errorCode === -105 || errorCode === -109) return 'Could not look up the server name.';
  if (errorCode === -118) return 'Connection timed out.';
  if (errorCode === -6 || errorCode === -2) return 'The app page could not be loaded.';
  return errorDescription || `Page load failed (${errorCode}).`;
}

function registerIpc() {
  ipcMain.on('desktop:get-api-base-url', (event) => {
    event.returnValue = apiBaseUrl;
  });
  ipcMain.on('desktop:get-app-version', (event) => {
    event.returnValue = app.getVersion();
  });
  ipcMain.on('desktop:get-user-data-path', (event) => {
    event.returnValue = app.getPath('userData');
  });

  ipcMain.handle('desktop:check-for-updates', async () => {
    await updater.check();
  });
  ipcMain.handle('desktop:download-update', async () => {
    await updater.download();
  });
  ipcMain.handle('desktop:install-update', async () => {
    await updater.install();
  });
  ipcMain.handle('desktop:open-download-page', async (_event, url?: string) => {
    await updater.openDownloadPage(typeof url === 'string' ? url : undefined);
  });
  ipcMain.handle('desktop:get-update-status', () => getLastUpdateStatus());
  ipcMain.handle('desktop:dismiss-just-updated', () => dismissJustUpdatedNotice());
  ipcMain.on('desktop:get-last-error', (event) => {
    event.returnValue = readLastError();
  });
  ipcMain.on('desktop:report-boot-issue', (_event, issue) => {
    if (!issue || typeof issue !== 'object') return;
    const rec = issue as { code?: string; message?: string; details?: string; at?: string };
    if (!rec.code || !rec.message) return;
    writeLastError({
      code: String(rec.code),
      message: String(rec.message),
      details: rec.details ? String(rec.details) : undefined,
      at: rec.at ? String(rec.at) : undefined,
    });
  });
  ipcMain.handle('desktop:open-logs-folder', async () => {
    await openLogsFolder();
  });
  ipcMain.handle('desktop:pair-dutch', async (_event, input: DesktopDutchInput) => {
    return pairDutchFromMain(input);
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: 'persist:chess-alokas',
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
    if (
      url.startsWith(`${APP_SCHEME}:`) ||
      url.startsWith('file:') ||
      url.startsWith('data:') ||
      (isDev && /^https?:\/\/localhost(?::\d+)?\//i.test(url))
    ) {
      return;
    }
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
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
      void mainWindow?.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(loadFailHtml(message))}`,
      );
    },
  );
  mainWindow.webContents.on('unresponsive', () => {
    writeLastError({
      code: 'WINDOW_UNRESPONSIVE',
      message: 'The window stopped responding.',
    });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeLastError({
      code: 'RENDERER_CRASH',
      message: `Display process ended (${details.reason}).`,
      details: JSON.stringify(details),
    });
  });

  if (isDev) {
    const viteUrl = process.env['VITE_DEV_SERVER_URL'] ?? 'http://localhost:5173';
    await mainWindow.loadURL(viteUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    registerAppProtocol();
    try {
      await mainWindow.loadURL(APP_INDEX_URL);
    } catch (err) {
      log.error('chess-alokas:// load failed, falling back to loadFile', err);
      const indexHtml = app.isPackaged
        ? path.join(process.resourcesPath, 'web', 'index.html')
        : path.join(__dirname, '../../web/dist/index.html');
      await mainWindow.loadFile(indexHtml);
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function boot() {
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

  await createWindow();
}

app.whenReady().then(() => {
  if (!gotLock) return;
  void boot();

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
});
