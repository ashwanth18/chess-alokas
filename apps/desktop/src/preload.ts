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
  clearLastError: () => void;
  reportBootIssue: (issue: {
    code: string;
    message: string;
    at?: string;
    details?: string;
  }) => void;
  openLogsFolder: () => Promise<void>;
  onUpdateStatus: (listener: (status: DesktopUpdateStatus) => void) => () => void;
  pairDutch: (input: unknown) => Promise<{
    boards: Array<{ board: number; whiteId: string | null; blackId: string | null; isBye: boolean }>;
    byePlayerId: string | null;
  }>;
  /** Tells the updater how many tournaments are running, so it can warn before updating. */
  setLiveTournamentCount: (count: number) => void;
  backupSave: (json: string, reason: string) => Promise<{ name: string }>;
  backupList: () => Promise<Array<{ name: string; size: number; savedAt: string }>>;
  backupRead: (name: string) => Promise<string>;
  backupExport: (json: string) => Promise<string | null>;
  backupImport: () => Promise<string | null>;
  backupOpenFolder: () => Promise<void>;
  backupFolder: () => string;
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
  clearLastError: () => {
    ipcRenderer.send('desktop:clear-last-error');
  },
  reportBootIssue: (issue) => {
    ipcRenderer.send('desktop:report-boot-issue', issue);
  },
  openLogsFolder: () => ipcRenderer.invoke('desktop:open-logs-folder') as Promise<void>,
  pairDutch: (input) => ipcRenderer.invoke('desktop:pair-dutch', input),
  setLiveTournamentCount: (count) => {
    ipcRenderer.send('desktop:set-live-tournament-count', count);
  },
  backupSave: (json, reason) => ipcRenderer.invoke('desktop:backup-save', json, reason),
  backupList: () => ipcRenderer.invoke('desktop:backup-list'),
  backupRead: (name) => ipcRenderer.invoke('desktop:backup-read', name),
  backupExport: (json) => ipcRenderer.invoke('desktop:backup-export', json),
  backupImport: () => ipcRenderer.invoke('desktop:backup-import'),
  backupOpenFolder: () => ipcRenderer.invoke('desktop:backup-open-folder'),
  backupFolder: () => ipcRenderer.sendSync('desktop:backup-folder') as string,
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
