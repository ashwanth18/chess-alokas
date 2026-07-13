import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopBridge {
  isDesktop: true;
  apiBaseUrl: string;
  getApiBaseUrl: () => string;
  getAppVersion: () => string;
  getUserDataPath: () => string;
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
};

contextBridge.exposeInMainWorld('desktop', bridge);
