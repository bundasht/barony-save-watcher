export type GameMode = 'singleplayer' | 'multiplayer'
export type VersionStatus = 'available' | 'missing' | 'invalid'
export type BackupKind = 'automatic' | 'before-restore'

export interface CharacterSummary {
  name: string
  level: number | null
  hp: number | null
  maxHp: number | null
  mp: number | null
  maxMp: number | null
  gold: number | null
}

export interface SaveMetadata {
  gameName: string
  gameKey: number
  lobbyKey: number
  dungeonLevel: number
  secretLevel: boolean
  playerNumber: number
  multiplayerType: number
  gameTimer: number
  timestamp: string
  characters: CharacterSummary[]
}

export interface VersionRecord {
  id: string
  gameId: string
  mode: GameMode
  kind: BackupKind
  createdAt: string
  originalMtimeMs: number
  originalFileName: string
  relativePath: string
  contentHash: string
  byteSize: number
  metadata: SaveMetadata
  status: VersionStatus
}

export interface GameRecord {
  id: string
  mode: GameMode
  gameKey: number
  lobbyKey: number
  displayName: string
  createdAt: string
  lastSeenAt: string
  versionIds: string[]
}

export interface HistoryIndex {
  schemaVersion: 1
  games: GameRecord[]
  versions: VersionRecord[]
}

export interface WatcherState {
  sourceDirectory: string | null
  historyDirectory: string
  running: boolean
  lastScanAt: string | null
  lastBackupAt: string | null
  lastError: string | null
}

export interface RestoreResult {
  restoredVersionId: string
  targetPath: string
  safetyBackupId: string | null
}

export interface BaronyHistoryApi {
  getState(): Promise<WatcherState>
  getGames(mode: GameMode): Promise<GameRecord[]>
  getVersions(gameId: string): Promise<VersionRecord[]>
  getVersion(versionId: string): Promise<VersionRecord | null>
  restore(versionId: string): Promise<RestoreResult>
  rescan(): Promise<void>
  chooseSourceDirectory(): Promise<string | null>
  revealHistory(): Promise<void>
  onHistoryChanged(callback: () => void): () => void
}
