import { BAND_COLORS, BAND_ORDER } from '../../types'
import { hud } from './hudBus'

/** Five micro-bars in the dashboard's own band colours — soil through rust. */
export function BandStrip() {
  return (
    <div className="hud-bands">
      {BAND_ORDER.map((band) => (
        <div className="hud-band" key={band}>
          <div className="hud-band-track">
            <div
              className="hud-band-fill"
              ref={hud.bind(`band:${band}`)}
              style={{ background: BAND_COLORS[band] }}
            />
          </div>
          <span className="hud-band-name">{band.slice(0, 1)}</span>
        </div>
      ))}
    </div>
  )
}
