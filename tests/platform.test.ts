import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  atomicReplace,
  discoverWindowsSaveDirectory,
  isRetryableWindowsReplaceError,
  parseSteamLibraryFolders,
  resolveSaveDirectorySelection
} from '../src/main/core/platform'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'barony-platform-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('platform support', () => {
  it('parses additional Steam library paths', () => {
    const contents = `"libraryfolders"\n{\n  "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" }\n  "1" { "path" "D:\\\\Games\\\\SteamLibrary" }\n}`
    expect(parseSteamLibraryFolders(contents)).toEqual([
      'C:\\Program Files (x86)\\Steam',
      'D:\\Games\\SteamLibrary'
    ])
  })

  it('discovers Barony in a non-default Steam library', async () => {
    const root = await temporaryRoot()
    const steam = join(root, 'Steam')
    const library = join(root, 'Games')
    const savegames = join(library, 'steamapps', 'common', 'Barony', 'savegames')
    await mkdir(join(steam, 'steamapps', 'common', 'Barony', 'savegames'), { recursive: true })
    await mkdir(savegames, { recursive: true })
    await writeFile(join(savegames, 'savegame0.baronysave'), '{}')
    await writeFile(join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "1" { "path" "${library}" } }`)

    expect(await discoverWindowsSaveDirectory({ steamRoots: [steam] })).toBe(savegames)
  })

  it('accepts either Barony or savegames in the folder picker', async () => {
    const root = await temporaryRoot()
    const barony = join(root, 'Barony')
    const savegames = join(barony, 'savegames')
    await mkdir(savegames, { recursive: true })

    expect(await resolveSaveDirectorySelection(barony)).toBe(savegames)
    expect(await resolveSaveDirectorySelection(savegames)).toBe(savegames)
    expect(await resolveSaveDirectorySelection(root)).toBeNull()
  })

  it('atomically overwrites an existing destination', async () => {
    const root = await temporaryRoot()
    const temporary = join(root, 'save.tmp')
    const target = join(root, 'savegame0.baronysave')
    await writeFile(temporary, 'restored')
    await writeFile(target, 'active')

    await atomicReplace(temporary, target)
    expect(await readFile(target, 'utf8')).toBe('restored')
  })

  it('retries only Windows sharing and permission errors', () => {
    expect(isRetryableWindowsReplaceError(Object.assign(new Error(), { code: 'EBUSY' }))).toBe(true)
    expect(isRetryableWindowsReplaceError(Object.assign(new Error(), { code: 'EPERM' }))).toBe(true)
    expect(isRetryableWindowsReplaceError(Object.assign(new Error(), { code: 'ENOENT' }))).toBe(false)
  })
})
