import { describe, expect, it } from 'vitest'
import { isActiveSaveName, makeGameId, modeFromFileName, parseSave, sanitizeSegment } from '../src/main/core/save-file'

const sample = (overrides: Record<string, unknown> = {}): Buffer => Buffer.from(JSON.stringify({
  magic_cookie: 'BARONYJSONSAVE', game_name: 'Bohdan', gamekey: 100, lobbykey: 200,
  dungeon_lvl: 7, level_track: 0, player_num: 0, multiplayer_type: 0,
  gametimer: 3000, timestamp: '2026-08-16 20:00',
  players: [{ stats: { name: 'Bohdan', LVL: 5, HP: 20, MAXHP: 30, MP: 10, MAXMP: 15, GOLD: 42 } }],
  ...overrides
}))

describe('save parsing', () => {
  it('extracts stable metadata without depending on the complete schema', () => {
    const parsed = parseSave(sample())
    expect(parsed.metadata).toMatchObject({ gameName: 'Bohdan', gameKey: 100, dungeonLevel: 7 })
    expect(parsed.metadata.characters[0]).toMatchObject({ name: 'Bohdan', level: 5, maxHp: 30 })
  })

  it('rejects incomplete and unrelated JSON', () => {
    expect(() => parseSave(Buffer.from('{'))).toThrow('not complete JSON')
    expect(() => parseSave(Buffer.from('{}'))).toThrow('not a Barony save')
  })

  it('recognizes active saves and creates stable game ids', () => {
    expect(isActiveSaveName('savegame3_mp.baronysave')).toBe(true)
    expect(isActiveSaveName('savegame3_mp_screenshot.png')).toBe(false)
    expect(modeFromFileName('savegame3_mp.baronysave')).toBe('multiplayer')
    expect(makeGameId('multiplayer', parseSave(sample()).metadata)).toBe('mp-100-200')
  })

  it('sanitizes names for future Windows distributions', () => {
    expect(sanitizeSegment(' A/B:C*  ')).toBe('A-B-C-')
  })
})
