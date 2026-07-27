import { InfoBox, Section } from './Section'
import { BAND_COLORS, BAND_ORDER } from '../types'
import type { FrameMessage } from '../types'

interface Props {
  frame: FrameMessage | null
}

export function BrainwaveBandsSection({ frame }: Props) {
  const avg = frame?.bands_avg
  const max = avg
    ? Math.max(...BAND_ORDER.map((b) => avg[b] ?? 0), 1e-6)
    : 1

  return (
    <Section id="bands" number="02" title="Brainwave Bands">
      <div className="split">
        <div className="viz">
          <div className="band-bars">
            {BAND_ORDER.map((band) => {
              const v = avg?.[band] ?? 0
              const pct = Math.min(100, (v / max) * 100)
              const [lo, hi] = bandRanges[band]
              return (
                <div key={band} className="band-row">
                  <div className="band-meta">
                    <span className="band-name" style={{ color: BAND_COLORS[band] }}>
                      {band}
                    </span>
                    <span className="band-hz">
                      {lo}–{hi} Hz
                    </span>
                  </div>
                  <div className="band-track">
                    <div
                      className="band-fill"
                      style={{
                        width: `${pct}%`,
                        background: BAND_COLORS[band],
                      }}
                    />
                  </div>
                  <span className="band-val mono">{v.toFixed(1)}</span>
                </div>
              )
            })}
          </div>
          <p className="viz-caption">Absolute band power (Welch) · averaged over TP9–TP10</p>
        </div>
        <InfoBox credibility="Band powers here are real spectral estimates from the last ~2 s of EEG. Absolute µV² values vary a lot between people and sessions — watch relative changes in yourself, not the number against a stranger.">
          <p>
            Your EEG is a mix of rhythms. We split it into classic bands with Welch’s
            method (averaged periodograms) so the bars stay steady enough to read live.
          </p>
          <ul>
            <li>
              <strong>Delta / theta</strong> — slow; sleep, drowsiness, deep calm (also
              motion artifacts).
            </li>
            <li>
              <strong>Alpha</strong> — eyes-closed rest often boosts this.
            </li>
            <li>
              <strong>Beta / gamma</strong> — faster; alert processing — and also jaw /
              forehead muscle noise on Muse.
            </li>
          </ul>
        </InfoBox>
      </div>
    </Section>
  )
}

const bandRanges: Record<(typeof BAND_ORDER)[number], [number, number]> = {
  delta: [1, 4],
  theta: [4, 8],
  alpha: [8, 13],
  beta: [13, 30],
  gamma: [30, 44],
}
