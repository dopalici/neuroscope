/**
 * Signal → drives.
 *
 * Two tiers, and the split is the whole design. Band powers come out of a 2 s
 * Welch window pushed at 10 Hz, so anything derived from β/α is structurally
 * one to two seconds behind the person in front of the camera. Drive the entire
 * image from that and the piece feels dead — you move, and nothing answers.
 *
 *   instant (<100 ms)   blink → shutter · clench → shear + shockwave ·
 *                       100 ms RMS envelope → edge shimmer
 *   slow (1–3 s)        drift · wander · ease · pulse · lean · tilt
 *
 * Everything in the slow tier is a z-score against the user's own baseline.
 * Absolute thresholds do not survive a change of person, a change of session,
 * or a headband slipping two millimetres.
 */
import { museBus } from '../museBus'
import { baseline } from './baseline'
import type { BaselineKey, BaselineSample } from './baseline'
import type { FrameMessage } from '../../types'

export const DRIVE_KEYS = [
  'drift',
  'wander',
  'ease',
  'pulse',
  'lean',
  'tiltX',
  'tiltY',
  'shutter',
  'clench',
  'shimmer',
  'fog',
  'coherence',
] as const

export type DriveKey = (typeof DRIVE_KEYS)[number]
export type Drives = Record<DriveKey, number>

export const DRIVE_LABELS: Record<DriveKey, string> = {
  drift: 'DRIFT',
  wander: 'WANDER',
  ease: 'EASE',
  pulse: 'PULSE',
  lean: 'LEAN',
  tiltX: 'TILT X',
  tiltY: 'TILT Y',
  shutter: 'SHUTTER',
  clench: 'CLENCH',
  shimmer: 'SHIMMER',
  fog: 'FOG',
  coherence: 'COHERENCE',
}

/**
 * The canvas is mirrored, so the user's LEFT frontal electrode lands on the
 * RIGHT of the picture. Resolved once, here. Nothing downstream — not the lean
 * grade split, not the per-channel reticles — may read AF7/AF8 directly.
 */
export const SCREEN_SIDE = { left: 'AF8', right: 'AF7' } as const

const TAU: Partial<Record<DriveKey, number>> = {
  drift: 1.5,
  wander: 2.8,
  ease: 2.0,
  lean: 4.0,
  tiltX: 0.28,
  tiltY: 0.22,
  shimmer: 0.09,
  coherence: 1.4,
}

/** Blinks close the picture for about as long as a real eyelid does. */
const SHUTTER_SECONDS = 0.07
/** How long a clench shockwave takes to cross the frame. */
const SHOCK_SECONDS = 0.45
/** Below 3 Hz, and further apart again under reduced motion. */
const SHUTTER_GAP_SECONDS = 0.34
const SHUTTER_GAP_REDUCED = 0.7

/** Fog rises slowly enough that a 100 ms blink cannot register as bad contact. */
const FOG_ATTACK = 0.6
const FOG_RELEASE = 1.4

/** A frame this old means the stream stalled, which is not a brain state. */
const STALE_MS = 1500

export type CoherenceKey = 'clear' | 'holding' | 'drifting' | 'scattered'

export interface CoherenceState {
  key: CoherenceKey
  word: string
  note: string
}

const COHERENCE_STATES: readonly (CoherenceState & { min: number })[] = [
  { min: 0.72, key: 'clear', word: 'Clear', note: 'β/α well above your baseline' },
  { min: 0.5, key: 'holding', word: 'Holding', note: 'engagement around your baseline' },
  { min: 0.3, key: 'drifting', word: 'Drifting', note: 'θ/β climbing against β/α' },
  { min: -1, key: 'scattered', word: 'Scattered', note: 'slow rhythms leading' },
]

/**
 * Longer than the badge's `BrainState.hold`, because this word is attached to a
 * whole-screen effect: a state that flickers would make the image flicker.
 */
const STATE_HOLD_SECONDS = 2.5

export interface Legend {
  /** The effect currently doing the most to the picture. */
  effect: string
  /** What is driving it, in the units the number is actually measured in. */
  driver: string
  value: number
  z: number
  /** Seconds of signal behind the number. Latency, stated rather than hidden. */
  window: number
}

export interface Veto {
  active: boolean
  reason: string | null
}

/** Only slow drives compete for the legend; instant ones are self-evident. */
const LEGEND_CANDIDATES: readonly DriveKey[] = ['drift', 'wander', 'ease', 'lean']

const SHAM_BLOCK = 20 // 2 s at 10 Hz — long enough to keep texture, short enough to destroy causality
const SHAM_CAPACITY = 900 // 90 s

