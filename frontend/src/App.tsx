import { useEffect } from 'react'
import { useMuseStream } from './hooks/useMuseStream'
import {
  useActiveSection,
  useAtmosphereEngine,
} from './hooks/useAtmosphere'
import { atmosphere } from './state/atmosphere'
import { Atmosphere } from './components/Atmosphere'
import { StateBadge } from './components/StateBadge'
import { SignalQualitySection } from './components/SignalQuality'
import { BrainwaveBandsSection } from './components/BrainwaveBands'
import { FocusRelaxSection } from './components/FocusRelax'
import { BodySignalsSection } from './components/BodySignals'
import { HeartMotionSection } from './components/HeartMotion'
import { NeurofeedbackSection } from './components/Neurofeedback'
import type { SectionId } from './state/brainState'
import './App.css'

const NAV = [
  { id: 'signal', label: 'Signal' },
  { id: 'bands', label: 'Bands' },
  { id: 'focus', label: 'Focus' },
  { id: 'artifacts', label: 'Body' },
  { id: 'heart', label: 'Heart' },
  { id: 'nf', label: 'Feedback' },
] as const

const SECTION_IDS = NAV.map((n) => n.id) as readonly SectionId[]

/** Stable identity so the trace canvas isn't invalidated before meta arrives. */
const DEFAULT_CHANNELS = ['TP9', 'AF7', 'AF8', 'TP10']

export default function App() {
  const stream = useMuseStream()
  const channels = stream.meta?.channels ?? DEFAULT_CHANNELS
  const active = useActiveSection(SECTION_IDS)

  useAtmosphereEngine(stream.frame, active)

  // The section you're reading inherits the live colour, so its own chrome,
  // meters and bloom shift with the state instead of sitting in fixed paint.
  useEffect(() => {
    const el = document.getElementById(active)
    if (!el) return
    el.dataset.live = 'true'
    const release = atmosphere.addSurface(el)
    return () => {
      delete el.dataset.live
      release()
    }
  }, [active])

  return (
    <div className="app">
      <Atmosphere />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">∿</span>
          <div>
            <h1>NeuroScope</h1>
            <p className="tagline">
              {stream.connected ? 'live' : 'connecting…'}
              {stream.meta && (
                <>
                  {' · '}
                  {stream.meta.source}
                  {stream.meta.simulated && <span className="sim-badge">SIM</span>}
                </>
              )}
            </p>
          </div>
        </div>

        <StateBadge section={active} />

        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} className={n.id === active ? 'is-active' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        {stream.error && <p className="status-err">{stream.error}</p>}
      </header>

      <main className="main">
        <SignalQualitySection
          eegBuffers={stream.eegBuffers}
          frame={stream.frame}
          channels={channels}
        />
        <BrainwaveBandsSection frame={stream.frame} />
        <FocusRelaxSection
          frame={stream.frame}
          focusHistory={stream.focusHistory}
          calmHistory={stream.calmHistory}
        />
        <BodySignalsSection frame={stream.frame} />
        <HeartMotionSection frame={stream.frame} hrHistory={stream.hrHistory} />
        <NeurofeedbackSection frame={stream.frame} alphaHistory={stream.alphaHistory} />
      </main>

      <footer className="footer">
        <p>
          Educational dashboard · not a medical device ·{' '}
          {stream.meta?.simulated
            ? 'simulation mode — no hardware required'
            : 'real Muse via muselsl → LSL'}
        </p>
        <p className="footer-note">
          State words are interpretive readings of the same numbers shown in each panel —
          not diagnoses.
        </p>
      </footer>
    </div>
  )
}
