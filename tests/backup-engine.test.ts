import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { BackupEngine } from '../src/main/core/backup-engine'
import { HistoryStore } from '../src/main/core/history-store'

const roots: string[] = []
const save = (level: number, name = 'Bohdan'): string => JSON.stringify({
  magic_cookie: 'BARONYJSONSAVE', game_name: name, gamekey: 1234, lobbykey: 0,
  dungeon_lvl: level, level_track: 0, player_num: 0, multiplayer_type: 0,
  gametimer: level * 1000, timestamp: `level-${level}`,
  players: [{ stats: { name, LVL: level, HP: 20, MAXHP: 20, MP: 10, MAXMP: 10, GOLD: level } }]
})

async function setup(): Promise<{ engine: BackupEngine; source: string; history: string }> {
  const root = await mkdtemp(join(tmpdir(), 'barony-history-'))
  roots.push(root)
  const source = join(root, 'source')
  const history = join(root, 'history')
  await mkdir(source)
  const engine = new BackupEngine(source, history, 60_000)
  await engine.initialize()
  return { engine, source, history }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('backup engine', () => {
  it('uses an injected history store when the app changes source folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'barony-history-'))
    roots.push(root)
    const history = join(root, 'history')
    const store = new HistoryStore(history)
    const engine = new BackupEngine(join(root, 'source'), history, 60_000, store)

    expect(engine.store).toBe(store)
  })

  it('does not create a missing active save directory while initializing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'barony-history-'))
    roots.push(root)
    const source = join(root, 'missing-source')
    const engine = new BackupEngine(source, join(root, 'history'), 60_000)

    await engine.initialize()
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retries a partially written source save on a later scan', async () => {
    const { engine, source } = await setup()
    const active = join(source, 'savegame0.baronysave')
    await writeFile(active, '{')
    await engine.scan()
    expect(await engine.store.games('singleplayer')).toHaveLength(0)
    await writeFile(active, save(1))
    await engine.scan()
    expect(await engine.store.games('singleplayer')).toHaveLength(1)
  })

  it('backs up each changed level once and keeps readable paths', async () => {
    const { engine, source } = await setup()
    const active = join(source, 'savegame0.baronysave')
    await writeFile(active, save(1))
    await engine.scan()
    await engine.scan()
    await writeFile(active, save(2))
    await engine.scan()
    const games = await engine.store.games('singleplayer')
    const versions = await engine.store.versions(games[0]!.id)
    expect(versions).toHaveLength(2)
    expect(versions.map((version) => version.metadata.dungeonLevel).sort()).toEqual([1, 2])
    expect(versions[0]!.relativePath).toContain('singleplayer__Bohdan__game-1234')
  })

  it('retains index records when a backup file is manually deleted', async () => {
    const { engine, source } = await setup()
    const active = join(source, 'savegame0.baronysave')
    await writeFile(active, save(3))
    await engine.scan()
    const game = (await engine.store.games('singleplayer'))[0]!
    const version = (await engine.store.versions(game.id))[0]!
    await rm(engine.store.backupPath(version))
    const missing = await engine.store.version(version.id)
    expect(missing?.status).toBe('missing')
    expect((await engine.store.games('singleplayer'))[0]?.id).toBe(game.id)
  })

  it('keeps a corrupt external backup visible but marks it invalid', async () => {
    const { engine, source } = await setup()
    const active = join(source, 'savegame0.baronysave')
    await writeFile(active, save(3))
    await engine.scan()
    const game = (await engine.store.games('singleplayer'))[0]!
    const version = (await engine.store.versions(game.id))[0]!
    await writeFile(engine.store.backupPath(version), '{incomplete')
    expect((await engine.store.version(version.id))?.status).toBe('invalid')
  })

  it('creates a safety backup and atomically restores the selected version', async () => {
    const { engine, source } = await setup()
    const active = join(source, 'savegame0.baronysave')
    await writeFile(active, save(4))
    await engine.scan()
    const game = (await engine.store.games('singleplayer'))[0]!
    const levelFour = (await engine.store.versions(game.id))[0]!
    await writeFile(active, save(5))
    await engine.scan()
    const result = await engine.restore(levelFour.id)
    expect(result.safetyBackupId).not.toBeNull()
    expect(JSON.parse(await readFile(active, 'utf8')).dungeon_lvl).toBe(4)
    expect((await stat(active)).isFile()).toBe(true)
    const versions = await engine.store.versions(game.id)
    expect(versions.some((version) => version.kind === 'before-restore' && version.metadata.dungeonLevel === 5)).toBe(true)
  })
})
