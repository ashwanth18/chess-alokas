import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';

const SITE_URL = 'https://chess-manager.alokas.com';
const RELEASES_URL = 'https://github.com/ashwanth18/chess-alokas/releases/latest';

type MenuActions = {
  checkForUpdates: () => void;
};

/**
 * Notion-style chrome:
 * - Windows/Linux: no in-window menu bar (custom titlebar only)
 * - macOS: standard app menu lives in the system menu bar (not inside the window)
 */
export function installAppMenu(actions: MenuActions) {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  const isDev = !app.isPackaged;

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for updates…',
          click: () => actions.checkForUpdates(),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open website',
          click: () => {
            void shell.openExternal(SITE_URL);
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDev ? ([{ role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for updates…',
          click: () => actions.checkForUpdates(),
        },
        {
          label: 'Download page',
          click: () => {
            void shell.openExternal(RELEASES_URL);
          },
        },
        { type: 'separator' },
        {
          label: 'Open Chess Alokas website',
          click: () => {
            void shell.openExternal(SITE_URL);
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
