/**
 * Personal baseline — the difference between convincing and gimmick.
 *
 * Every slow-tier drive is a z-score against the person sitting in front of the
 * camera, measured in this session's headband placement, never an absolute
 * threshold. The README says plainly that focus / calm / FAA do not generalise
 * between people or sessions; a mirror driven by fixed cut-offs would be
 * quietly contradicting that.
 *
 * Sixty seconds: 20 s eyes-open rest, 20 s eyes-closed, 20 s arithmetic. The
 * three phases exist to make the pooled spread cover the person's actual range
 * rather than whatever state they happened to sit down in.
 */

export const BASELINE_KEYS = [
  'focus',
  'calm',
  'thetaBeta',
  'alphaAbs',
  'faa',
  'hr',
  'envelope',
] as const

export type BaselineKey = (typeof BASELINE_KEYS)[number]

export type BaselineSample = Record<BaselineKey, number>

export interface Stats {
  mean: number
  sd: number
  n: number
}

export type PhaseId = 'rest-open' | 'rest-closed' | 'task'

export interface Phase {
  id: PhaseId
  label: string
  instruction: string
  seconds: number
}

export const PHASES: readonly Phase[] = [
  {
    id: 'rest-open',
    label: 'Eyes open',
    instruction: 'Sit still. Look at a fixed point. Let your face go slack.',
    seconds: 20,
  },
  {
    id: 'rest-closed',
    label: 'Eyes closed',
    instruction: 'Close your eyes and keep them closed. Breathe normally.',
    seconds: 20,
  },
  {
    id: 'task',
    label: 'Arithmetic',
    instruction: 'Eyes open. Count backwards from 300 in sevens, silently.',
    seconds: 20,
  },
]

export const BASELINE_SECONDS = PHASES.reduce((t, p) => t + p.seconds, 0)

export interface BaselineRecord {
  version: 1
  createdAt: number
  pooled: Record<BaselineKey, Stats>
  phaseMeans: Record<PhaseId, Record<BaselineKey, number>>
}

export interface CalibrationState {
  running: boolean
  phaseIndex: number
  /** Seconds into the current phase. */
  elapsed: number
  /** Seconds into the whole run. */
  total: number
}

const STORAGE_KEY = 'neuroscope.mirror.baseline.v1'

/**
 * Without a stored baseline the mirror still has to do something, so a running
 * estimate is kept from the moment the stream starts. It is capped rather than
 * left cumulative: an estimator that keeps adapting forever eventually
 * normalises away the very change it is supposed to be measuring.
 */
const FALLBACK_MIN_N = 60 // ~6 s at 10 Hz before z-scores mean anything
const FALLBACK_MAX_N = 1800 // ~3 min, then it stops moving

/** Welford's online mean and variance — numerically stable, no sample list. */
class Accumulator {
  n = 0
  mean = 0
  private m2 = 0

  push(x: number, capacity = Infinity): void {
    if (!Number.isFinite(x)) return
    if (this.n >= capacity) return
    this.n += 1
    const d = x - this.mean
    this.mean += d / this.n
    this.m2 += d * (x - this.mean)
  }

  get sd(): number {
    return this.n > 1 ? Math.sqrt(this.m2 / (this.n - 1)) : 0
  }

  stats(): Stats {
    return { mean: this.mean, sd: this.sd, n: this.n }
  }

  reset(): void {
    this.n = 0
    this.mean = 0
    this.m2 = 0
  }
}

function emptyAccumulators(): Record<BaselineKey, Accumulator> {
  const out = {} as Record<BaselineKey, Accumulator>
  for (const key of BASELINE_KEYS) out[key] = new Accumulator()
  return out
}

class BaselineStore {
  record: BaselineRecord | null = null

  readonly calibration: CalibrationState = {
    running: false,
    phaseIndex: 0,
    elapsed: 0,
    total: 0,
  }

  private fallback = emptyAccumulators()
  private pooled = emptyAccumulators()
  private phase = emptyAccumulators()
  private phaseMeans = {} as Record<PhaseId, Record<BaselineKey, number>>
  private listeners = new Set<() => void>()

  constructor() {
    this.record = read()
  }

  get calibrated(): boolean {
    return this.record !== null
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /**
   * Standard scores clamp at ±4: past that the number is almost always an
   * artifact that slipped the veto, and letting it through would slam every
   * effect to its rail.
   */
  z(key: BaselineKey, value: number): number {
    const stats = this.record?.pooled[key] ?? this.fallback[key].stats()
    if (stats.n < (this.record ? 2 : FALLBACK_MIN_N)) return 0
    const sd = stats.sd
    if (!(sd > 1e-9)) return 0
    const z = (value - stats.mean) / sd
    return z < -4 ? -4 : z > 4 ? 4 : z
  }

  mean(key: BaselineKey): number {
    return this.record?.pooled[key].mean ?? this.fallback[key].mean
  }

  sd(key: BaselineKey): number {
    return this.record?.pooled[key].sd ?? this.fallback[key].sd
  }

  /** Called once per incoming frame, calibrating or not. */
  feed(sample: BaselineSample, dt: number): void {
    for (const key of BASELINE_KEYS) this.fallback[key].push(sample[key], FALLBACK_MAX_N)
    if (!this.calibration.running) return

    const cal = this.calibration
    const phase = PHASES[cal.phaseIndex]
    for (const key of BASELINE_KEYS) {
      this.pooled[key].push(sample[key])
      this.phase[key].push(sample[key])
    }

    cal.elapsed += dt
    cal.total += dt
    if (cal.elapsed < phase.seconds) return

    this.closePhase(phase.id)
    if (cal.phaseIndex + 1 >= PHASES.length) this.finish()
    else {
      cal.phaseIndex += 1
      cal.elapsed = 0
      this.emit()
    }
  }

  begin(): void {
    for (const key of BASELINE_KEYS) {
      this.pooled[key].reset()
      this.phase[key].reset()
    }
    this.phaseMeans = {} as Record<PhaseId, Record<BaselineKey, number>>
    this.calibration.running = true
    this.calibration.phaseIndex = 0
    this.calibration.elapsed = 0
    this.calibration.total = 0
    this.emit()
  }

  abort(): void {
    this.calibration.running = false
    this.calibration.elapsed = 0
    this.calibration.total = 0
    this.emit()
  }

  clear(): void {
    this.record = null
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Private browsing: the in-memory clear is still correct.
    }
    this.emit()
  }

  private closePhase(id: PhaseId): void {
    const means = {} as Record<BaselineKey, number>
    for (const key of BASELINE_KEYS) {
      means[key] = this.phase[key].mean
      this.phase[key].reset()
    }
    this.phaseMeans[id] = means
  }

  private finish(): void {
    const pooled = {} as Record<BaselineKey, Stats>
    for (const key of BASELINE_KEYS) pooled[key] = this.pooled[key].stats()

    this.record = {
      version: 1,
      createdAt: Date.now(),
      pooled,
      phaseMeans: this.phaseMeans,
    }
    this.calibration.running = false
    this.calibration.elapsed = 0
    write(this.record)
    this.emit()
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}

function read(): BaselineRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BaselineRecord
    if (parsed.version !== 1 || !parsed.pooled) return null
    for (const key of BASELINE_KEYS) if (!parsed.pooled[key]) return null
    return parsed
  } catch {
    return null
  }
}

function write(record: BaselineRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // Storage can be full or blocked; the session baseline still applies.
  }
}

export const baseline = new BaselineStore()
