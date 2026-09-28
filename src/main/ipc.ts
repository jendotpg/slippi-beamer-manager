import { mkdir } from 'fs/promises';
import path from 'path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import Store from 'electron-store';
import { assertBoolean, assertInteger, assertString } from '../common/asserts';
import { githubRepo } from '../common/constants';
import { KeepOldReplays } from '../common/types';
import {
  deleteDownloadedReplays,
  downloadNewest,
  getBeamerFleet,
  initBeamers,
  measureDownloadedReplays,
  refreshAllBeamers,
  refreshBeamerStatusAndIndex,
  resetAllBeamers,
  resetBeamer,
  setBeamerReplaysLocation,
  setBeamerSubscribed,
  setBeamersAutoSubscribe,
  setKeepOldReplays,
} from './beamer';
import quitAfterCrash from './crash';
import { cancelDownloads } from './downloadQueue';

type StoreSchema = {
  beamerReplaysLocation: string; // '' until chosen - see replaysLocation()
  autoSubscribeBeamers: boolean;
  maxGamesFromIndex: number;
  keepOldReplays: boolean;
  keepOldReplaysCount: number;
};

export default function setupIpc(getWindow: () => BrowserWindow | null) {
  const store = new Store<StoreSchema>({
    defaults: {
      beamerReplaysLocation: '',
      autoSubscribeBeamers: true,
      maxGamesFromIndex: 4,
      keepOldReplays: true,
      keepOldReplaysCount: 10,
    },
  });

  // next to the settings file unless a TO picks somewhere else
  const replaysLocation = () =>
    store.get('beamerReplaysLocation') ||
    path.join(app.getPath('userData'), 'beamer_replays');

  const keepOldReplays = (): KeepOldReplays => ({
    on: store.get('keepOldReplays'),
    count: store.get('keepOldReplaysCount'),
  });

  initBeamers({
    send: (channel, ...args) => {
      const window = getWindow();
      if (window && !window.webContents.isDestroyed()) {
        window.webContents.send(channel, ...args);
      }
    },
    location: replaysLocation(),
    autoSubscribe: store.get('autoSubscribeBeamers'),
    keepOld: keepOldReplays(),
  });

  ipcMain.handle('getBeamerFleet', () => getBeamerFleet());
  ipcMain.handle('refreshBeamerStatusAndIndex', (event, beamerId: unknown) =>
    refreshBeamerStatusAndIndex(assertString(beamerId)),
  );
  ipcMain.handle('refreshAllBeamers', () => refreshAllBeamers());
  ipcMain.handle('resetBeamer', (event, beamerId: unknown) =>
    resetBeamer(assertString(beamerId)),
  );
  ipcMain.handle('resetAllBeamers', () => resetAllBeamers());
  ipcMain.handle(
    'setBeamerSubscribed',
    (event, beamerId: unknown, subscribed: unknown) => {
      setBeamerSubscribed(assertString(beamerId), assertBoolean(subscribed));
    },
  );

  ipcMain.handle('downloadNewest', (event, beamerId: unknown) =>
    downloadNewest(assertString(beamerId), store.get('maxGamesFromIndex')),
  );
  ipcMain.handle('cancelDownloads', () => {
    cancelDownloads();
  });

  ipcMain.handle('getBeamerReplaysLocation', () => replaysLocation());
  ipcMain.handle('chooseBeamerReplaysLocation', async () => {
    const window = getWindow();
    const options: Electron.OpenDialogOptions = {
      defaultPath: replaysLocation(),
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (!result.canceled && result.filePaths.length > 0) {
      store.set('beamerReplaysLocation', result.filePaths[0]);
      setBeamerReplaysLocation(result.filePaths[0]);
    }
    return replaysLocation();
  });
  ipcMain.handle('openInReplayReporter', async () => {
    await mkdir(replaysLocation(), { recursive: true });
    await shell.openExternal(
      `replay-manager://open?${new URLSearchParams({ path: replaysLocation() })}`,
    );
  });

  ipcMain.handle('getMaxGamesFromIndex', () => store.get('maxGamesFromIndex'));
  ipcMain.handle('setMaxGamesFromIndex', (event, maxGames: unknown) => {
    store.set('maxGamesFromIndex', Math.max(assertInteger(maxGames), 1));
    return store.get('maxGamesFromIndex');
  });

  ipcMain.handle('getBeamersAutoSubscribe', () =>
    store.get('autoSubscribeBeamers'),
  );
  ipcMain.handle('setBeamersAutoSubscribe', (event, on: unknown) => {
    store.set('autoSubscribeBeamers', assertBoolean(on));
    setBeamersAutoSubscribe(store.get('autoSubscribeBeamers'));
  });

  ipcMain.handle('getKeepOldReplays', () => keepOldReplays());
  ipcMain.handle('setKeepOldReplays', (event, on: unknown, count: unknown) => {
    store.set('keepOldReplays', assertBoolean(on));
    store.set('keepOldReplaysCount', Math.max(assertInteger(count), 0));
    setKeepOldReplays(keepOldReplays());
    return keepOldReplays();
  });

  ipcMain.handle('getDownloadedReplaysSize', () => measureDownloadedReplays());
  ipcMain.handle('deleteDownloadedReplays', () => deleteDownloadedReplays());

  ipcMain.handle('getVersion', () => app.getVersion());
  ipcMain.handle('getLatestVersion', async () => {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${githubRepo}/releases/latest`,
      );
      const json = await response.json();
      const latestVersion = json.tag_name;
      if (typeof latestVersion !== 'string') {
        return '';
      }
      return latestVersion;
    } catch {
      throw new Error('***You may not be connected to the internet***');
    }
  });
  ipcMain.handle('update', async () => {
    await shell.openExternal(
      `https://github.com/${githubRepo}/releases/latest`,
    );
    app.quit();
  });
  ipcMain.on('rendererError', (event, details: unknown) => {
    quitAfterCrash(String(details));
  });
}
