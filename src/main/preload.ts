import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import {
  BeamerFleet,
  DownloadStatus,
  KeepOldReplays,
  ReplaysSize,
  RequestFailure,
} from '../common/types';

function listen<T>(channel: string, callback: (payload: T) => void) {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const electronHandler = {
  getBeamerFleet: (): Promise<BeamerFleet> =>
    ipcRenderer.invoke('getBeamerFleet'),
  onBeamerFleet: (callback: (fleet: BeamerFleet) => void) =>
    listen('beamerFleet', callback),
  refreshBeamerStatusAndIndex: (beamerId: string): Promise<void> =>
    ipcRenderer.invoke('refreshBeamerStatusAndIndex', beamerId),
  refreshAllBeamers: (): Promise<void> =>
    ipcRenderer.invoke('refreshAllBeamers'),
  resetBeamer: (beamerId: string): Promise<void> =>
    ipcRenderer.invoke('resetBeamer', beamerId),
  resetAllBeamers: (): Promise<RequestFailure[]> =>
    ipcRenderer.invoke('resetAllBeamers'),
  setBeamerSubscribed: (beamerId: string, subscribed: boolean): Promise<void> =>
    ipcRenderer.invoke('setBeamerSubscribed', beamerId, subscribed),
  downloadNewest: (beamerId: string): Promise<void> =>
    ipcRenderer.invoke('downloadNewest', beamerId),
  onDownloadStatus: (callback: (status: DownloadStatus) => void) =>
    listen('downloadStatus', callback),
  cancelDownloads: (): Promise<void> => ipcRenderer.invoke('cancelDownloads'),
  getBeamerReplaysLocation: (): Promise<string> =>
    ipcRenderer.invoke('getBeamerReplaysLocation'),
  chooseBeamerReplaysLocation: (): Promise<string> =>
    ipcRenderer.invoke('chooseBeamerReplaysLocation'),
  openInReplayReporter: (): Promise<void> =>
    ipcRenderer.invoke('openInReplayReporter'),
  getMaxGamesFromIndex: (): Promise<number> =>
    ipcRenderer.invoke('getMaxGamesFromIndex'),
  setMaxGamesFromIndex: (maxGames: number): Promise<number> =>
    ipcRenderer.invoke('setMaxGamesFromIndex', maxGames),
  getBeamersAutoSubscribe: (): Promise<boolean> =>
    ipcRenderer.invoke('getBeamersAutoSubscribe'),
  setBeamersAutoSubscribe: (on: boolean): Promise<void> =>
    ipcRenderer.invoke('setBeamersAutoSubscribe', on),
  getKeepOldReplays: (): Promise<KeepOldReplays> =>
    ipcRenderer.invoke('getKeepOldReplays'),
  setKeepOldReplays: (on: boolean, count: number): Promise<KeepOldReplays> =>
    ipcRenderer.invoke('setKeepOldReplays', on, count),
  getDownloadedReplaysSize: (): Promise<ReplaysSize> =>
    ipcRenderer.invoke('getDownloadedReplaysSize'),
  deleteDownloadedReplays: (): Promise<void> =>
    ipcRenderer.invoke('deleteDownloadedReplays'),
  getVersion: (): Promise<string> => ipcRenderer.invoke('getVersion'),
  getLatestVersion: (): Promise<string> =>
    ipcRenderer.invoke('getLatestVersion'),
  update: (): Promise<void> => ipcRenderer.invoke('update'),
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
