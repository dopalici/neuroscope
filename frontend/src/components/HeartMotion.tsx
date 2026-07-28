import { Sparkline } from './Charts'
import { InfoBox, Section } from './Section'
import type { FrameMessage } from '../types'

interface Props {
  frame: FrameMessage | null
  hrHistory: number[]
}

export function HeartMotionSection({ frame, hrHistory }: Props) {
  const hr = frame?.heart.hr ?? 0
  const hrv = frame?.heart.hrv ?? 0
  const beats = frame?.heart.n_beats ?? 0
  const motion = frame?.motion.motion ?? 0
  const posture = frame?.motion.posture ?? 0
  const still = frame?.motion.still ?? false

  return (
    <Section id="heart" number="05" title="Heart & Motion">
      <div className="split">
        <div className="viz">
          <div className="hm-grid">
            <div className="hm-card">
              <div className="hm-label">Heart rate</div>
              <div className="hm-value mono">
                {hr > 0 ? hr.toFixed(0) : '—'}
                <span className="hm-unit">bpm</span>
              </div>
              <Sparkline data={hrHistory} hueOffset={-10} height={44} />
              <div className="hm-sub">
                HRV (RMSSD) {hrv > 0 ? `${hrv.toFixed(0)} ms` : '—'} · {beats} peaks
              </div>
            </div>
            <div className="hm-card">
              <div className="hm-label">Head motion</div>
              <div className="hm-value mono">
                {motion.toFixed(0)}
                <span className="hm-unit">mG σ</span>
              </div>
              <div className="meter-bar tall">
                <div
                  className="meter-fill motion"
                  style={{ width: `${Math.min(100, motion / 1.2)}%` }}
                />
              </div>
              <div className="hm-sub">
                Tilt {posture.toFixed(0)}° ·{' '}
                <span className={still ? 'tag-still' : 'tag-move'}>
                  {still ? 'still' : 'moving'}
                </span>
              </div>
            </div>
          </div>
        </div>
        <InfoBox credibility="Heart rate comes from Muse’s PPG (optical) sensor via peak detection — decent for resting trends, not a medical ECG. Motion/posture are IMU summaries. In simulation mode both are synthesized; with real hardware you need muselsl --ppg --acc --gyro.">
          <p>
            Muse 2 also streams a forehead <strong>PPG</strong> (blood-flow light sensor)
            and an <strong>IMU</strong> (accelerometer + gyro).
          </p>
          <p>
            We estimate bpm and short-window HRV (RMSSD) from PPG peaks, and how still /
            upright your head is from the IMU — useful context when EEG looks wild because
            you just moved.
          </p>
        </InfoBox>
      </div>
    </Section>
  )
}