interface Scalars {
  focus: number
  calm: number
  thetaBeta: number
  alphaAbs: number
  faa: number
  hr: number
  envelope: number
  posture: number
}

const SCALAR_FIELDS: readonly (keyof Scalars)[] = [
  'focus',
  'calm',
  'thetaBeta',
  'alphaAbs',
  'faa',
  'hr',
  'envelope',
  'posture',
]

export class MirrorMapping {
  /** Stable identity — read from the render loop, never copied. */
  readonly drives: Drives = Object.fromEntries(DRIVE_KEYS.map((k) => [k, 0])) as Drives

  readonly veto: Veto = { active: false, reason: null }
  readonly legend: Legend = { effect: '—', driver: 'waiting for signal', value: 0, z: 0, window: 2 }

  /** 0 at the instant of a blink for the GL chain; 1 → 0 across the shutter. */
  shutterPhase = 0
  /** 0 → 1 as a clench ring leaves the centre. */
  shockPhase = 1
  reduced = false
  sham = false

  state: CoherenceState = COHERENCE_STATES[2]
  /** True until the user has run a real 60 s calibration. */
  get uncalibrated(): boolean {
    return !baseline.calibrated
  }

  private target: Drives = Object.fromEntries(DRIVE_KEYS.map((k) => [k, 0])) as Drives
  private seq = -1
  private scalars: Scalars = blankScalars()
  private prevBlink = false
  private prevJaw = false
  private lastShutterAt = -Infinity
  private lastBeatAt = 0
  private beatPeriod = 1
  private restPosture = 0
  private prevPosture = 0
  private frozenCoherence = 0.5
  private pendingState: CoherenceKey | null = null
  private pendingSince = 0

  private shamRing: Float32Array = new Float32Array(SHAM_CAPACITY * SCALAR_FIELDS.length)
  private shamCount = 0
  private shamHead = 0
  private shamCursor = 0
  private shamBlockStart = 0
  private shamBlockLeft = 0
  private shamScalars: Scalars = blankScalars()

  /** Call once per animation frame. `now` is seconds. */
  update(now: number, dt: number): void {
    const latest = museBus.latest
    const frame = latest.frame
    const fresh = frame !== null && latest.seq !== this.seq
    if (fresh) {
      this.seq = latest.seq
      this.ingest(frame, now)
    }

    const stale = !frame || performance.now() - latest.receivedAt > STALE_MS
    this.updateVeto(frame, stale)

    const source = this.sham ? this.shamScalars : this.scalars
    this.computeTargets(source, now, stale)
    this.smooth(dt)
    this.updateInstant(now, dt)
    this.updateState(now)
    this.updateLegend(source)
  }

  /** The sham signal is advanced on the same clock so the two are swappable. */
  setSham(on: boolean): void {
    this.sham = on
    this.shamBlockLeft = 0
  }

  private ingest(frame: FrameMessage, now: number): void {
    const s = this.scalars
    const avg = frame.bands_avg
    const beta = avg.beta ?? 0
    s.focus = frame.indices.focus
    s.calm = frame.indices.calm
    s.thetaBeta = beta > 1e-6 ? (avg.theta ?? 0) / beta : 0
    s.alphaAbs = frame.indices.alpha_abs
    s.faa = frame.indices.faa
    s.hr = frame.heart.hr
    s.envelope = meanEnvelope(frame)
    s.posture = frame.motion.posture

    // Posture is reported as an absolute tilt from upright, so "level" is
    // wherever this person's head actually sits. It settles over ~30 s.
    this.restPosture += (s.posture - this.restPosture) * 0.006

    const sample: BaselineSample = {
      focus: s.focus,
      calm: s.calm,
      thetaBeta: s.thetaBeta,
      alphaAbs: s.alphaAbs,
      faa: s.faa,
      hr: s.hr,
      envelope: s.envelope,
    }
    // 10 Hz frames; the calibration clock advances on real frames only, so a
    // dropped connection pauses it rather than silently counting empty seconds.
    baseline.feed(sample, 0.1)
    this.pushSham(s)

    const beats = frame.heart.beats
    if (beats?.length) {
      const newest = beats[beats.length - 1]
      // Server timestamps are epoch seconds; convert into the loop's clock.
      const age = Date.now() / 1000 - newest
      if (age >= 0 && age < 3) this.lastBeatAt = now - age
    }
    if (s.hr > 0) this.beatPeriod = 60 / s.hr

    if (frame.artifacts.blink && !this.prevBlink) this.fireShutter(now)
    this.prevBlink = frame.artifacts.blink

    if (frame.artifacts.jaw && !this.prevJaw) this.shockPhase = 0
    this.prevJaw = frame.artifacts.jaw
  }

