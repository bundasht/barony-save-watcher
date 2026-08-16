import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { GameMode, GameRecord, VersionRecord, WatcherState } from '../../shared/types'

type Screen =
  | { name: 'home' }
  | { name: 'games'; mode: GameMode }
  | { name: 'versions'; mode: GameMode; game: GameRecord }
  | { name: 'detail'; mode: GameMode; game: GameRecord; versionId: string }

const modeLabel = (mode: GameMode): string => mode === 'singleplayer' ? 'Singleplayer' : 'Multiplayer'
const formatDate = (iso: string): string => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short'
}).format(new Date(iso))
const formatDuration = (ticks: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ticks / 50))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}
const routeLabel = (version: VersionRecord): string => version.metadata.secretLevel ? 'Secret route' : 'Normal route'

function BackButton({ onClick }: { onClick: () => void }): ReactElement {
  return <button className="back-button" onClick={onClick} aria-label="Go back">← <span>Back</span></button>
}

function EmptyState({ title, body }: { title: string; body: string }): ReactElement {
  return <div className="empty-state"><div className="empty-rune">◇</div><h2>{title}</h2><p>{body}</p></div>
}

export function App(): ReactElement {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [state, setState] = useState<WatcherState | null>(null)
  const [games, setGames] = useState<GameRecord[]>([])
  const [versions, setVersions] = useState<VersionRecord[]>([])
  const [detail, setDetail] = useState<VersionRecord | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setState(await window.baronyHistory.getState())
    if (screen.name === 'games') setGames(await window.baronyHistory.getGames(screen.mode))
    if (screen.name === 'versions') setVersions(await window.baronyHistory.getVersions(screen.game.id))
    if (screen.name === 'detail') setDetail(await window.baronyHistory.getVersion(screen.versionId))
  }, [screen])

  useEffect(() => {
    void refresh()
    return window.baronyHistory.onHistoryChanged(() => void refresh())
  }, [refresh])

  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), 2500)
    return () => window.clearInterval(interval)
  }, [refresh])

  const title = useMemo(() => {
    if (screen.name === 'home') return 'Save history'
    if (screen.name === 'games') return modeLabel(screen.mode)
    if (screen.name === 'versions') return screen.game.displayName
    return detail ? `Level ${detail.metadata.dungeonLevel}` : 'Backup details'
  }, [screen, detail])

  const openMode = async (mode: GameMode): Promise<void> => {
    setGames(await window.baronyHistory.getGames(mode))
    setScreen({ name: 'games', mode })
  }

  const openGame = async (mode: GameMode, game: GameRecord): Promise<void> => {
    setVersions(await window.baronyHistory.getVersions(game.id))
    setScreen({ name: 'versions', mode, game })
  }

  const openDetail = async (mode: GameMode, game: GameRecord, versionId: string): Promise<void> => {
    setDetail(await window.baronyHistory.getVersion(versionId))
    setScreen({ name: 'detail', mode, game, versionId })
  }

  const chooseSourceDirectory = async (): Promise<void> => {
    try {
      const selected = await window.baronyHistory.chooseSourceDirectory()
      if (!selected) return
      setNotice(`Now watching ${selected}`)
      await refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const restore = async (): Promise<void> => {
    if (!detail) return
    setRestoring(true)
    try {
      await window.baronyHistory.restore(detail.id)
      setNotice('Save restored. The previous active save was preserved as a safety backup.')
      setConfirming(false)
      setDetail(await window.baronyHistory.getVersion(detail.id))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
      setConfirming(false)
    } finally {
      setRestoring(false)
    }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-mark">B</div>
      <div className="brand-copy"><strong>Barony</strong><span>Save History</span></div>
      <div className="watch-status">
        <span className={state?.running ? 'status-dot active' : 'status-dot'} />
        <div><strong>{state?.running ? 'Watching' : state?.sourceDirectory ? 'Stopped' : 'Setup needed'}</strong><span>{state?.lastBackupAt ? `Last backup ${formatDate(state.lastBackupAt)}` : state?.sourceDirectory ? 'Waiting for a save' : 'Choose the Barony save folder'}</span></div>
      </div>
      <div className="sidebar-spacer" />
      <div className="sidebar-actions">
        <button className="text-button" onClick={() => void chooseSourceDirectory()}>{state?.sourceDirectory ? 'Change save folder' : 'Choose save folder'}…</button>
        <button className="text-button" onClick={() => void window.baronyHistory.revealHistory()}>Open history folder ↗</button>
      </div>
      <p className="source-path" title={state?.sourceDirectory ?? undefined}>{state?.sourceDirectory ?? 'No save folder selected'}</p>
    </aside>

    <main>
      <header>
        {screen.name !== 'home' && <BackButton onClick={() => {
          if (screen.name === 'games') setScreen({ name: 'home' })
          if (screen.name === 'versions') setScreen({ name: 'games', mode: screen.mode })
          if (screen.name === 'detail') setScreen({ name: 'versions', mode: screen.mode, game: screen.game })
        }} />}
        <div><p className="eyebrow">AUTOMATIC CHECKPOINT ARCHIVE</p><h1>{title}</h1></div>
      </header>

      {screen.name === 'home' && <section className="home-grid">
        <button className="mode-card" onClick={() => void openMode('singleplayer')}>
          <span className="mode-icon">♜</span><span><strong>Singleplayer</strong><small>Browse solo adventures</small></span><b>→</b>
        </button>
        <button className="mode-card" onClick={() => void openMode('multiplayer')}>
          <span className="mode-icon">♞</span><span><strong>Multiplayer</strong><small>Browse shared campaigns</small></span><b>→</b>
        </button>
        <div className="info-panel"><span>i</span><p>The app archives a new version whenever Barony updates an active save. It never removes versions from the history.</p></div>
        {state && !state.sourceDirectory && <div className="setup-warning"><strong>Save folder needed</strong><p>Choose Barony’s savegames folder before playing so new saves can be archived.</p><button className="secondary-button" onClick={() => void chooseSourceDirectory()}>Choose folder</button></div>}
      </section>}

      {screen.name === 'games' && <section className="content-list">
        {games.length === 0
          ? <EmptyState title="No games archived yet" body="Keep this app open while playing. A game will appear after Barony writes its next save." />
          : games.map((game) => <button className="list-card" key={game.id} onClick={() => void openGame(screen.mode, game)}>
            <span className="level-medallion">{game.versionIds.length}</span>
            <span className="list-main"><strong>{game.displayName}</strong><small>{game.mode === 'multiplayer' ? `Game ${game.gameKey} · Lobby ${game.lobbyKey}` : `Game ${game.gameKey}`}</small></span>
            <span className="list-meta"><strong>{game.versionIds.length} version{game.versionIds.length === 1 ? '' : 's'}</strong><small>{formatDate(game.lastSeenAt)}</small></span><b>›</b>
          </button>)}
      </section>}

      {screen.name === 'versions' && <section className="content-list">
        {versions.length === 0
          ? <EmptyState title="No versions in this game" body="The history index contains the game, but no versions are currently recorded." />
          : versions.map((version) => <button className={`list-card version-card ${version.status}`} key={version.id} onClick={() => void openDetail(screen.mode, screen.game, version.id)}>
            <span className="level-medallion">{version.metadata.dungeonLevel}</span>
            <span className="list-main"><strong>{version.kind === 'before-restore' ? 'Before restore' : `Level ${version.metadata.dungeonLevel}`}</strong><small>{routeLabel(version)} · Player {version.metadata.playerNumber + 1}</small></span>
            <span className="list-meta"><strong>{formatDate(version.createdAt)}</strong><small className={`file-status ${version.status}`}>{version.status === 'available' ? 'Available' : version.status === 'missing' ? 'Backup file missing' : 'Invalid backup'}</small></span><b>›</b>
          </button>)}
      </section>}

      {screen.name === 'detail' && detail && <section className="detail-layout">
        <div className="detail-hero">
          <span className="giant-level">{detail.metadata.dungeonLevel}</span>
          <div><p className="eyebrow">{routeLabel(detail).toUpperCase()}</p><h2>{detail.kind === 'before-restore' ? 'Before restore safety copy' : `Level ${detail.metadata.dungeonLevel}`}</h2><p>{formatDate(detail.createdAt)}</p></div>
          <span className={`status-badge ${detail.status}`}>{detail.status === 'available' ? 'Available' : detail.status === 'missing' ? 'File missing' : 'Invalid'}</span>
        </div>
        <div className="detail-grid">
          <div><span>Mode</span><strong>{modeLabel(detail.mode)}</strong></div>
          <div><span>Save slot</span><strong>{detail.originalFileName.match(/\d+/)?.[0] ?? '—'}</strong></div>
          <div><span>Play time</span><strong>{formatDuration(detail.metadata.gameTimer)}</strong></div>
          <div><span>File size</span><strong>{Math.max(1, Math.round(detail.byteSize / 1024))} KB</strong></div>
        </div>
        <div className="party-panel"><h3>{detail.metadata.characters.length > 1 ? 'Party' : 'Character'}</h3>
          {detail.metadata.characters.length === 0 ? <p>No character summary is available.</p> : detail.metadata.characters.map((character, index) => <div className="character-row" key={`${character.name}-${index}`}>
            <span className="character-number">{index + 1}</span><strong>{character.name}</strong>
            <span>LVL {character.level ?? '—'}</span><span>HP {character.hp ?? '—'}/{character.maxHp ?? '—'}</span><span>{character.gold ?? '—'} gold</span>
          </div>)}
        </div>
        {detail.status === 'missing' && <div className="missing-warning"><strong>Backup file missing</strong><p>This version remains in the history index, but its save data was deleted outside the app. It cannot be restored.</p></div>}
        <button className="restore-button" disabled={detail.status !== 'available'} onClick={() => setConfirming(true)}>Restore this version</button>
        <p className="restore-note">Restoring changes the saved file, not a level already running in memory. Continuing an active run may overwrite it at the next transition.</p>
      </section>}

      {confirming && detail && <div className="modal-backdrop"><div className="modal">
        <p className="eyebrow">CONFIRM RESTORE</p><h2>Overwrite the active save?</h2>
        <p>Level {detail.metadata.dungeonLevel} will be restored to <strong>{detail.originalFileName}</strong>. The current active save will first be archived as a “Before restore” version.</p>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setConfirming(false)} disabled={restoring}>Cancel</button><button className="restore-button" onClick={() => void restore()} disabled={restoring}>{restoring ? 'Restoring…' : 'Restore save'}</button></div>
      </div></div>}

      {notice && <div className="toast"><span>{notice}</span><button onClick={() => setNotice(null)}>×</button></div>}
    </main>
  </div>
}
