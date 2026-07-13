export interface DesktopBridge {
  isDesktop: true;
  apiBaseUrl: string;
  getApiBaseUrl: () => string;
  getAppVersion: () => string;
  getUserDataPath: () => string;
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
