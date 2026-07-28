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

/**
 * Colour is a slow, large-area effect, so it does not need 60 Hz. Background and
 * badge repaint at ~30 Hz; the active section carries a whole subtree of nodes
 * (including canvases), so its style is invalidated at ~8 Hz instead.
 */
const FAST_INTERVAL_MS = 33
const SLOW_INTERVAL_MS = 125

export interface AtmosphereLive {
  h: number
  s: number
  l: number
  intensity: number
}

export interface StateColors {
  washA: string
  washB: string
  glow: string
  edge: string
}

/** Single source of truth for state → colour, shared with the frozen info panel. */
export function stateColors(h: number, s: number, l: number): StateColors {
  return {
    washA: hsl(h, s, l),
    washB: hsl(h + 16, s * 0.8, l * 0.62),
    glow: hsl(h + 6, Math.min(72, s + 12), Math.min(74, l + 16)),
    // The word must stay readable even for dim, low-intensity states.
    edge: hsl(h, s * 0.7, Math.min(84, Math.max(62, l + 22))),
  }
}

class AtmosphereEngine {
  /** Smoothed values, safe to read from canvas draw code without touching the DOM. */
  readonly live: AtmosphereLive = { h: NEUTRAL.h, s: NEUTRAL.s, l: NEUTRAL.l, intensity: 0 }

  private target: BrainState = NEUTRAL
  private section: SectionId = 'signal'
  private frame: FrameMessage | null = null
  private holdUntil = 0

  private fastSurfaces = new Set<HTMLElement>()
  private slowSurfaces = new Set<HTMLElement>()
  private listeners = new Set<(state: BrainState) => void>()

  private raf = 0
  private lastTime = 0
  private fastDue = 0
  private slowDue = 0
  private consumers = 0
  private running = false
  private settled = false
  private boundToDocument = false

  get state(): BrainState {
    return this.target
  }

  /**
   * Elements that receive the live colour custom properties.
   * `rate: 'slow'` is for large subtrees, where style invalidation is expensive.
   */
  addSurface(el: HTMLElement, rate: 'fast' | 'slow' = 'fast'): () => void {
    const set = rate === 'fast' ? this.fastSurfaces : this.slowSurfaces
    set.add(el)
    this.paint(el)
    return () => {
      set.delete(el)
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
      this.bindDocument()
      this.resume()
    }
    return () => {
      this.consumers -= 1
      if (this.consumers === 0) this.stop()
    }
  }

  private bindDocument(): void {
    if (this.boundToDocument) return
    this.boundToDocument = true
    // No point interpolating colour for a tab nobody is looking at.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop()
      else if (this.consumers > 0) this.resume()
    })
  }

  private resume(): void {
    if (this.running || this.consumers === 0 || document.hidden) return
    this.running = true
    this.lastTime = performance.now()
    this.fastDue = 0
    this.slowDue = 0
    this.raf = requestAnimationFrame(this.tick)
  }

  private stop(): void {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  private apply(next: BrainState): void {
    const now = performance.now()
    // A momentary event (blink, clench) keeps the badge until its hold expires,
    // unless another event outranks it.
    if (now < this.holdUntil && next.key !== this.target.key && !next.hold) return
    if (next.hold) this.holdUntil = now + next.hold

    const changed = next.key !== this.target.key
    this.target = next
    if (this.settled) {
      // There is somewhere new to travel to, so wake the loop back up.
      this.settled = false
      this.resume()
    }
    if (changed) {
      for (const listener of this.listeners) listener(next)
    }
  }

  private tick = (time: number): void => {
    const elapsedMs = Math.max(0, time - this.lastTime)
    const dt = Math.min(0.12, elapsedMs / 1000)
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
    } else {
      // Land exactly on target, paint once, then idle until something changes.
      live.h = target.h
      live.s = target.s
      live.l = target.l
      live.intensity = target.intensity
      this.settled = true
      this.paintAll()
      this.stop()
      return
    }

    this.fastDue -= elapsedMs
    if (this.fastDue <= 0) {
      this.fastDue = FAST_INTERVAL_MS
      for (const el of this.fastSurfaces) this.paint(el)
    }

    this.slowDue -= elapsedMs
    if (this.slowDue <= 0) {
      this.slowDue = SLOW_INTERVAL_MS
      for (const el of this.slowSurfaces) this.paint(el)
    }

    this.raf = requestAnimationFrame(this.tick)
  }

  private paintAll(): void {
    for (const el of this.fastSurfaces) this.paint(el)
    for (const el of this.slowSurfaces) this.paint(el)
  }

  private paint(el: HTMLElement): void {
    const { h, s, l, intensity } = this.live
    const colors = stateColors(h, s, l)
    const style = el.style
    style.setProperty('--wash-a', colors.washA)
    style.setProperty('--wash-b', colors.washB)
    style.setProperty('--glow', colors.glow)
    style.setProperty('--edge', colors.edge)
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
