import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { GameMode, GameRecord, HistoryIndex, VersionRecord, VersionStatus } from '../../shared/types'
import { parseSave } from './save-file'

const EMPTY_INDEX: HistoryIndex = { schemaVersion: 1, games: [], versions: [] }

export class HistoryStore {
  readonly indexPath: string
  private index: HistoryIndex = structuredClone(EMPTY_INDEX)

  constructor(readonly rootDirectory: string) {
    this.indexPath = join(rootDirectory, 'index.json')
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.indexPath, 'utf8')) as HistoryIndex
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.games) || !Array.isArray(parsed.versions)) {
        throw new Error('Unsupported history index')
      }
      this.index = parsed
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        const preserved = join(this.rootDirectory, `index.invalid-${Date.now()}.json`)
        await rename(this.indexPath, preserved).catch(() => undefined)
      }
      this.index = structuredClone(EMPTY_INDEX)
      await this.save()
    }
  }

  snapshot(): HistoryIndex {
    return structuredClone(this.index)
  }

  async addVersion(game: GameRecord, version: VersionRecord): Promise<void> {
    const existingGame = this.index.games.find((entry) => entry.id === game.id)
    if (existingGame) {
      existingGame.lastSeenAt = version.createdAt
      existingGame.displayName = game.displayName || existingGame.displayName
      if (!existingGame.versionIds.includes(version.id)) existingGame.versionIds.push(version.id)
    } else {
      this.index.games.push({ ...game, versionIds: [version.id] })
    }
    this.index.versions.push(version)
    await this.save()
  }

  findDuplicate(gameId: string, contentHash: string, kind: VersionRecord['kind']): VersionRecord | undefined {
    return this.index.versions.find((entry) =>
      entry.gameId === gameId && entry.contentHash === contentHash && entry.kind === kind)
  }

  getVersion(versionId: string): VersionRecord | undefined {
    return this.index.versions.find((entry) => entry.id === versionId)
  }

  async games(mode: GameMode): Promise<GameRecord[]> {
    return this.index.games
      .filter((game) => game.mode === mode)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .map((game) => structuredClone(game))
  }

  async versions(gameId: string): Promise<VersionRecord[]> {
    const versions = this.index.versions
      .filter((version) => version.gameId === gameId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return Promise.all(versions.map((version) => this.withCurrentStatus(version)))
  }

  async version(versionId: string): Promise<VersionRecord | null> {
    const version = this.getVersion(versionId)
    return version ? this.withCurrentStatus(version) : null
  }

  backupPath(version: VersionRecord): string {
    return join(this.rootDirectory, version.relativePath)
  }

  private async withCurrentStatus(version: VersionRecord): Promise<VersionRecord> {
    let status: VersionStatus = 'available'
    try {
      const backupPath = this.backupPath(version)
      await stat(backupPath)
      try {
        parseSave(await readFile(backupPath))
      } catch {
        status = 'invalid'
      }
    } catch (error) {
      status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid'
    }
    return { ...structuredClone(version), status }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true })
    const temporary = `${this.indexPath}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.index, null, 2)}\n`, 'utf8')
    await rename(temporary, this.indexPath)
  }
}
