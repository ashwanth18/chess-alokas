import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import log from 'electron-log/main';
import { startApiSidecar, type SidecarHandle } from './sidecar.js';
import { getLastUpdateStatus, setupAutoUpdater } from './updater.js';
import { installAppMenu } from './menu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.setName('Chess Alokas');
app.setPath('userData', path.join(app.getPath('appData'), 'Chess Alokas'));

log.initialize();
log.info('Chess Alokas desktop starting', {
  packaged: app.isPackaged,
  version: app.getVersion(),
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
  ipcMain.handle('desktop:install-update', () => {
    updater.install();
  });
  ipcMain.handle('desktop:open-download-page', (_event, url?: string) => {
    updater.openDownloadPage(typeof url === 'string' ? url : undefined);
  });
  ipcMain.handle('desktop:get-update-status', () => getLastUpdateStatus());
}

async function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: `Chess Alokas ${app.getVersion()}`,
    show: false,
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
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // Tell the renderer if this launch followed a silent install.
    updater.announceJustUpdated();
    // Quiet startup check shortly after UI is ready.
    setTimeout(() => {
      void updater.check();
    }, 2500);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    const viteUrl = process.env['VITE_DEV_SERVER_URL'] ?? 'http://localhost:5173';
    await mainWindow.loadURL(viteUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexHtml = app.isPackaged
      ? path.join(process.resourcesPath, 'web', 'index.html')
      : path.join(__dirname, '../../web/dist/index.html');
    await mainWindow.loadFile(indexHtml);
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
  void boot();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void sidecar?.stop();
});
