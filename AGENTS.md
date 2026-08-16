# Barony Save History — agent guidance

## Product invariants

- The active Barony save directory is read-only during normal watching.
- Only an explicit user restore may write an active save.
- Every restore must first archive an existing active save as a `before-restore` version.
- Never remove an index record because its backup payload was deleted or corrupted externally. Show it as `missing` or `invalid`.
- Accept forward-compatible Barony JSON: validate the magic cookie and read only fields the UI needs; do not require an exhaustive schema.
- A partially written save is normal. Retry it on the next scan without indexing an error or fingerprint.
- Keep backup paths readable and Windows-safe even in the macOS release.
- Barony may remain open during restore. Do not introduce a process-closed requirement.

## Architecture

- `src/main/core` owns all filesystem and history behavior and must remain independent of Electron UI code.
- `src/shared/types.ts` is the IPC contract.
- `src/renderer` must access files only through the preload API.
- Isolate platform-specific save discovery and atomic replacement in `platform.ts` so Windows support does not fork the engine.

## Verification

Run before handoff:

```bash
npm run typecheck
npm test
npm run build
```

Tests must cover deduplication, malformed/incomplete source writes, externally missing backups, and pre-restore safety copies.
