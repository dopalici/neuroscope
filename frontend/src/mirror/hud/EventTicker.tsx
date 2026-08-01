export interface TickerEntry {
  id: number
  /** Seconds into the session. */
  at: number
  kind: string
  detail: string
}

interface Props {
  entries: readonly TickerEntry[]
}

/**
 * Blinks and clenches, timestamped. This is the one part of the HUD that goes
 * through React: entries arrive a few times a minute, not sixty times a second.
 */
export function EventTicker({ entries }: Props) {
  return (
    <div className="hud-ticker">
      <span className="hud-title">events</span>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className="hud-ticker-t mono">{clock(entry.at)}</span>
            <span className="hud-ticker-kind">{entry.kind}</span>
            <span className="hud-ticker-detail">{entry.detail}</span>
          </li>
        ))}
        {!entries.length && <li className="hud-ticker-empty">nothing yet</li>}
      </ul>
    </div>
  )
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
