# Barony Save History

A macOS-first desktop companion that automatically archives Barony's active save after every level and lets you safely restore any archived version. The core and UI are structured for a later Windows build from the same codebase.

## V0 behavior

- Watches `~/.barony/savegames` while the application is running.
- Archives each distinct completed `savegameN.baronysave` and `savegameN_mp.baronysave`.
- Groups history into singleplayer and multiplayer games, then readable per-level versions.
- Keeps index records visible when backup files are deleted manually.
- Before restoring, archives the current active save as a **Before restore** version.
- Restores with an atomic file replacement; Barony may remain open.
- Never deletes active saves or history files.

Restoring changes the on-disk save, not the level currently loaded in Barony's memory. Continuing an active run may overwrite the restored file at the next level transition.

## Development

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm run typecheck
npm test
npm run build
```

## macOS distribution

Build the `.dmg` and `.zip` on macOS:

```bash
npm run dist:mac
```

The builder produces Apple Silicon and Intel artifacts in `release/`. Unsigned development builds trigger the normal Gatekeeper warning. A public release should add an Apple Developer ID and notarization credentials.

## Windows adaptation

The renderer, history index, parser, backup engine, and restore workflow are platform-neutral. Windows work is isolated to save-directory discovery and destination replacement in `src/main/core/platform.ts`. Once implemented and tested on Windows:

```bash
npm run dist:win
```

## History format

Backups are stored under `~/Barony Save History/` with readable paths. `index.json` is an append-only catalogue from the user's perspective: removing a `.baronysave` manually marks its version as missing but does not remove the version or game from the UI.
