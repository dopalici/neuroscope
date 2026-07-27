import { MultiTrace } from './Charts'
import { InfoBox, Section } from './Section'
import { CHANNEL_COLORS } from '../types'
import type { FrameMessage } from '../types'

interface Props {
  eegBuffers: number[][]
  frame: FrameMessage | null
  channels: string[]
}

export function SignalQualitySection({ eegBuffers, frame, channels }: Props) {
  const colors = channels.map((c) => CHANNEL_COLORS[c] ?? '#9ab')
  const quality = frame?.quality

  return (
    <Section id="signal" number="01" title="Signal Quality & Raw EEG">
      <div className="split">
        <div className="viz">
          <div className="quality-row">
            {channels.map((ch) => {
              const q = quality?.[ch]
              return (
                <div key={ch} className={`q-pill q-${q?.label ?? 'red'}`}>
                  <span className="q-dot" />
                  <span className="q-ch">{ch}</span>
                  <span className="q-uv">{q ? `${q.uv} µV` : '—'}</span>
                </div>
              )
            })}
          </div>
          <MultiTrace
            series={eegBuffers}
            colors={colors}
            labels={channels}
            height={280}
          />
          <p className="viz-caption">Scrolling raw EEG · ~4 s · bandpass 1–44 Hz</p>
        </div>
        <InfoBox credibility="Contact-quality lights are a practical heuristic (signal std-dev), not a medical impedance check. Green ≈ seated electrode; red ≈ floating, flat, or railing. Raw traces are real voltages (or simulated ones) in microvolts.">
          <p>
            Muse 2 has four EEG pads: <strong>TP9 / TP10</strong> behind the ears and{' '}
            <strong>AF7 / AF8</strong> on the forehead. The scrolling lines are the live
            voltage at each pad. Spikes that look like cliffs are usually blinks or jaw
            movement — not “thoughts.”
          </p>
          <p>
            Fit the headband snug, hair clear of the sensors, and wait for green before
            trusting any other panel.
          </p>
        </InfoBox>
      </div>
    </Section>
  )
}
