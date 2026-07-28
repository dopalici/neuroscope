import { useAtmosphereSurface } from '../hooks/useAtmosphere'

/**
 * The living background. Each wash is a flat colour pulled through a static
 * mask, so a colour change repaints a solid fill instead of re-rasterising a
 * gradient — and the slow drift is pure transform, handled on the compositor.
 */
export function Atmosphere() {
  const ref = useAtmosphereSurface<HTMLDivElement>()

  return (
    <div className="atmos" ref={ref} aria-hidden>
      <div className="atmos-base" />
      <div className="atmos-wash atmos-wash-a" />
      <div className="atmos-wash atmos-wash-b" />
      <div className="atmos-glow" />
      <div className="atmos-grain" />
      <div className="atmos-vignette" />
    </div>
  )
}
