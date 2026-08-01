import { hud } from './hudBus'

/**
 * The live effect legend: what is currently being done to the picture, and by
 * which number.
 *
 *   WANDER ← θ/β 3.4 (+1.8σ) · 2.0 s window
 *
 * The window length is on the line deliberately. Band powers come out of a 2 s
 * Welch estimate, so the slow tier is always a second or two behind the person
 * in the frame. Printing that makes the latency a stated property of the
 * instrument rather than a defect you notice and distrust.
 */
export function Legend() {
  return (
    <div className="hud-legend">
      <span className="hud-legend-effect" ref={hud.bind('legendEffect')}>
        —
      </span>
      <span className="hud-legend-arrow">←</span>
      <span className="hud-legend-driver mono" ref={hud.bind('legendDriver')}>
        waiting for signal
      </span>
      <span className="hud-legend-window mono" ref={hud.bind('legendWindow')} />
    </div>
  )
}
