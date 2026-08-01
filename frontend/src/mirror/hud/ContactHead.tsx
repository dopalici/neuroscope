import { SCREEN_SIDE } from '../../state/mirror/mapping'
import { hud } from './hudBus'

/**
 * Four contact quads around a head glyph.
 *
 * The glyph is drawn **as you appear in the mirror**, so the sides come from
 * `SCREEN_SIDE` rather than being typed out here. Laying it out anatomically
 * would light the quad on the opposite side from the electrode you can see in
 * the picture, which is exactly the confusion that constant exists to prevent.
 */
const PADS = [
  { ch: SCREEN_SIDE.left, x: 26, y: 26 },
  { ch: SCREEN_SIDE.right, x: 62, y: 26 },
  { ch: 'TP10', x: 18, y: 60 },
  { ch: 'TP9', x: 70, y: 60 },
] as const

export function ContactHead() {
  return (
    <div className="hud-contact">
      <svg viewBox="0 0 88 92" aria-label="electrode contact quality">
        <ellipse className="hud-head" cx="44" cy="48" rx="30" ry="34" />
        <path className="hud-head-nose" d="M44 14 l5 8 h-10 z" />
        {PADS.map((pad) => (
          <g key={pad.ch}>
            <rect
              ref={hud.bind(`pad:${pad.ch}`)}
              className="hud-pad"
              x={pad.x - 7}
              y={pad.y - 5}
              width="14"
              height="10"
              rx="2"
            />
            <text className="hud-pad-label" x={pad.x} y={pad.y + 3.2}>
              {pad.ch}
            </text>
          </g>
        ))}
      </svg>
      <span className="hud-contact-note">mirrored · AF7 is your left</span>
    </div>
  )
}
