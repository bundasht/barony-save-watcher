import { execFile } from 'node:child_process'
import { readFile, readdir, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, normalize } from 'node:path'

interface WindowsDiscoveryOptions {
  steamRoots?: string[]
  environment?: NodeJS.ProcessEnv
}

const WINDOWS_REPLACE_RETRY_DELAYS_MS = [25, 50, 100, 200, 400]

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory()
  } catch {
    return false
  }
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  return paths.filter((candidate) => {
    const key = normalize(candidate).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function registryValue(key: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', key, '/v', value], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null)
      const match = stdout.match(new RegExp(`^\\s*${value}\\s+REG_\\w+\\s+(.+?)\\s*$`, 'im'))
      resolve(match?.[1] ?? null)
    })
  })
}

async function installedSteamRoots(environment: NodeJS.ProcessEnv): Promise<string[]> {
  const roots = [
    environment.BARONY_STEAM_DIRECTORY,
    environment['ProgramFiles(x86)'] ? join(environment['ProgramFiles(x86)'], 'Steam') : undefined,
    environment.ProgramFiles ? join(environment.ProgramFiles, 'Steam') : undefined,
    await registryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    await registryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath')
  ]
  return uniquePaths(roots.filter((entry): entry is string => Boolean(entry)))
}

export function parseSteamLibraryFolders(contents: string): string[] {
  const libraries: string[] = []
  const matcher = /"path"\s+"((?:\\.|[^"\\])*)"/g
  for (const match of contents.matchAll(matcher)) {
    const decoded = match[1]!.replace(/\\\\/g, '\\').replace(/\\"/g, '"')
    libraries.push(decoded)
  }
  return uniquePaths(libraries)
}

export async function discoverWindowsSaveDirectory(
  options: WindowsDiscoveryOptions = {}
): Promise<string | null> {
  const environment = options.environment ?? process.env
  const steamRoots = options.steamRoots ?? await installedSteamRoots(environment)
  const libraries = [...steamRoots]

  for (const steamRoot of steamRoots) {
    try {
      const contents = await readFile(join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      libraries.push(...parseSteamLibraryFolders(contents))
    } catch {
      // Steam may not be installed here, or may not have created its library file yet.
    }
  }

  let firstExistingDirectory: string | null = null
  for (const library of uniquePaths(libraries)) {
    const candidate = join(library, 'steamapps', 'common', 'Barony', 'savegames')
    if (!await isDirectory(candidate)) continue
    if (await directoryContainsActiveSave(candidate)) return candidate
    firstExistingDirectory ??= candidate
  }
  return firstExistingDirectory
}

export async function discoverSourceDirectory(
  preferredSourceDirectory?: string,
  platform: NodeJS.Platform = process.platform,
  homeDirectory = homedir()
): Promise<string | null> {
  if (preferredSourceDirectory && await isDirectory(preferredSourceDirectory)) {
    return preferredSourceDirectory
  }
  if (platform === 'win32') return discoverWindowsSaveDirectory()
  const candidate = join(homeDirectory, '.barony', 'savegames')
  return await isDirectory(candidate) ? candidate : null
}

export async function resolveSaveDirectorySelection(selection: string): Promise<string | null> {
  if (!await isDirectory(selection)) return null
  if (basename(selection).toLowerCase() === 'savegames') return selection
  const nested = join(selection, 'savegames')
  return await isDirectory(nested) ? nested : null
}

export function defaultHistoryDirectory(homeDirectory = homedir()): string {
  return join(homeDirectory, 'Barony Save History')
}

export function isRetryableWindowsReplaceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

export async function atomicReplace(
  tempPath: string,
  targetPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // The temporary file is created beside the destination, so rename remains
      // an atomic replacement on both POSIX and Windows filesystems.
      await rename(tempPath, targetPath)
      return
    } catch (error) {
      const delay = WINDOWS_REPLACE_RETRY_DELAYS_MS[attempt]
      if (platform !== 'win32' || delay === undefined || !isRetryableWindowsReplaceError(error)) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

export async function directoryContainsActiveSave(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).some((name) => /^savegame\d+(?:_mp)?\.baronysave$/.test(name))
  } catch {
    return false
  }
}
