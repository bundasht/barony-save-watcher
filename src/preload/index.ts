import { contextBridge, ipcRenderer } from 'electron'
import type { BaronyHistoryApi, GameMode } from '../shared/types'

const api: BaronyHistoryApi = {
  getState: () => ipcRenderer.invoke('history:get-state'),
  getGames: (mode: GameMode) => ipcRenderer.invoke('history:get-games', mode),
  getVersions: (gameId: string) => ipcRenderer.invoke('history:get-versions', gameId),
  getVersion: (versionId: string) => ipcRenderer.invoke('history:get-version', versionId),
  restore: (versionId: string) => ipcRenderer.invoke('history:restore', versionId),
  rescan: () => ipcRenderer.invoke('history:rescan'),
  revealHistory: () => ipcRenderer.invoke('history:reveal'),
  onHistoryChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('history:changed', listener)
    return () => ipcRenderer.removeListener('history:changed', listener)
  }
}

contextBridge.exposeInMainWorld('baronyHistory', api)