  private fireShutter(now: number): void {
    const gap = this.reduced ? SHUTTER_GAP_REDUCED : SHUTTER_GAP_SECONDS
    if (now - this.lastShutterAt < gap) return
    this.lastShutterAt = now
  }

  private updateVeto(frame: FrameMessage | null, stale: boolean): void {
    let reason: string | null = null
    // In sham nothing on screen is a claim about the headband, so a veto would
    // be reporting on a signal that is not driving anything. The SHAM chip is
    // the honesty here, and it is always visible.
    if (this.sham) reason = null
    else if (stale) reason = 'NO SIGNAL'
    else if (frame) {
      let red = 0
      for (const key in frame.quality) if (frame.quality[key].label === 'red') red += 1
      if (red > 0) reason = red > 1 ? `${red} CONTACTS LOST` : 'CONTACT LOST'
      else if (!frame.motion.still) reason = 'HEAD MOVING'
      else if (frame.artifacts.jaw) reason = 'JAW EMG'
      else if (frame.artifacts.blink) reason = 'BLINK'
    }
    this.veto.active = reason !== null
    this.veto.reason = reason
  }

  private computeTargets(s: Scalars, now: number, stale: boolean): void {
    const t = this.target

    const zFocus = baseline.z('focus', s.focus)
    const zTheta = baseline.z('thetaBeta', s.thetaBeta)

    // Coherence: engagement above your own baseline, penalised by the classic
    // inattention marker. Frozen — not zeroed — whenever the veto is up, so a
    // blink leaves the picture where it was rather than punching a hole in it.
    if (!this.veto.active && !stale) {
      this.frozenCoherence = logistic((zFocus - 0.6 * zTheta) * 0.85)
    }
    t.coherence = this.frozenCoherence
    t.drift = 1 - this.frozenCoherence

    // Wander is deliberately a different number from drift: mind-wandering and
    // agitated distraction are not the same state and must not look alike.
    t.wander = logistic(zTheta * 0.9)
    t.ease = logistic(baseline.z('calm', s.calm) * 0.9)
    t.lean = clamp(baseline.z('faa', s.faa) / 2.5, -1, 1)
    t.shimmer = clamp01(logistic(baseline.z('envelope', s.envelope) * 0.8) * 1.3 - 0.15)

    const tilt = clamp((s.posture - this.restPosture) / 22, -1, 1)
    t.tiltY = tilt
    // The backend reports tilt as a single angle from upright, so there is no
    // honest yaw axis; sway is taken from how fast that angle is changing.
    t.tiltX = clamp((s.posture - this.prevPosture) * 0.12, -1, 1)
    this.prevPosture += (s.posture - this.prevPosture) * 0.25

    t.fog = this.veto.active ? 1 : 0

    // Beat-locked when the PPG is giving us beats, free-running at the average
    // rate when it is not — an oscillator at the mean rate drifts out of phase
    // with the heart within a few seconds.
    const sinceBeat = now - this.lastBeatAt
    const locked = this.lastBeatAt > 0 && sinceBeat < this.beatPeriod * 2.2
    const phase = locked ? sinceBeat : (now / this.beatPeriod) % 1 * this.beatPeriod
    t.pulse = s.hr > 0 ? Math.exp(-phase / 0.16) : 0
  }

  private smooth(dt: number): void {
    const { drives, target } = this
    for (const key of DRIVE_KEYS) {
      const tau = TAU[key]
      if (tau === undefined) continue
      // Same frame-rate independent form the atmosphere engine uses, so motion
      // is identical at 60 and 120 Hz.
      drives[key] += (target[key] - drives[key]) * (1 - Math.exp(-dt / tau))
    }
    // Fog attacks and releases at different rates; one exponential cannot.
    const fogTau = target.fog > drives.fog ? FOG_ATTACK : FOG_RELEASE
    drives.fog += (target.fog - drives.fog) * (1 - Math.exp(-dt / fogTau))
    drives.pulse = target.pulse
  }

  private updateInstant(now: number, dt: number): void {
    const since = now - this.lastShutterAt
    this.shutterPhase = since < SHUTTER_SECONDS ? 1 - since / SHUTTER_SECONDS : 0
    this.drives.shutter = this.shutterPhase

    this.shockPhase = Math.min(1, this.shockPhase + dt / SHOCK_SECONDS)
    this.drives.clench = 1 - this.shockPhase
  }

