/**
 * The parameter graph.
 *
 * The thing worth stealing from TouchDesigner is not the gestures, it is this:
 * every number the shaders read is a registered node with a range, a smoothing
 * constant, and a source. Once that exists, four features stop being features —
 * the control panel is generated from the registry, a preset is the serialised
 * registry, shader uniforms are written straight from `values` with no mapping
 * table, and learn mode is a field called `armed`.
 *
 * `follow` carries separate attack and release because that is the one naive
 * ports always drop, and it is the difference between a clench that snaps and
 * one that mushes.
 */
import { DRIVE_KEYS } from './mapping'
import type { DriveKey, Drives } from './mapping'

export type Curve = 'linear' | 'ease-in' | 'ease-out' | 's-curve' | 'gate'

export const CURVES: readonly Curve[] = ['linear', 'ease-in', 'ease-out', 's-curve', 'gate']

export type GestureAxis = 'pinch' | 'x' | 'y' | 'rotate' | 'spread'

export const GESTURE_AXES: readonly GestureAxis[] = ['pinch', 'x', 'y', 'rotate', 'spread']

export type GestureValues = Record<GestureAxis, number>

export type ParamSource =
  | { kind: 'constant' }
  | { kind: 'signal'; drive: DriveKey; gain: number; bias: number; curve: Curve }
  | { kind: 'gesture'; axis: GestureAxis }
  | { kind: 'lfo'; hz: number; shape: 'sine' | 'tri' | 'noise' }
  | { kind: 'follow'; drive: DriveKey; attack: number; release: number }

export type SourceKind = ParamSource['kind']

export const SOURCE_KINDS: readonly SourceKind[] = [
  'constant',
  'signal',
  'gesture',
  'lfo',
  'follow',
]

export interface Param {
  id: string
  label: string
  group: string
  range: [number, number]
  /** Live, smoothed output. This is what the shaders read. */
  value: number
  /** Seconds to cover ~63% of a change. */
  tau: number
  source: ParamSource
  /** Hand value: the constant, and the fallback when a source is detached. */
  manual: number
}

type ParamSpec = Omit<Param, 'value'>

/**
 * Every slow drive sits at 0.5 when the person is at their own baseline, so the
 * biases below are roughly −gain/2: at baseline the picture is close to clean,
 * and the effects grow with the *deviation*. A clean image is the reward, which
 * only means anything if it is actually reachable.
 */
const SPECS: readonly ParamSpec[] = [
  /* —— Break-up: photographic, not arcade —— */
  // Hard block / tear / scanline effects stay registered so the panel can dial
  // them in, but the default mapping keeps them near zero.
  konst('blockAmount', 'Block glitch', 'Break-up', [0, 1], 0.25, 0),
  konst('blockScale', 'Block rows', 'Break-up', [4, 160], 1, 46),
  sig('chroma', 'Chromatic aberration', 'Break-up', [0, 1], 0.5, 'drift', 0.35, -0.12, 'linear'),
  konst('tear', 'Rolling tear', 'Break-up', [0, 1], 0.3, 0),
  konst('scanlines', 'Scanlines', 'Break-up', [0, 1], 0.5, 0),
  // Grain is the exception: a little is film, not failure, so it keeps a floor.
  sig('grain', 'Grain', 'Break-up', [0, 1], 0.6, 'drift', 0.4, 0.04, 'linear'),

  /* —— Wander: the low-frequency failure —— */
  sig('warpAmount', 'Flow warp', 'Wander', [0, 1], 1.4, 'wander', 0.7, -0.32, 's-curve'),
  konst('warpScale', 'Warp scale', 'Wander', [0.5, 8], 1, 1.6),
  konst('warpSpeed', 'Warp speed', 'Wander', [0, 0.6], 1, 0.045),

  /* —— Ease: alpha-rich softness —— */
  sig('trail', 'Feedback trail', 'Ease', [0, 0.95], 1.4, 'ease', 0.55, -0.18, 'linear'),
  konst('feedbackDrift', 'Trail drift', 'Ease', [0, 1], 1, 0.3),
  konst('feedbackHue', 'Trail warmth', 'Ease', [0, 1], 1, 0.45),
  sig('bloom', 'Bloom', 'Ease', [0, 1.4], 1.2, 'ease', 0.55, -0.22, 'ease-in'),
  konst('bloomThreshold', 'Bloom threshold', 'Ease', [0, 1], 1, 0.68),
  // Breath used to zoom the whole frame; keep a tiny residual for the panel,
  // and let vignette carry the heart instead.
  sig('breathe', 'Breathing scale', 'Ease', [0, 1], 1.5, 'ease', 0.12, -0.05, 'linear'),

  /* —— Pulse: the heart —— */
  sig('vignette', 'Vignette', 'Pulse', [0, 1], 0.25, 'pulse', 0.55, 0.28, 'linear'),
  follow('pulseScale', 'Beat scale', 'Pulse', [0, 1], 0.05, 'pulse', 0.005, 0.04),

  /* —— Lean: off by default, and for good reason —— */
  sig('lean', 'Warm / cool split', 'Lean', [-1, 1], 3, 'lean', 0, 0.5, 'linear'),

  /* —— Instant tier —— */
  follow('shear', 'Clench shear', 'Instant', [0, 1], 0.05, 'clench', 0.008, 0.08),
  // Shockwave reads as damage; leave the node but don't drive it.
  konst('shock', 'Clench shockwave', 'Instant', [0, 1], 0.04, 0),
  sig('shimmer', 'Edge shimmer', 'Instant', [0, 1], 0.1, 'shimmer', 0.55, -0.2, 'linear'),
  konst('shutter', 'Blink shutter', 'Instant', [0, 1], 0.01, 1),

  /* —— Credibility —— */
  sig('fog', 'Signal fog', 'Credibility', [0, 1], 0.35, 'fog', 1, 0, 'linear'),

  /* —— Grade —— */
  konst('tint', 'State tint', 'Grade', [0, 1], 1, 0.22),
  konst('exposure', 'Exposure', 'Grade', [-1, 1], 0.5, 0.02),
  konst('contrast', 'Contrast', 'Grade', [-0.5, 0.8], 0.5, 0.06),
  konst('hueShift', 'Hue turn', 'Grade', [-3.14159, 3.14159], 0.4, 0),
  konst('zoom', 'Zoom', 'Grade', [-0.3, 0.6], 0.5, 0),
]

