import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export type DesktopUpdateStatus = {
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
  installerUrl?: string;
  localInstallerPath?: string;
  canInstall: boolean;
};

export interface DesktopBridge {
  isDesktop: true;
  /** Node process.platform: win32 | darwin | linux */
  platform: string;
  apiBaseUrl: string;
  getApiBaseUrl: () => string;
  getAppVersion: () => string;
  getUserDataPath: () => string;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  openDownloadPage: (url?: string) => Promise<void>;
  getUpdateStatus: () => Promise<DesktopUpdateStatus>;
  dismissJustUpdated: () => Promise<DesktopUpdateStatus>;
  getLastError: () => {
    code: string;
    message: string;
    at: string;
    details?: string;
  } | null;
  reportBootIssue: (issue: {
    code: string;
    message: string;
    at?: string;
    details?: string;
  }) => void;
  openLogsFolder: () => Promise<void>;
  onUpdateStatus: (listener: (status: DesktopUpdateStatus) => void) => () => void;
}

const apiBaseUrl = ipcRenderer.sendSync('desktop:get-api-base-url') as string;
const appVersion = ipcRenderer.sendSync('desktop:get-app-version') as string;
const userDataPath = ipcRenderer.sendSync('desktop:get-user-data-path') as string;

const bridge: DesktopBridge = {
  isDesktop: true,
  platform: process.platform,
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
  dismissJustUpdated: () =>
    ipcRenderer.invoke('desktop:dismiss-just-updated') as Promise<DesktopUpdateStatus>,
  getLastError: () =>
    (ipcRenderer.sendSync('desktop:get-last-error') as ReturnType<DesktopBridge['getLastError']>) ??
    null,
  reportBootIssue: (issue) => {
    ipcRenderer.send('desktop:report-boot-issue', issue);
  },
  openLogsFolder: () => ipcRenderer.invoke('desktop:open-logs-folder') as Promise<void>,
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
