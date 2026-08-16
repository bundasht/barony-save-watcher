import { createHash, randomUUID } from 'node:crypto'
import type { CharacterSummary, GameMode, SaveMetadata } from '../../shared/types'

type JsonObject = Record<string, unknown>

export interface ParsedSave {
  raw: JsonObject
  metadata: SaveMetadata
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function characterFromPlayer(value: unknown): CharacterSummary | null {
  const player = object(value)
  const stats = object(player?.stats)
  if (!stats) return null
  const name = string(stats.name)
  if (!name) return null
  const nullableNumber = (input: unknown): number | null =>
    typeof input === 'number' && Number.isFinite(input) ? input : null
  return {
    name,
    level: nullableNumber(stats.LVL),
    hp: nullableNumber(stats.HP),
    maxHp: nullableNumber(stats.MAXHP ?? stats.maxHP),
    mp: nullableNumber(stats.MP),
    maxMp: nullableNumber(stats.MAXMP ?? stats.maxMP),
    gold: nullableNumber(stats.GOLD)
  }
}

export function parseSave(bytes: Buffer): ParsedSave {
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('The file is not complete JSON')
  }
  const raw = object(parsed)
  if (!raw || raw.magic_cookie !== 'BARONYJSONSAVE') {
    throw new Error('The file is not a Barony save')
  }
  const players = Array.isArray(raw.players) ? raw.players : []
  const characters = players
    .map(characterFromPlayer)
    .filter((entry): entry is CharacterSummary => entry !== null)
  const playerNumber = number(raw.player_num)
  const localName = characters[playerNumber]?.name
  const gameName = string(raw.game_name, localName ?? 'Unnamed game')
  return {
    raw,
    metadata: {
      gameName,
      gameKey: number(raw.gamekey),
      lobbyKey: number(raw.lobbykey),
      dungeonLevel: number(raw.dungeon_lvl),
      secretLevel: Boolean(raw.level_track),
      playerNumber,
      multiplayerType: number(raw.multiplayer_type),
      gameTimer: number(raw.gametimer),
      timestamp: string(raw.timestamp),
      characters
    }
  }
}

export function modeFromFileName(fileName: string): GameMode {
  return fileName.includes('_mp.') || fileName.includes('_mp_')
    ? 'multiplayer'
    : 'singleplayer'
}

export function slotFromFileName(fileName: string): number {
  const match = /^savegame(\d+)/.exec(fileName)
  return match ? Number(match[1]) : 0
}

export function makeGameId(mode: GameMode, metadata: SaveMetadata): string {
  return mode === 'multiplayer'
    ? `mp-${metadata.gameKey}-${metadata.lobbyKey}`
    : `sp-${metadata.gameKey}`
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function makeVersionId(): string {
  return randomUUID()
}

export function sanitizeSegment(value: string): string {
  const sanitized = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const shortened = sanitized.slice(0, 72) || 'Unnamed'
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(shortened)
    ? `_${shortened}`
    : shortened
}

export function fileTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export function isActiveSaveName(fileName: string): boolean {
  return /^savegame\d+(?:_mp)?\.baronysave$/.test(fileName)
}
