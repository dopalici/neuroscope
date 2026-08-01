import { useCallback, useEffect, useRef } from 'react'
import { navigate } from '../routes'
import { aperture } from '../state/mirror/aperture'
import { useCamera } from './camera/useCamera'
import { useHands } from './hands/useHands'
import type { GestureEvent } from './hands/gestures'
import './Mirror.css'

interface Props {
  enabled: boolean
  onStatus: (status: string, message: string | null) => void
}

/**
 * Gesture control while you are still on the dashboard.
 *
 * This exists to solve the chicken-and-egg in the open-window gesture: pulling
 * the mirror open needs the camera already running, and starting a camera
 * without being asked is not something this project is going to do. So it is an
 * explicit toggle, with a persistent indicator, and only the hand worker runs —
 * no GL chain, no video on screen. The dashboard stays cheap.
 */
export function GestureLayer({ enabled, onStatus }: Props) {
  const camera = useCamera(enabled)
  const shuttersRef = useRef<HTMLDivElement>(null)

  const onEvent = useCallback((event: GestureEvent) => {
    if (event.type !== 'window-open') return
    aperture.commit()
    navigate('mirror')
  }, [])

  const hands = useHands({ video: camera.video, enabled, onEvent })

  useEffect(() => {
    const status = camera.status !== 'ready' ? camera.status : hands.status
    onStatus(status, camera.message ?? hands.message)
  }, [camera.status, camera.message, hands.status, hands.message, onStatus])

  // The aperture tracks the hands continuously rather than waiting for a
  // threshold, so an incomplete pull visibly fails instead of doing nothing.
  useEffect(() => {
    if (!enabled) {
      aperture.reset()
      return
    }
    let raf = 0
    let last = performance.now()
    const tick = (time: number) => {
      const dt = Math.min(0.1, (time - last) / 1000)
      last = time
      aperture.progress = hands.state.window.active ? hands.state.window.progress : 0
      const eased = aperture.ease(dt)
      const el = shuttersRef.current
      if (el) {
        el.style.setProperty('--aperture', Math.max(0, eased).toFixed(4))
        el.style.setProperty('--aperture-shut', Math.max(0, -eased).toFixed(4))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [enabled, hands.state])

  if (!enabled) return null

  return (
    <div className="aperture" ref={shuttersRef} aria-hidden="true">
      <div className="aperture-half aperture-left" />
      <div className="aperture-half aperture-right" />
      <div className="aperture-seam" />
      <p className="aperture-hint">
        pinch both hands · pull apart to open the mirror
      </p>
    </div>
  )
}
