import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import log from 'electron-log/main';
import { startApiSidecar, type SidecarHandle } from './sidecar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Friendly userData folder (avoid scoped package path like @chess-alokas/desktop)
app.setName('Chess Alokas');
app.setPath('userData', path.join(app.getPath('appData'), 'Chess Alokas'));

log.initialize();
log.info('Chess Alokas desktop starting', { packaged: app.isPackaged });

let mainWindow: BrowserWindow | null = null;
let sidecar: SidecarHandle | null = null;
let apiBaseUrl = 'http://127.0.0.1:3001';

const isDev = !app.isPackaged && process.env['ELECTRON_DEV'] !== '0';

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
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Chess Alokas',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

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

  try {
    sidecar = await startApiSidecar();
    apiBaseUrl = sidecar.baseUrl;
    log.info('API sidecar ready at', apiBaseUrl);
  } catch (err) {
    log.error('Failed to start API sidecar', err);
    // Still open UI — Dexie offline mode works; sync/certs need API
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
