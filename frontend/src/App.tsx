import { useCallback, useEffect, useRef, useState } from 'react'
import { useMuseStream } from './hooks/useMuseStream'
import { useActiveSection, useAtmosphereEngine } from './hooks/useAtmosphere'
import { atmosphere } from './state/atmosphere'
import { Atmosphere } from './components/Atmosphere'
import { StateBadge } from './components/StateBadge'
import { StatePanel } from './components/StatePanel'
import type { PanelSnapshot } from './components/StatePanel'
import { readingFor } from './state/dossier'
import { useBrainState } from './hooks/useAtmosphere'
import type { BrainState } from './state/brainState'
import { SignalQualitySection } from './components/SignalQuality'
import { BrainwaveBandsSection } from './components/BrainwaveBands'
import { FocusRelaxSection } from './components/FocusRelax'
import { BodySignalsSection } from './components/BodySignals'
import { HeartMotionSection } from './components/HeartMotion'
import { NeurofeedbackSection } from './components/Neurofeedback'
import type { SectionId } from './state/brainState'
import { navigate } from './routes'
import { GestureLayer } from './mirror/GestureLayer'
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
  const liveState = useBrainState()
  const [snapshot, setSnapshot] = useState<PanelSnapshot | null>(null)
  const [gestures, setGestures] = useState(false)
  const [gestureStatus, setGestureStatus] = useState('off')
  const [gestureNote, setGestureNote] = useState<string | null>(null)

  const onGestureStatus = useCallback((status: string, message: string | null) => {
    setGestureStatus(status)
    setGestureNote(
      message ??
        (status === 'ready' ? 'hands tracking · pinch both hands and pull apart to open' : null),
    )
  }, [])

  useAtmosphereEngine(stream.frame, active)

  // Read through a ref so opening the panel doesn't need a callback rebuilt on
  // every 10 Hz frame.
  const latest = useRef({ frame: stream.frame, section: active })
  latest.current = { frame: stream.frame, section: active }

  const openPanel = useCallback((state: BrainState) => {
    const { frame, section } = latest.current
    setSnapshot((current) =>
      current && current.state.key === state.key
        ? null
        : { section, state, reading: readingFor(section, frame) },
    )
  }, [])

  const closePanel = useCallback(() => setSnapshot(null), [])

  // Opening from a different section would leave the word describing the wrong
  // measure, so scrolling away closes it.
  useEffect(() => {
    setSnapshot((current) => (current && current.section !== active ? null : current))
  }, [active])

  // The section you're reading inherits the live colour, so its own chrome,
  // meters and bloom shift with the state instead of sitting in fixed paint.
  useEffect(() => {
    const el = document.getElementById(active)
    if (!el) return
    el.dataset.live = 'true'
    // 'slow' because a section is a large subtree — invalidating its style at
    // 60 Hz is what makes a page like this expensive.
    const release = atmosphere.addSurface(el, 'slow')
    return () => {
      delete el.dataset.live
      release()
    }
  }, [active])

  return (
    <>
      <Atmosphere />

      {/* The panel lives outside .app: a transform on .app would otherwise
          become the containing block for the fixed panel and drag it along. */}
      <div className="app" data-panel={snapshot ? 'open' : undefined}>
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

          <StateBadge section={active} onOpen={openPanel} expanded={snapshot !== null} />

          <div className="topbar-row">
            <nav className="nav">
              {NAV.map((n) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className={n.id === active ? 'is-active' : undefined}
                >
                  {n.label}
                </a>
              ))}
            </nav>

            {/* Not a seventh nav anchor: the mirror is a full-screen mode, and
                letting it sit in the section list would imply you can scroll to it. */}
            <button
              type="button"
              className="mode-enter"
              onClick={() => navigate('mirror')}
            >
              <span className="mode-enter-mark">◈</span>
              Enter Mirror
            </button>

            {/* The open-window gesture needs a camera that is already running,
                and this project is not going to start one without being asked. */}
            <button
              type="button"
              className="mode-toggle"
              aria-pressed={gestures}
              onClick={() => setGestures((on) => !on)}
            >
              {gestures ? '● camera on' : 'Gesture control'}
            </button>
          </div>
          {stream.error && <p className="status-err">{stream.error}</p>}
          {gestures && gestureNote && (
            <p
              className={
                gestureStatus === 'error' ||
                gestureStatus === 'denied' ||
                gestureStatus === 'missing' ||
                gestureStatus === 'insecure'
                  ? 'status-err'
                  : 'status-note'
              }
            >
              {gestureNote}
            </p>
          )}
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

      <StatePanel snapshot={snapshot} liveWord={liveState.word} onClose={closePanel} />

      <GestureLayer enabled={gestures} onStatus={onGestureStatus} />
    </>
  )
}
