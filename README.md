# Barony Save History

A macOS and Windows desktop companion that automatically archives Barony's active save after every level and lets you safely restore any archived version.

## V0 behavior

- Watches `~/.barony/savegames` on macOS while the application is running.
- On Windows, discovers Barony in Steam libraries or lets you choose the installation/save folder.
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

## Windows distribution

Build the x64 NSIS installer and portable executable on Windows:

```bash
npm run dist:win
```

Artifacts are written to `release/`. Windows builds are unsigned during development, so Microsoft SmartScreen may warn before launch. The first launch searches Steam's configured libraries for `Barony/savegames`; use **Choose save folder** if Barony came from another storefront or is installed in a custom portable location.

Windows-specific save discovery and replacement retry behavior remain isolated in `src/main/core/platform.ts`. Restoration still archives the active save first and does not require Barony to be closed.

## History format

Backups are stored under `~/Barony Save History/` with readable paths. `index.json` is an append-only catalogue from the user's perspective: removing a `.baronysave` manually marks its version as missing but does not remove the version or game from the UI.
