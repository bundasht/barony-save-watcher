import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { BackupEngine } from './core/backup-engine'
import { defaultPlatformPaths } from './core/platform'
import type { GameMode } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let engine: BackupEngine

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 740,
    minWidth: 820,
    minHeight: 600,
    title: 'Barony Save History',
    backgroundColor: '#12100d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('history:get-state', () => engine.getState())
  ipcMain.handle('history:get-games', (_event, mode: GameMode) => engine.store.games(mode))
  ipcMain.handle('history:get-versions', (_event, gameId: string) => engine.store.versions(gameId))
  ipcMain.handle('history:get-version', (_event, versionId: string) => engine.store.version(versionId))
  ipcMain.handle('history:restore', (_event, versionId: string) => engine.restore(versionId))
  ipcMain.handle('history:rescan', () => engine.scan())
  ipcMain.handle('history:reveal', () => shell.openPath(engine.historyDirectory))
}

app.whenReady().then(async () => {
  const paths = defaultPlatformPaths()
  engine = new BackupEngine(paths.sourceDirectory, paths.historyDirectory)
  await engine.initialize()
  registerIpc()
  engine.on('changed', () => mainWindow?.webContents.send('history:changed'))
  engine.start()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    engine?.stop()
    app.quit()
  }
})

app.on('before-quit', () => engine?.stop())
