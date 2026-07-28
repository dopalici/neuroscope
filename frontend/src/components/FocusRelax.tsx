import { Sparkline } from './Charts'
import { InfoBox, Section } from './Section'
import type { FrameMessage } from '../types'

interface Props {
  frame: FrameMessage | null
  focusHistory: number[]
  calmHistory: number[]
}

export function FocusRelaxSection({ frame, focusHistory, calmHistory }: Props) {
  const focus = frame?.indices.focus ?? 0
  const calm = frame?.indices.calm ?? 0
  const faa = frame?.indices.faa ?? 0

  return (
    <Section id="focus" number="03" title="Focus & Relaxation">
      <div className="split">
        <div className="viz">
          <div className="meter-grid">
            <div className="meter">
              <div className="meter-top">
                <span>Focus index</span>
                <strong className="mono">{focus.toFixed(2)}</strong>
              </div>
              <div className="meter-bar">
                <div
                  className="meter-fill focus"
                  style={{ width: `${clamp01(focus / 3) * 100}%` }}
                />
              </div>
              <Sparkline data={focusHistory} hueOffset={-14} height={48} />
              <p className="meter-hint">β / α · higher ≈ more alert engagement</p>
            </div>
            <div className="meter">
              <div className="meter-top">
                <span>Calm index</span>
                <strong className="mono">{(calm * 100).toFixed(0)}%</strong>
              </div>
              <div className="meter-bar">
                <div
                  className="meter-fill calm"
                  style={{ width: `${clamp01(calm) * 100}%` }}
                />
              </div>
              <Sparkline data={calmHistory} hueOffset={26} height={48} />
              <p className="meter-hint">Relative α · eyes-closed rest often rises</p>
            </div>
          </div>
          <div className="faa-row">
            <span>Frontal α asymmetry (FAA)</span>
            <strong className="mono" style={{ color: faa >= 0 ? '#8a9260' : '#c2703f' }}>
              {faa >= 0 ? '+' : ''}
              {faa.toFixed(3)}
            </strong>
          </div>
        </div>
        <InfoBox credibility="These are popular heuristics, not clinical scores. Useful for watching your own trends over minutes — not for comparing people, diagnosing ADHD, or proving you meditated “correctly.” FAA on a 4-electrode headband is especially noisy.">
          <p>
            <strong>Focus</strong> is beta power divided by alpha. Roughly: more fast
            relative to idle-rest rhythms.
          </p>
          <p>
            <strong>Calm</strong> is how much of the spectrum sits in alpha. Closing your
            eyes often lifts it.
          </p>
          <p>
            <strong>FAA</strong> compares left vs right forehead alpha. Research links it
            to approach/withdrawal affect — on Muse, treat it as a curiosity meter.
          </p>
        </InfoBox>
      </div>
    </Section>
  )
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x))
}
