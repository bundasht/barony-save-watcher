import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BackupEngine } from './core/backup-engine'
import { HistoryStore } from './core/history-store'
import {
  atomicReplace,
  defaultHistoryDirectory,
  discoverSourceDirectory,
  resolveSaveDirectorySelection
} from './core/platform'
import type { GameMode, WatcherState } from '../shared/types'

const APP_ID = 'com.bohdanturani.barony-save-history'

interface AppSettings {
  sourceDirectory?: string
}

let mainWindow: BrowserWindow | null = null
let engine: BackupEngine | null = null
let historyStore: HistoryStore
let historyDirectory: string
let idleState: WatcherState

if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function loadSettings(): Promise<AppSettings> {
  try {
    return JSON.parse(await readFile(settingsPath(), 'utf8')) as AppSettings
  } catch {
    return {}
  }
}

async function saveSettings(settings: AppSettings): Promise<void> {
  const target = settingsPath()
  const temporary = `${target}.${process.pid}.tmp`
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  await atomicReplace(temporary, target)
}

function notifyHistoryChanged(): void {
  mainWindow?.webContents.send('history:changed')
}

async function configureEngine(sourceDirectory: string): Promise<void> {
  if (engine) await engine.stopAndWait()
  const nextEngine = new BackupEngine(sourceDirectory, historyDirectory, 1000, historyStore)
  nextEngine.on('changed', notifyHistoryChanged)
  engine = nextEngine
  engine.start()
}

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

async function chooseSourceDirectory(): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: 'Choose the Barony save folder',
    message: 'Choose Barony itself or its savegames folder.',
    properties: ['openDirectory']
  }
  const selection = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || !selection.filePaths[0]) return null

  const sourceDirectory = await resolveSaveDirectorySelection(selection.filePaths[0])
  if (!sourceDirectory) {
    throw new Error('Choose the Barony installation folder or its savegames folder')
  }
  await configureEngine(sourceDirectory)
  await saveSettings({ sourceDirectory })
  notifyHistoryChanged()
  return sourceDirectory
}

function registerIpc(): void {
  ipcMain.handle('history:get-state', () => engine?.getState() ?? idleState)
  ipcMain.handle('history:get-games', (_event, mode: GameMode) => historyStore.games(mode))
  ipcMain.handle('history:get-versions', (_event, gameId: string) => historyStore.versions(gameId))
  ipcMain.handle('history:get-version', (_event, versionId: string) => historyStore.version(versionId))
  ipcMain.handle('history:restore', (_event, versionId: string) => {
    if (!engine) throw new Error('Choose the Barony save folder before restoring a backup')
    return engine.restore(versionId)
  })
  ipcMain.handle('history:rescan', () => engine?.scan())
  ipcMain.handle('history:choose-source', () => chooseSourceDirectory())
  ipcMain.handle('history:reveal', () => shell.openPath(historyDirectory))
}

app.whenReady().then(async () => {
  historyDirectory = defaultHistoryDirectory()
  historyStore = new HistoryStore(historyDirectory)
  await historyStore.initialize()

  const settings = await loadSettings()
  const sourceDirectory = await discoverSourceDirectory(settings.sourceDirectory)
  idleState = {
    sourceDirectory: null,
    historyDirectory,
    running: false,
    lastScanAt: null,
    lastBackupAt: null,
    lastError: 'Choose the Barony save folder to start watching'
  }
  if (sourceDirectory) {
    await configureEngine(sourceDirectory)
    if (settings.sourceDirectory !== sourceDirectory) await saveSettings({ sourceDirectory })
  }

  registerIpc()
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
