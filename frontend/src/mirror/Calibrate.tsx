import { useEffect, useReducer } from 'react'
import { BASELINE_SECONDS, PHASES, baseline } from '../state/mirror/baseline'

interface Props {
  onClose: () => void
}

/**
 * Sixty seconds against yourself.
 *
 * The clock only advances on real frames, so a dropped stream pauses the
 * calibration rather than quietly filling the baseline with nothing.
 */
export function Calibrate({ onClose }: Props) {
  const [, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => baseline.subscribe(bump), [])
  // Progress is written by the mapping layer at 10 Hz; poll it rather than
  // pushing a React update from inside the signal path.
  useEffect(() => {
    const timer = setInterval(bump, 200)
    return () => clearInterval(timer)
  }, [])

  const cal = baseline.calibration
  const phase = PHASES[cal.phaseIndex]
  const record = baseline.record

  return (
    <div className="cal">
      <div className="cal-inner">
        <header className="cal-head">
          <h2>Baseline</h2>
          <button type="button" onClick={onClose}>
            ✕
          </button>
        </header>

        {!cal.running && (
          <>
            <p>
              Every slow effect in the mirror is a z-score against your own baseline, not a
              fixed threshold. Focus, calm and asymmetry indices do not carry between people
              or even between sessions, so the mirror measures you against you.
            </p>
            <ol className="cal-phases">
              {PHASES.map((p) => (
                <li key={p.id}>
                  <strong>{p.label}</strong> · {p.seconds}s — {p.instruction}
                </li>
              ))}
            </ol>
            <p className="cal-status mono">
              {record
                ? `calibrated ${new Date(record.createdAt).toLocaleString()}`
                : 'no stored baseline — running on a session estimate'}
            </p>
            <div className="cal-actions">
              <button type="button" className="cal-go" onClick={() => baseline.begin()}>
                {record ? 'Recalibrate' : 'Start 60 s calibration'}
              </button>
              {record && (
                <button type="button" onClick={() => baseline.clear()}>
                  Forget baseline
                </button>
              )}
            </div>
          </>
        )}

        {cal.running && (
          <>
            <p className="cal-phase-label">
              {cal.phaseIndex + 1} / {PHASES.length} · {phase.label}
            </p>
            <p className="cal-instruction">{phase.instruction}</p>
            <div className="cal-bar">
              <div
                className="cal-bar-fill"
                style={{ width: `${(cal.total / BASELINE_SECONDS) * 100}%` }}
              />
            </div>
            <p className="cal-status mono">
              {Math.max(0, phase.seconds - cal.elapsed).toFixed(0)} s left in this phase ·{' '}
              {Math.max(0, BASELINE_SECONDS - cal.total).toFixed(0)} s total
            </p>
            <div className="cal-actions">
              <button type="button" onClick={() => baseline.abort()}>
                Abort
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
