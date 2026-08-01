import { BandStrip } from './BandStrip'
import { CoherenceArc } from './CoherenceArc'
import { ContactHead } from './ContactHead'
import { EventTicker } from './EventTicker'
import type { TickerEntry } from './EventTicker'
import { Legend } from './Legend'
import { hud } from './hudBus'

interface Props {
  entries: readonly TickerEntry[]
  sham: boolean
  uncalibrated: boolean
  hands: boolean
  dev: boolean
}

/**
 * Instrument density in earth tones.
 *
 * Deliberately not a neon HUD: hairline ochre rules, mono readouts, brackets
 * and quads, on the same soil / moss / ochre / clay / rust palette the
 * dashboard uses. `--hud-accent` is a single custom property, so a cyan preset
 * is one line away for anyone who wants one — but Terra is what ships.
 */
export function Hud({ entries, sham, uncalibrated, hands, dev }: Props) {
  return (
    <div className="hud" ref={hud.bind('root')}>
      {/* Face-locked overlay. Parallaxes with head tilt so it reads as attached
          to the head rather than painted on the glass. */}
      <svg className="hud-reticles" viewBox="0 0 1000 1000" preserveAspectRatio="none">
        <g ref={hud.bind('faceGroup')} className="hud-face" opacity="0">
          <path className="hud-bracket" d="M0 40 V0 H40" />
          <path className="hud-bracket" d="M160 0 H200 V40" />
          <path className="hud-bracket" d="M200 200 V240 H160" />
          <path className="hud-bracket" d="M40 240 H0 V200" />
          <line className="hud-crosshair" x1="100" y1="112" x2="100" y2="128" />
          <line className="hud-crosshair" x1="92" y1="120" x2="108" y2="120" />
        </g>
        <g ref={hud.bind('handGroup')} className="hud-hands" opacity="0">
          <circle ref={hud.bind('hand0')} className="hud-hand" r="9" cx="-50" cy="-50" />
          <circle ref={hud.bind('hand1')} className="hud-hand" r="9" cx="-50" cy="-50" />
          <circle ref={hud.bind('dwell')} className="hud-dwell" r="18" cx="-50" cy="-50" />
        </g>
      </svg>

      <div className="hud-corner hud-tl">
        <div className="hud-session">
          <span className="hud-rec" ref={hud.bind('rec')} />
          <span className="hud-clock mono" ref={hud.bind('clock')}>
            00:00
          </span>
        </div>
        <div className="hud-chips">
          <span className="hud-chip hud-chip-alert" ref={hud.bind('vetoChip')}>
            SIGNAL INTERRUPTED
          </span>
          {uncalibrated && (
            <span className="hud-chip hud-chip-warn">UNCALIBRATED · session baseline</span>
          )}
          {sham && <span className="hud-chip hud-chip-warn">SHAM</span>}
          {hands && <span className="hud-chip">HANDS</span>}
        </div>
      </div>

      <div className="hud-corner hud-tr">
        <CoherenceArc />
      </div>

      <div className="hud-corner hud-bl">
        <ContactHead />
        <BandStrip />
      </div>

      <div className="hud-corner hud-br">
        <div className="hud-heart">
          <span className="hud-pip" ref={hud.bind('pip')} />
          <span className="hud-heart-value mono" ref={hud.bind('hr')}>
            --
          </span>
          <span className="hud-unit">bpm</span>
          <span className="hud-heart-hrv mono" ref={hud.bind('hrv')} />
        </div>
        <EventTicker entries={entries} />
        {dev && (
          <div className="hud-dev mono" ref={hud.bind('dev')}>
            —
          </div>
        )}
      </div>

      <div className="hud-bottom">
        <Legend />
        <p className="hud-promise">
          Camera stays in this tab. Video and hand tracking never reach the Python
          backend; recordings are written to your machine only.
        </p>
      </div>
    </div>
  )
}