export interface Preset {
  version: 1
  name: string
  params: Record<string, { manual: number; source: ParamSource }>
}

export class ParamGraph {
  readonly params: Param[]
  readonly byId = new Map<string, Param>()
  /** Stable identity, mutated in place: this is handed straight to the shaders. */
  readonly values: Record<string, number> = {}

  /** Learn mode: the param waiting for a gesture to claim it. */
  armed: string | null = null

  private listeners = new Set<() => void>()
  private noise = new Map<string, { bucket: number; value: number }>()

  constructor() {
    this.params = SPECS.map((spec) => ({ ...spec, source: { ...spec.source }, value: spec.manual }))
    for (const param of this.params) {
      this.byId.set(param.id, param)
      this.values[param.id] = param.value
    }
  }

  get groups(): string[] {
    const seen: string[] = []
    for (const p of this.params) if (!seen.includes(p.group)) seen.push(p.group)
    return seen
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  tick(dt: number, time: number, drives: Drives, gestures: GestureValues): void {
    for (const param of this.params) {
      const [lo, hi] = param.range
      const source = param.source
      let target = param.manual
      let k = 1 - Math.exp(-dt / Math.max(0.001, param.tau))

      switch (source.kind) {
        case 'constant':
          break
        case 'signal': {
          const x = curve(drives[source.drive] * source.gain + source.bias, source.curve)
          target = lo + (hi - lo) * clamp01(x)
          break
        }
        case 'gesture': {
          target = lo + (hi - lo) * clamp01(gestures[source.axis])
          break
        }
        case 'lfo': {
          target = lo + (hi - lo) * lfo(source.shape, source.hz, time, param.id, this.noise)
          break
        }
        case 'follow': {
          const raw = lo + (hi - lo) * clamp01(drives[source.drive])
          const tau = raw > param.value ? source.attack : source.release
          target = raw
          k = 1 - Math.exp(-dt / Math.max(0.001, tau))
          break
        }
      }

      param.value += (target - param.value) * k
      this.values[param.id] = param.value
    }
  }

  setManual(id: string, value: number): void {
    const param = this.byId.get(id)
    if (!param) return
    param.manual = clamp(value, param.range[0], param.range[1])
    this.emit()
  }

  /**
   * Write a value from the render loop without notifying React. A hand moving
   * at 18 Hz must not re-render the panel; the readouts are written directly.
   */
  nudge(id: string, value: number): void {
    const param = this.byId.get(id)
    if (!param) return
    param.manual = clamp(value, param.range[0], param.range[1])
  }

  setSource(id: string, source: ParamSource): void {
    const param = this.byId.get(id)
    if (!param) return
    param.source = source
    this.emit()
  }

  /** Learn mode: arm a param, then perform a gesture. */
  arm(id: string | null): void {
    this.armed = this.armed === id ? null : id
    this.emit()
  }

  /** Called by the gesture layer when an axis moves decisively. */
  learn(axis: GestureAxis): boolean {
    if (!this.armed) return false
    this.setSource(this.armed, { kind: 'gesture', axis })
    this.armed = null
    this.emit()
    return true
  }

  serialize(name: string): Preset {
    const params: Preset['params'] = {}
    for (const p of this.params) params[p.id] = { manual: p.manual, source: { ...p.source } }
    return { version: 1, name, params }
  }

  load(preset: Preset): void {
    if (preset.version !== 1 || !preset.params) return
    for (const p of this.params) {
      const entry = preset.params[p.id]
      if (!entry) continue
      p.manual = clamp(entry.manual, p.range[0], p.range[1])
      if (entry.source && SOURCE_KINDS.includes(entry.source.kind)) {
        p.source = { ...entry.source }
      }
    }
    this.emit()
  }

  reset(): void {
    for (let i = 0; i < this.params.length; i++) {
      const spec = SPECS[i]
      const param = this.params[i]
      param.manual = spec.manual
      param.source = { ...spec.source }
      param.tau = spec.tau
    }
    this.emit()
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}

/** Default source for a kind, so the panel's source dropdown always works. */
export function defaultSource(kind: SourceKind, previous: ParamSource): ParamSource {
  const drive: DriveKey =
    'drive' in previous ? previous.drive : DRIVE_KEYS[0]
  switch (kind) {
    case 'constant':
      return { kind: 'constant' }
    case 'signal':
      return { kind: 'signal', drive, gain: 1, bias: 0, curve: 'linear' }
    case 'gesture':
      return { kind: 'gesture', axis: 'pinch' }
    case 'lfo':
      return { kind: 'lfo', hz: 0.2, shape: 'sine' }
    case 'follow':
      return { kind: 'follow', drive, attack: 0.05, release: 0.4 }
  }
}

export function describeSource(source: ParamSource): string {
  switch (source.kind) {
    case 'constant':
      return 'fixed'
    case 'signal':
      return `${source.drive} ×${source.gain.toFixed(2)}${source.bias >= 0 ? '+' : ''}${source.bias.toFixed(2)}`
    case 'gesture':
      return `hand ${source.axis}`
    case 'lfo':
      return `${source.shape} ${source.hz.toFixed(2)} Hz`
    case 'follow':
      return `${source.drive} ${source.attack.toFixed(2)}/${source.release.toFixed(2)}s`
  }
}

function curve(x: number, kind: Curve): number {
  const c = clamp01(x)
  switch (kind) {
    case 'linear':
      return c
    case 'ease-in':
      return c * c
    case 'ease-out':
      return 1 - (1 - c) * (1 - c)
    case 's-curve':
      return c * c * (3 - 2 * c)
    case 'gate':
      return c >= 0.5 ? 1 : 0
  }
}

function lfo(
  shape: 'sine' | 'tri' | 'noise',
  hz: number,
  time: number,
  id: string,
  memory: Map<string, { bucket: number; value: number }>,
): number {
  const phase = time * hz
  switch (shape) {
    case 'sine':
      return Math.sin(phase * Math.PI * 2) * 0.5 + 0.5
    case 'tri':
      return Math.abs(((phase % 1) * 2) - 1)
    case 'noise': {
      // Stepped, not continuous: an LFO called "noise" that interpolates is a
      // slow sine with extra steps.
      const bucket = Math.floor(phase)
      const held = memory.get(id)
      if (held && held.bucket === bucket) return held.value
      const value = Math.random()
      memory.set(id, { bucket, value })
      return value
    }
  }
}

function konst(
  id: string,
  label: string,
  group: string,
  range: [number, number],
  tau: number,
  manual: number,
): ParamSpec {
  return { id, label, group, range, tau, manual, source: { kind: 'constant' } }
}

function sig(
  id: string,
  label: string,
  group: string,
  range: [number, number],
  tau: number,
  drive: DriveKey,
  gain: number,
  bias: number,
  curveKind: Curve,
): ParamSpec {
  return {
    id,
    label,
    group,
    range,
    tau,
    manual: range[0],
    source: { kind: 'signal', drive, gain, bias, curve: curveKind },
  }
}

function follow(
  id: string,
  label: string,
  group: string,
  range: [number, number],
  tau: number,
  drive: DriveKey,
  attack: number,
  release: number,
): ParamSpec {
  return {
    id,
    label,
    group,
    range,
    tau,
    manual: range[0],
    source: { kind: 'follow', drive, attack, release },
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
