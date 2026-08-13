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
  /** Previous version when status is just-updated. */
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

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }

  interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    readonly VITE_DESKTOP?: string;
  }
}

export {};
