import { useMuseStream } from './hooks/useMuseStream'
import { SignalQualitySection } from './components/SignalQuality'
import { BrainwaveBandsSection } from './components/BrainwaveBands'
import { FocusRelaxSection } from './components/FocusRelax'
import { BodySignalsSection } from './components/BodySignals'
import { HeartMotionSection } from './components/HeartMotion'
import { NeurofeedbackSection } from './components/Neurofeedback'
import './App.css'

const NAV = [
  { id: 'signal', label: 'Signal' },
  { id: 'bands', label: 'Bands' },
  { id: 'focus', label: 'Focus' },
  { id: 'artifacts', label: 'Body' },
  { id: 'heart', label: 'Heart' },
  { id: 'nf', label: 'Feedback' },
]

export default function App() {
  const stream = useMuseStream()
  const channels = stream.meta?.channels ?? ['TP9', 'AF7', 'AF8', 'TP10']

  return (
    <div className="app">
      <div className="bg-grid" aria-hidden />
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">∿</span>
          <div>
            <h1>NeuroScope</h1>
            <p className="tagline">Muse 2 EEG dashboard</p>
          </div>
        </div>
        <div className="status">
          <span className={`dot ${stream.connected ? 'on' : 'off'}`} />
          <span className="status-text">
            {stream.connected ? 'live' : 'connecting…'}
            {stream.meta && (
              <>
                {' · '}
                {stream.meta.source}
                {stream.meta.simulated && <span className="sim-badge">SIM</span>}
              </>
            )}
          </span>
          {stream.error && <span className="status-err">{stream.error}</span>}
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`}>
              {n.label}
            </a>
          ))}
        </nav>
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
        <NeurofeedbackSection
          frame={stream.frame}
          alphaHistory={stream.alphaHistory}
        />
      </main>

      <footer className="footer">
        <p>
          Educational dashboard · not a medical device ·{' '}
          {stream.meta?.simulated
            ? 'simulation mode — no hardware required'
            : 'real Muse via muselsl → LSL'}
        </p>
      </footer>
    </div>
  )
}
