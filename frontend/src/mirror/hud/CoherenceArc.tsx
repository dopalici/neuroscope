import { hud } from './hudBus'

const RADIUS = 54
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/** Three quarters of a turn, opening downward like a gauge. */
export const ARC_SWEEP = 0.75
export const ARC_LENGTH = CIRCUMFERENCE * ARC_SWEEP

/**
 * The coherence gauge. The number moves at 60 Hz through `stroke-dashoffset`
 * (compositor work); the word and the digits are rewritten at 10 Hz.
 */
export function CoherenceArc() {
  return (
    <div className="hud-arc">
      <svg viewBox="0 0 140 140" aria-hidden="true">
        <g transform="rotate(135 70 70)">
          <circle
            className="hud-arc-track"
            cx="70"
            cy="70"
            r={RADIUS}
            strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
          />
          <circle
            ref={hud.bind('arc')}
            className="hud-arc-value"
            cx="70"
            cy="70"
            r={RADIUS}
            strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
            strokeDashoffset={ARC_LENGTH}
          />
        </g>
        {/* Ten hairline ticks — an instrument face, not a progress bar. */}
        {Array.from({ length: 11 }, (_, i) => {
          const angle = (135 + i * (270 / 10)) * (Math.PI / 180)
          const inner = i % 5 === 0 ? 42 : 46
          return (
            <line
              key={i}
              className="hud-arc-tick"
              x1={70 + Math.cos(angle) * inner}
              y1={70 + Math.sin(angle) * inner}
              x2={70 + Math.cos(angle) * 49}
              y2={70 + Math.sin(angle) * 49}
            />
          )
        })}
      </svg>
      <div className="hud-arc-face">
        <span className="hud-arc-word" ref={hud.bind('stateWord')}>
          —
        </span>
        <span className="hud-arc-value-text mono" ref={hud.bind('coherenceText')}>
          0.00
        </span>
        <span className="hud-arc-label" ref={hud.bind('arcLabel')}>
          coherence
        </span>
      </div>
    </div>
  )
}
