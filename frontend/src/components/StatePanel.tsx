import { useEffect } from 'react'
import { stateColors } from '../state/atmosphere'
import { SECTION_LABELS } from '../state/brainState'
import { SECTION_DOSSIERS, STATE_DOSSIERS } from '../state/dossier'
import type { Reading } from '../state/dossier'
import type { BrainState, SectionId } from '../state/brainState'

export interface PanelSnapshot {
  section: SectionId
  state: BrainState
  reading: Reading[]
}

interface Props {
  snapshot: PanelSnapshot | null
  /** The word showing right now, so a stale snapshot can say so. */
  liveWord: string
  onClose: () => void
}

/**
 * Slides in from the right and holds the state it was opened on. The word sits
 * inside the panel's own outline so it reads as an explanation of that word,
 * and its colours are frozen from the snapshot rather than tracking live.
 */
export function StatePanel({ snapshot, liveWord, onClose }: Props) {
  useEffect(() => {
    if (!snapshot) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [snapshot, onClose])

  if (!snapshot) return null

  const { section, state, reading } = snapshot
  const dossier = SECTION_DOSSIERS[section]
  const detail = STATE_DOSSIERS[state.key] ?? STATE_DOSSIERS.neutral
  const colors = stateColors(state.h, state.s, state.l)
  const stale = liveWord !== state.word

  return (
    <aside
      className="panel"
      role="dialog"
      aria-modal="false"
      aria-label={`${state.word} — what this means`}
      style={{ '--edge': colors.edge, '--glow': colors.glow } as React.CSSProperties}
    >
      <div className="panel-head">
        <div className="panel-word-frame">
          <span className="panel-section">{SECTION_LABELS[section]}</span>
          <span className="panel-word">{state.word}</span>
          <span className="panel-note">{state.note}</span>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="panel-scroll">
        {stale && (
          <p className="panel-stale">
            Held at the moment you opened this. The live state now reads{' '}
            <strong>{liveWord}</strong>.
          </p>
        )}

        <section className="panel-block">
          <h3>The measure</h3>
          <p className="panel-measure">{dossier.measure}</p>
          <p className="panel-formula">{dossier.formula}</p>
          {reading.length > 0 && (
            <dl className="panel-reading">
              {reading.map((r) => (
                <div key={r.label}>
                  <dt>{r.label}</dt>
                  <dd className="mono">{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="panel-block">
          <h3>At this ratio</h3>
          <p className="panel-headline">{detail.headline}</p>
          {detail.body.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </section>

        <section className="panel-block">
          <h3>Where the signal comes from</h3>
          {dossier.background.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </section>

        <section className="panel-block panel-limits">
          <h3>What it does not mean</h3>
          <p>{dossier.caveat}</p>
        </section>
      </div>
    </aside>
  )
}
