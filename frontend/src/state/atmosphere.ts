/**
 * Atmosphere engine — the only thing that animates every frame.
 *
 * Colour is interpolated in a single requestAnimationFrame loop and written
 * straight to CSS custom properties on a handful of registered elements. React
 * is told only when the *word* changes, which is rare, so scrolling and the
 * 10 Hz data stream never fight each other for renders.
 */
import { NEUTRAL, deriveState } from './brainState'
import type { BrainState, SectionId } from './brainState'
import type { FrameMessage } from '../types'

/** Seconds to cover ~63% of a colour change. Slow on purpose — brains drift. */
const TAU = 0.55
const EPSILON = 0.02
const PAINTED_PROPS = ['--wash-a', '--wash-b', '--glow', '--edge', '--si'] as const

export interface AtmosphereLive {
  h: number
  s: number
  l: number
  intensity: number
}

class AtmosphereEngine {
  /** Smoothed values, safe to read from canvas draw code without touching the DOM. */
  readonly live: AtmosphereLive = { h: NEUTRAL.h, s: NEUTRAL.s, l: NEUTRAL.l, intensity: 0 }

  private target: BrainState = NEUTRAL
  private section: SectionId = 'signal'
  private frame: FrameMessage | null = null
  private holdUntil = 0

  private surfaces = new Set<HTMLElement>()
  private listeners = new Set<(state: BrainState) => void>()

  private raf = 0
  private lastTime = 0
  private consumers = 0
  private settled = false

  get state(): BrainState {
    return this.target
  }

  /** Elements that receive the live colour custom properties. Keep this small. */
  addSurface(el: HTMLElement): () => void {
    this.surfaces.add(el)
    this.paint(el)
    return () => {
      this.surfaces.delete(el)
      for (const prop of PAINTED_PROPS) el.style.removeProperty(prop)
    }
  }

  subscribe(fn: (state: BrainState) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  setSection(section: SectionId): void {
    if (section === this.section) return
    this.section = section
    // Scrolling always wins over a held artifact word.
    this.holdUntil = 0
    this.apply(deriveState(section, this.frame))
  }

  setFrame(frame: FrameMessage | null): void {
    this.frame = frame
    this.apply(deriveState(this.section, frame))
  }

  start(): () => void {
    this.consumers += 1
    if (this.consumers === 1) {
      this.lastTime = performance.now()
      this.raf = requestAnimationFrame(this.tick)
    }
    return () => {
      this.consumers -= 1
      if (this.consumers === 0) cancelAnimationFrame(this.raf)
    }
  }

  private apply(next: BrainState): void {
    const now = performance.now()
    // A momentary event (blink, clench) keeps the badge until its hold expires,
    // unless another event outranks it.
    if (now < this.holdUntil && next.key !== this.target.key && !next.hold) return
    if (next.hold) this.holdUntil = now + next.hold

    const changed = next.key !== this.target.key
    this.target = next
    this.settled = false
    if (changed) {
      for (const listener of this.listeners) listener(next)
    }
  }

  private tick = (time: number): void => {
    const dt = Math.min(0.12, Math.max(0, (time - this.lastTime) / 1000))
    this.lastTime = time

    const { live, target } = this
    // Frame-rate independent exponential smoothing — identical motion at 60 or 120 Hz.
    const k = 1 - Math.exp(-dt / TAU)
    const moving =
      Math.abs(hueDelta(live.h, target.h)) > EPSILON ||
      Math.abs(target.s - live.s) > EPSILON ||
      Math.abs(target.l - live.l) > EPSILON ||
      Math.abs(target.intensity - live.intensity) > 0.002

    if (moving) {
      live.h = wrapHue(live.h + hueDelta(live.h, target.h) * k)
      live.s += (target.s - live.s) * k
      live.l += (target.l - live.l) * k
      live.intensity += (target.intensity - live.intensity) * k
      this.settled = false
    } else if (!this.settled) {
      // Land exactly on target once, then stop writing styles entirely.
      live.h = target.h
      live.s = target.s
      live.l = target.l
      live.intensity = target.intensity
      this.settled = true
    }

    if (!this.settled || moving) {
      for (const el of this.surfaces) this.paint(el)
    }

    this.raf = requestAnimationFrame(this.tick)
  }

  private paint(el: HTMLElement): void {
    const { h, s, l, intensity } = this.live
    const style = el.style
    style.setProperty('--wash-a', hsl(h, s, l))
    style.setProperty('--wash-b', hsl(h + 16, s * 0.8, l * 0.62))
    style.setProperty('--glow', hsl(h + 6, Math.min(72, s + 12), Math.min(74, l + 16)))
    // The word must stay readable even for dim, low-intensity states.
    style.setProperty('--edge', hsl(h, s * 0.7, Math.min(84, Math.max(62, l + 22))))
    style.setProperty('--si', intensity.toFixed(3))
  }
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${wrapHue(h).toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`
}

function wrapHue(h: number): number {
  return ((h % 360) + 360) % 360
}

/** Shortest way round the colour wheel, so hues never sweep the long way. */
function hueDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

export const atmosphere = new AtmosphereEngine()
