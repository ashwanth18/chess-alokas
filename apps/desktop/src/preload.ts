import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export type DesktopUpdateStatus = {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
  downloadPageUrl?: string;
  canInstall: boolean;
};

export interface DesktopBridge {
  isDesktop: true;
  apiBaseUrl: string;
  getApiBaseUrl: () => string;
  getAppVersion: () => string;
  getUserDataPath: () => string;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  openDownloadPage: (url?: string) => Promise<void>;
  getUpdateStatus: () => Promise<DesktopUpdateStatus>;
  onUpdateStatus: (listener: (status: DesktopUpdateStatus) => void) => () => void;
}

const apiBaseUrl = ipcRenderer.sendSync('desktop:get-api-base-url') as string;
const appVersion = ipcRenderer.sendSync('desktop:get-app-version') as string;
const userDataPath = ipcRenderer.sendSync('desktop:get-user-data-path') as string;

const bridge: DesktopBridge = {
  isDesktop: true,
  apiBaseUrl,
  getApiBaseUrl: () => apiBaseUrl,
  getAppVersion: () => appVersion,
  getUserDataPath: () => userDataPath,
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates') as Promise<void>,
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update') as Promise<void>,
  installUpdate: () => ipcRenderer.invoke('desktop:install-update') as Promise<void>,
  openDownloadPage: (url?: string) =>
    ipcRenderer.invoke('desktop:open-download-page', url) as Promise<void>,
  getUpdateStatus: () =>
    ipcRenderer.invoke('desktop:get-update-status') as Promise<DesktopUpdateStatus>,
  onUpdateStatus: (listener) => {
    const handler = (_event: IpcRendererEvent, status: DesktopUpdateStatus) => listener(status);
    ipcRenderer.on('desktop:update-status', handler);
    void ipcRenderer.invoke('desktop:get-update-status').then((status: DesktopUpdateStatus) => {
      if (status?.status && status.status !== 'idle') listener(status);
    });
    return () => {
      ipcRenderer.removeListener('desktop:update-status', handler);
    };
  },
};

contextBridge.exposeInMainWorld('desktop', bridge);
