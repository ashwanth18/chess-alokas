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
