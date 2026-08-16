import { homedir } from 'node:os'
import { join } from 'node:path'
import { rename } from 'node:fs/promises'

export interface PlatformPaths {
  sourceDirectory: string
  historyDirectory: string
}

export function defaultPlatformPaths(platform = process.platform): PlatformPaths {
  const home = homedir()
  if (platform === 'win32') {
    return {
      sourceDirectory: join(home, 'AppData', 'Local', 'Barony', 'savegames'),
      historyDirectory: join(home, 'Barony Save History')
    }
  }
  return {
    sourceDirectory: join(home, '.barony', 'savegames'),
    historyDirectory: join(home, 'Barony Save History')
  }
}

export async function atomicReplace(tempPath: string, targetPath: string): Promise<void> {
  // POSIX rename atomically replaces the destination. The function is isolated so
  // Windows can use ReplaceFileW-compatible behavior without touching the engine.
  await rename(tempPath, targetPath)
}