  private updateState(now: number): void {
    const c = this.drives.coherence
    let next = COHERENCE_STATES[COHERENCE_STATES.length - 1]
    for (const s of COHERENCE_STATES) {
      if (c >= s.min) {
        next = s
        break
      }
    }
    if (next.key === this.state.key) {
      this.pendingState = null
      return
    }
    // Crossing is not enough: the new band has to be held.
    if (this.pendingState !== next.key) {
      this.pendingState = next.key
      this.pendingSince = now
      return
    }
    if (now - this.pendingSince >= STATE_HOLD_SECONDS) {
      this.state = next
      this.pendingState = null
    }
  }

  private updateLegend(s: Scalars): void {
    const d = this.drives
    const legend = this.legend

    if (d.fog > 0.35) {
      legend.effect = 'FOG'
      legend.driver = this.veto.reason ?? 'signal interrupted'
      legend.value = 0
      legend.z = 0
      legend.window = 0.1
      return
    }

    // Whichever slow drive is furthest from neutral owns the picture.
    let key: DriveKey = 'drift'
    let score = -1
    for (const candidate of LEGEND_CANDIDATES) {
      const v =
        candidate === 'lean'
          ? Math.abs(d.lean) * 0.6
          : Math.abs(d[candidate] - 0.5)
      if (v > score) {
        score = v
        key = candidate
      }
    }

    legend.effect = DRIVE_LABELS[key]
    switch (key) {
      case 'wander':
        legend.driver = 'θ/β'
        legend.value = s.thetaBeta
        legend.z = baseline.z('thetaBeta', s.thetaBeta)
        legend.window = 2
        break
      case 'ease':
        legend.driver = 'relative α'
        legend.value = s.calm
        legend.z = baseline.z('calm', s.calm)
        legend.window = 2
        break
      case 'lean':
        legend.driver = 'FAA ln(α AF8) − ln(α AF7)'
        legend.value = s.faa
        legend.z = baseline.z('faa', s.faa)
        legend.window = 2
        break
      default:
        legend.effect = 'DRIFT'
        legend.driver = 'β/α'
        legend.value = s.focus
        legend.z = baseline.z('focus', s.focus)
        legend.window = 2
    }
  }

  /* —— Sham ————————————————————————————————————————————————————
     The same numbers, in the wrong order. Two-second blocks keep the texture of
     real EEG while destroying any relationship to what the user is doing, which
     is the only way to honestly ask "can you actually tell?". It doubles as the
     no-headband demo, next to the existing SimulatedSource. */

  private pushSham(s: Scalars): void {
    const stride = SCALAR_FIELDS.length
    const base = this.shamHead * stride
    for (let i = 0; i < stride; i++) this.shamRing[base + i] = s[SCALAR_FIELDS[i]]
    this.shamHead = (this.shamHead + 1) % SHAM_CAPACITY
    if (this.shamCount < SHAM_CAPACITY) this.shamCount += 1
    if (this.sham) this.advanceSham()
  }

  private advanceSham(): void {
    const stride = SCALAR_FIELDS.length
    if (this.shamCount < SHAM_BLOCK * 3) {
      // Not enough recorded signal yet — a slow random walk keeps the mirror
      // alive rather than freezing it on the first sample.
      const s = this.shamScalars
      for (const field of SCALAR_FIELDS) {
        s[field] = s[field] * 0.97 + (baseline.mean(shamKey(field)) || 1) * 0.03 * (0.6 + Math.random() * 0.8)
      }
      return
    }
    if (this.shamBlockLeft <= 0) {
      this.shamBlockStart = Math.floor(Math.random() * (this.shamCount - SHAM_BLOCK))
      this.shamBlockLeft = SHAM_BLOCK
      this.shamCursor = 0
    }
    const idx = (this.shamBlockStart + this.shamCursor) % SHAM_CAPACITY
    const base = idx * stride
    for (let i = 0; i < stride; i++) this.shamScalars[SCALAR_FIELDS[i]] = this.shamRing[base + i]
    this.shamCursor += 1
    this.shamBlockLeft -= 1
  }
}

function shamKey(field: keyof Scalars): BaselineKey {
  return field === 'posture' ? 'hr' : field
}

function meanEnvelope(frame: FrameMessage): number {
  const env = frame.envelope
  if (!env) return 0
  let sum = 0
  let n = 0
  for (const key in env) {
    sum += env[key]
    n += 1
  }
  return n ? sum / n : 0
}

function blankScalars(): Scalars {
  return {
    focus: 0,
    calm: 0,
    thetaBeta: 0,
    alphaAbs: 0,
    faa: 0,
    hr: 0,
    envelope: 0,
    posture: 0,
  }
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
