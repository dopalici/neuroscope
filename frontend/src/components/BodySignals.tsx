import { InfoBox, Section } from './Section'
import type { FrameMessage } from '../types'

interface Props {
  frame: FrameMessage | null
}

export function BodySignalsSection({ frame }: Props) {
  const a = frame?.artifacts
  const blinkPct = a
    ? Math.min(100, (a.blink_mag / (a.blink_threshold * 1.8)) * 100)
    : 0
  const jawPct = a
    ? Math.min(100, (a.jaw_mag / (a.jaw_threshold * 1.8)) * 100)
    : 0

  return (
    <Section id="artifacts" number="04" title="Body Signals from Noise">
      <div className="split">
        <div className="viz">
          <div className="artifact-grid">
            <div className={`artifact-card ${a?.blink ? 'active' : ''}`}>
              <div className="artifact-label">Eye blink</div>
              <div className="artifact-mag mono">{a ? a.blink_mag.toFixed(0) : '—'} µV</div>
              <div className="meter-bar">
                <div
                  className="meter-fill blink"
                  style={{ width: `${blinkPct}%` }}
                />
              </div>
              <div className="artifact-stats">
                <span>Threshold {a?.blink_threshold ?? 90} µV</span>
                <span>
                  {a?.blink_total ?? 0} total · {a?.blink_rate ?? 0}/min
                </span>
              </div>
            </div>
            <div className={`artifact-card ${a?.jaw ? 'active' : ''}`}>
              <div className="artifact-label">Jaw clench (EMG)</div>
              <div className="artifact-mag mono">{a ? a.jaw_mag.toFixed(0) : '—'} µV</div>
              <div className="meter-bar">
                <div className="meter-fill jaw" style={{ width: `${jawPct}%` }} />
              </div>
              <div className="artifact-stats">
                <span>Threshold {a?.jaw_threshold ?? 28} µV</span>
                <span>
                  {a?.jaw_total ?? 0} total · {a?.jaw_rate ?? 0}/min
                </span>
              </div>
            </div>
          </div>
          <p className="viz-caption">
            Try blinking deliberately or gently clenching your jaw — the detectors should trip.
          </p>
        </div>
        <InfoBox credibility="These detectors are intentionally simple threshold rules on filtered frontal (blink) and temporal (jaw) channels. They are transparent and tunable in config.py — not ML classifiers. False positives from motion are expected.">
          <p>
            A lot of what looks like “brainwaves” on a consumer headband is actually your{' '}
            <em>body</em>. Forehead pads sit over the eyes; ear pads sit over jaw muscles.
          </p>
          <p>
            We turn that “noise” into a feature: blinks = big slow swings on AF7/AF8; jaw
            clenches = high-frequency EMG bursts on TP9/TP10.
          </p>
        </InfoBox>
      </div>
    </Section>
  )
}
