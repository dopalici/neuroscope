import { useMemo } from 'react'
import { Sparkline } from './Charts'
import { InfoBox, Section } from './Section'
import { feedbackScore } from '../state/brainState'
import type { FrameMessage } from '../types'

interface Props {
  frame: FrameMessage | null
  alphaHistory: number[]
}

/** Simple alpha-up neurofeedback: grow a “bloom” when relative calm/alpha rises. */
export function NeurofeedbackSection({ frame, alphaHistory }: Props) {
  const calm = frame?.indices.calm ?? 0
  const alpha = frame?.indices.alpha_abs ?? 0
  const score = feedbackScore(frame)

  const tip = useMemo(() => {
    if (score < 0.35) return 'Try softening the gaze or closing your eyes for a few seconds.'
    if (score < 0.65) return 'Nice — hold that easier breath; watch the bloom steady.'
    return 'Strong alpha/calm relative signal. Keep posture soft; avoid jaw tension.'
  }, [score])

  return (
    <Section id="nf" number="06" title="Neurofeedback Demo">
      <div className="split">
        <div className="viz nf-viz">
          <div className="nf-stage">
            {/* Size and glow are driven by the score; colour is inherited from
                the live state, so the bloom and the word always agree. */}
            <div
              className="nf-bloom"
              style={{
                width: 44 + score * 150,
                height: 44 + score * 150,
                opacity: 0.5 + score * 0.45,
              }}
            />
            <div className="nf-readout">
              <div>
                Calm <strong className="mono">{(calm * 100).toFixed(0)}%</strong>
              </div>
              <div>
                α power <strong className="mono">{alpha.toFixed(1)}</strong>
              </div>
            </div>
          </div>
          <Sparkline data={alphaHistory} hueOffset={12} height={52} />
          <p className="viz-caption">{tip}</p>
        </div>
        <InfoBox credibility="This is a teaching toy, not therapy. The bloom tracks relative alpha / calm index from the same heuristics as section 03. Real clinical neurofeedback uses controlled protocols, baselines, and often better electrode coverage.">
          <p>
            Neurofeedback means: show your brain a live signal and let you practice
            shifting it. Here the circle grows when the calm/alpha index rises.
          </p>
          <p>
            In simulation the alpha level slowly drifts so you can see the loop work
            without a headband. With a real Muse, eyes-closed rest usually helps —
            clenching your jaw will fight you.
          </p>
        </InfoBox>
      </div>
    </Section>
  )
}
