import { EventEmitter } from 'node:events'
import { copyFile, mkdir, open, readFile, readdir, rm, stat, utimes } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import type { BackupKind, GameRecord, RestoreResult, VersionRecord, WatcherState } from '../../shared/types'
import { HistoryStore } from './history-store'
import { atomicReplace } from './platform'
import {
  fileTimestamp,
  isActiveSaveName,
  makeGameId,
  makeVersionId,
  modeFromFileName,
  parseSave,
  sanitizeSegment,
  sha256,
  slotFromFileName
} from './save-file'

interface Fingerprint { size: number; mtimeMs: number }

export class BackupEngine extends EventEmitter {
  readonly store: HistoryStore
  private timer: NodeJS.Timeout | null = null
  private fingerprints = new Map<string, Fingerprint>()
  private scanPromise: Promise<void> | null = null
  private restoring = false
  private state: WatcherState

  constructor(
    readonly sourceDirectory: string,
    readonly historyDirectory: string,
    private readonly pollIntervalMs = 1000
  ) {
    super()
    this.store = new HistoryStore(historyDirectory)
    this.state = {
      sourceDirectory,
      historyDirectory,
      running: false,
      lastScanAt: null,
      lastBackupAt: null,
      lastError: null
    }
  }

  async initialize(): Promise<void> {
    await this.store.initialize()
    await mkdir(this.sourceDirectory, { recursive: true })
  }

  start(): void {
    if (this.timer) return
    this.state.running = true
    void this.scan()
    this.timer = setInterval(() => void this.scan(), this.pollIntervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.state.running = false
  }

  getState(): WatcherState {
    return structuredClone(this.state)
  }

  async scan(): Promise<void> {
    if (this.restoring) return
    if (this.scanPromise) return this.scanPromise
    this.scanPromise = this.performScan().finally(() => { this.scanPromise = null })
    return this.scanPromise
  }

  private async performScan(): Promise<void> {
    try {
      let scanError: string | null = null
      const names = (await readdir(this.sourceDirectory)).filter(isActiveSaveName)
      for (const name of names) {
        const sourcePath = join(this.sourceDirectory, name)
        const info = await stat(sourcePath)
        const fingerprint = { size: info.size, mtimeMs: info.mtimeMs }
        const previous = this.fingerprints.get(sourcePath)
        if (previous?.size === fingerprint.size && previous.mtimeMs === fingerprint.mtimeMs) continue
        try {
          await this.backupFile(sourcePath, 'automatic', false)
          this.fingerprints.set(sourcePath, fingerprint)
        } catch (error) {
          // A save can briefly be incomplete while Barony writes it. Do not record
          // the fingerprint so the next scan retries without surfacing an error.
          const message = error instanceof Error ? error.message : String(error)
          if (message !== 'The file is not complete JSON' && message !== 'The file is not a Barony save') {
            scanError = message
          }
        }
      }
      this.state.lastScanAt = new Date().toISOString()
      this.state.lastError = scanError
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  async backupFile(sourcePath: string, kind: BackupKind, force: boolean): Promise<VersionRecord> {
    const bytes = await readFile(sourcePath)
    const parsed = parseSave(bytes)
    const fileName = basename(sourcePath)
    const fileInfo = await stat(sourcePath)
    const mode = modeFromFileName(fileName)
    const gameId = makeGameId(mode, parsed.metadata)
    const contentHash = sha256(bytes)
    const duplicate = this.store.findDuplicate(gameId, contentHash, kind)
    if (duplicate && !force) return duplicate

    const now = new Date()
    const route = parsed.metadata.secretLevel ? 'secret' : 'normal'
    const gameFolder = mode === 'multiplayer'
      ? `multiplayer__${sanitizeSegment(parsed.metadata.gameName)}__game-${parsed.metadata.gameKey}__lobby-${parsed.metadata.lobbyKey}`
      : `singleplayer__${sanitizeSegment(parsed.metadata.gameName)}__game-${parsed.metadata.gameKey}`
    const levelFolder = `level-${String(parsed.metadata.dungeonLevel).padStart(2, '0')}__${route}`
    const kindLabel = kind === 'before-restore' ? '__before-restore' : ''
    const targetName = `${fileTimestamp(now)}__slot-${String(slotFromFileName(fileName)).padStart(2, '0')}__player-${String(parsed.metadata.playerNumber).padStart(2, '0')}${kindLabel}__${contentHash.slice(0, 8)}.baronysave`
    const targetPath = join(this.historyDirectory, gameFolder, levelFolder, targetName)
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
    await utimes(targetPath, fileInfo.atime, fileInfo.mtime).catch(() => undefined)

    const createdAt = now.toISOString()
    const version: VersionRecord = {
      id: makeVersionId(), gameId, mode, kind, createdAt,
      originalMtimeMs: fileInfo.mtimeMs,
      originalFileName: fileName,
      relativePath: relative(this.historyDirectory, targetPath),
      contentHash,
      byteSize: bytes.byteLength,
      metadata: parsed.metadata,
      status: 'available'
    }
    const game: GameRecord = {
      id: gameId,
      mode,
      gameKey: parsed.metadata.gameKey,
      lobbyKey: parsed.metadata.lobbyKey,
      displayName: parsed.metadata.gameName,
      createdAt,
      lastSeenAt: createdAt,
      versionIds: []
    }
    await this.store.addVersion(game, version)
    this.state.lastBackupAt = createdAt
    this.emit('changed')
    return version
  }

  async restore(versionId: string): Promise<RestoreResult> {
    if (this.restoring) throw new Error('A restore is already in progress')
    this.restoring = true
    try {
      if (this.scanPromise) await this.scanPromise
      const version = await this.store.version(versionId)
      if (!version) throw new Error('Backup version is not in the history index')
      if (version.status === 'missing') throw new Error('The backup file has been deleted')
      if (version.status === 'invalid') throw new Error('The backup file is invalid')
      const backupPath = this.store.backupPath(version)
      const bytes = await readFile(backupPath)
      parseSave(bytes)

      const targetPath = join(this.sourceDirectory, version.originalFileName)
      let safetyBackupId: string | null = null
      try {
        await stat(targetPath)
        const safety = await this.backupFile(targetPath, 'before-restore', true)
        safetyBackupId = safety.id
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }

      await mkdir(dirname(targetPath), { recursive: true })
      const temporary = `${targetPath}.${process.pid}.${Date.now()}.tmp`
      try {
        const handle = await open(temporary, 'wx', 0o600)
        try {
          await handle.writeFile(bytes)
          await handle.sync()
        } finally {
          await handle.close()
        }
        const restoredDate = new Date(version.originalMtimeMs)
        await utimes(temporary, restoredDate, restoredDate).catch(() => undefined)
        await atomicReplace(temporary, targetPath)
        parseSave(await readFile(targetPath))
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }

      const targetInfo = await stat(targetPath)
      this.fingerprints.set(targetPath, { size: targetInfo.size, mtimeMs: targetInfo.mtimeMs })
      this.emit('changed')
      return { restoredVersionId: versionId, targetPath, safetyBackupId }
    } finally {
      this.restoring = false
    }
  }
}
