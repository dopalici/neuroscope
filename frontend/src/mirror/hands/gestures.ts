/**
 * Five gestures. Exactly five, because a sixth is the one nobody remembers.
 *
 *   1  two-hand open-window   pinch both, pull apart → open the mirror
 *                             pinch both, push together → close it
 *   2  pinch-drag             one hand, grabs the nearest control
 *   3  two-hand rotate        turns the grade hue
 *   4  open palm, 800 ms      toggles the HUD
 *   5  index point, 600 ms    dwell-to-click under the reticle
 *
 * Pinch distance is divided by hand span, so the same pinch reads the same at
 * arm's length and at the keyboard. Landmarks arrive in the camera's own
 * orientation; screen x is flipped here, once, because everything downstream
 * lives on the mirrored canvas.
 */
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { GestureAxis, GestureValues } from '../../state/mirror/params'
import type { HandFrame } from './handWorker'

const WRIST = 0
const THUMB_TIP = 4
const INDEX_MCP = 5
const INDEX_PIP = 6
const INDEX_TIP = 8
const MIDDLE_MCP = 9
const MIDDLE_PIP = 10
const MIDDLE_TIP = 12
const RING_PIP = 14
const RING_TIP = 16
const PINKY_PIP = 18
const PINKY_TIP = 20

/** Pinch on and off at different distances, or it chatters at the boundary. */
const PINCH_ON = 0.42
const PINCH_OFF = 0.56

/** How far apart the hands travel between "just pinched" and a committed open. */
const WINDOW_TRAVEL = 0.26
/** Progress must be held past 1 before the mode actually changes. */
const WINDOW_COMMIT_HOLD = 0.08
/** Two-hand gestures pick one meaning and keep it until the hands release. */
const TWO_HAND_DEADZONE = 0.05

const PALM_HOLD_SECONDS = 0.8
const POINT_DWELL_SECONDS = 0.6
/** A dwell that survives the hand wobbling is a dwell; this is the leash. */
const DWELL_SLOP = 0.06

/** Landmarks go stale fast — a frozen hand on screen is worse than no hand. */
const STALE_SECONDS = 0.4

export type GestureEventType =
  | 'window-open'
  | 'window-close'
  | 'hud-toggle'
  | 'activate'
  | 'grab'
  | 'release'

export interface GestureEvent {
  type: GestureEventType
  x: number
  y: number
}

export interface WindowGesture {
  /** Both hands pinched: the motion is underway. */
  active: boolean
  /** −1 fully closed through 0 (start) to +1 committed open. */
  progress: number
  direction: 'open' | 'close' | null
}

export interface GestureState {
  hands: number
  /** Normalised, mirrored positions for drawing — one entry per visible hand. */
  points: { x: number; y: number; pinch: number }[]
  axes: GestureValues
  window: WindowGesture
  drag: { active: boolean; x: number; y: number }
  rotate: { active: boolean; turns: number }
  palmHold: number
  point: { active: boolean; x: number; y: number; dwell: number }
  face: HandFrame['face']
  cost: number
  events: GestureEvent[]
}

type TwoHandMode = 'idle' | 'window' | 'rotate'

interface HandRead {
  x: number
  y: number
  pinching: boolean
  pinch: number
  openPalm: boolean
  pointing: boolean
  indexX: number
  indexY: number
}

export class GestureRecognizer {
  readonly state: GestureState = {
    hands: 0,
    points: [],
    axes: { pinch: 0, x: 0.5, y: 0.5, rotate: 0.5, spread: 0 },
    window: { active: false, progress: 0, direction: null },
    drag: { active: false, x: 0.5, y: 0.5 },
    rotate: { active: false, turns: 0 },
    palmHold: 0,
    point: { active: false, x: 0.5, y: 0.5, dwell: 0 },
    face: null,
    cost: 0,
    events: [],
  }

  private pinching: [boolean, boolean] = [false, false]
  private mode: TwoHandMode = 'idle'
  private anchorSpread = 0
  private anchorAngle = 0
  private committedAt = 0
  private commitHeldSince = 0
  private palmSince = 0
  private dwellSince = 0
  private dwellAt = { x: 0, y: 0 }
  private dragging = false
  private lastFrameAt = -Infinity
  private reads: HandRead[] = []

  update(frame: HandFrame | null, now: number): GestureState {
    const s = this.state
    s.events.length = 0

    if (frame) {
      this.lastFrameAt = now
      s.face = frame.face
      s.cost = frame.cost
      this.reads = frame.hands.map((lm, i) => readHand(lm, this.pinching[i] ?? false))
      // Order by screen position so the pair is stable regardless of what
      // MediaPipe decides is a left hand in a mirrored image.
      this.reads.sort((a, b) => a.x - b.x)
    } else if (now - this.lastFrameAt >= STALE_SECONDS) {
      // Inference runs at a third of the display rate, so the last read is held
      // between results; past that it is not a hand any more, it is a memory.
      this.reads = []
      this.reset()
      return s
    }

    const reads = this.reads
    s.hands = reads.length
    s.points = reads.map((r) => ({ x: r.x, y: r.y, pinch: r.pinch }))
    for (let i = 0; i < 2; i++) this.pinching[i] = reads[i]?.pinching ?? false

    if (reads.length >= 2) this.twoHands(reads[0], reads[1], now)
    else this.endTwoHands()

    if (reads.length === 1) this.oneHand(reads[0], now)
    else this.endOneHand()

    this.updateAxes(reads)
    return s
  }

  /** Keyboard and mouse feed the same state, so nothing downstream branches. */
  setWindowProgress(progress: number): void {
    this.state.window.progress = progress
  }

  private twoHands(a: HandRead, b: HandRead, now: number): void {
    const spread = Math.hypot(b.x - a.x, b.y - a.y)
    const angle = Math.atan2(b.y - a.y, b.x - a.x)

    if (!(a.pinching && b.pinching)) {
      this.endTwoHands()
      return
    }

    if (this.mode === 'idle') {
      this.mode = 'window'
      this.anchorSpread = spread
      this.anchorAngle = angle
      this.commitHeldSince = 0
      this.state.window.active = true
    }

    const dSpread = spread - this.anchorSpread
    const dAngle = shortestAngle(angle - this.anchorAngle)

    // One meaning per grab: whichever axis moves first wins, and it keeps
    // winning until the hands come apart.
    if (
      this.mode === 'window' &&
      Math.abs(dSpread) < TWO_HAND_DEADZONE &&
      Math.abs(dAngle) > 0.35
    ) {
      this.mode = 'rotate'
      this.state.window.active = false
      this.state.window.progress = 0
    }

    if (this.mode === 'rotate') {
      this.state.rotate.active = true
      this.state.rotate.turns = dAngle / Math.PI
      return
    }

    const progress = clamp(dSpread / WINDOW_TRAVEL, -1.4, 1.4)
    this.state.window.progress = progress
    this.state.window.direction = progress >= 0 ? 'open' : 'close'

    const past = Math.abs(progress) >= 1
    if (!past) {
      this.commitHeldSince = 0
      return
    }
    if (this.commitHeldSince === 0) this.commitHeldSince = now
    if (now - this.commitHeldSince < WINDOW_COMMIT_HOLD) return
    if (now - this.committedAt < 1.2) return

    this.committedAt = now
    this.commitHeldSince = 0
    this.state.events.push({
      type: progress > 0 ? 'window-open' : 'window-close',
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    })
  }

  private endTwoHands(): void {
    if (this.mode === 'idle') return
    this.mode = 'idle'
    this.commitHeldSince = 0
    // Snap back: an incomplete motion should visibly fail, not linger half-open.
    this.state.window.active = false
    this.state.window.progress = 0
    this.state.window.direction = null
    this.state.rotate.active = false
  }

  private oneHand(hand: HandRead, now: number): void {
    const s = this.state

    if (hand.pinching) {
      if (!this.dragging) {
        this.dragging = true
        s.events.push({ type: 'grab', x: hand.x, y: hand.y })
      }
      s.drag.active = true
      s.drag.x = hand.x
      s.drag.y = hand.y
    } else if (this.dragging) {
      this.dragging = false
      s.drag.active = false
      s.events.push({ type: 'release', x: s.drag.x, y: s.drag.y })
    }

    if (hand.openPalm && !hand.pinching) {
      if (this.palmSince === 0) this.palmSince = now
      s.palmHold = clamp01((now - this.palmSince) / PALM_HOLD_SECONDS)
      if (s.palmHold >= 1) {
        this.palmSince = now + 1e6 // consumed; a new palm has to start over
        s.palmHold = 0
        s.events.push({ type: 'hud-toggle', x: hand.x, y: hand.y })
      }
    } else {
      this.palmSince = 0
      s.palmHold = 0
    }

    // Dwell-to-click. Inventing a click gesture and asking people to hold their
    // hand still enough to perform it reliably is a losing trade.
    if (hand.pointing && !hand.pinching) {
      const moved = Math.hypot(hand.indexX - this.dwellAt.x, hand.indexY - this.dwellAt.y)
      if (this.dwellSince === 0 || moved > DWELL_SLOP) {
        this.dwellSince = now
        this.dwellAt = { x: hand.indexX, y: hand.indexY }
      }
      s.point.active = true
      s.point.x = hand.indexX
      s.point.y = hand.indexY
      s.point.dwell = clamp01((now - this.dwellSince) / POINT_DWELL_SECONDS)
      if (s.point.dwell >= 1) {
        this.dwellSince = now + 1e6
        s.point.dwell = 0
        s.events.push({ type: 'activate', x: hand.indexX, y: hand.indexY })
      }
    } else {
      this.dwellSince = 0
      s.point.active = false
      s.point.dwell = 0
    }
  }

  private endOneHand(): void {
    const s = this.state
    if (this.dragging) {
      this.dragging = false
      s.events.push({ type: 'release', x: s.drag.x, y: s.drag.y })
    }
    s.drag.active = false
    s.palmHold = 0
    s.point.active = false
    s.point.dwell = 0
    this.palmSince = 0
    this.dwellSince = 0
  }

  private updateAxes(reads: HandRead[]): void {
    const axes = this.state.axes
    const primary = reads[0]
    if (primary) {
      axes.pinch = clamp01(1 - primary.pinch)
      axes.x = clamp01(primary.x)
      axes.y = clamp01(1 - primary.y)
    }
    if (reads.length >= 2) {
      axes.spread = clamp01(Math.hypot(reads[1].x - reads[0].x, reads[1].y - reads[0].y) / 0.8)
      axes.rotate = clamp01(this.state.rotate.turns * 0.5 + 0.5)
    }
  }

  private reset(): void {
    const s = this.state
    s.hands = 0
    s.points.length = 0
    this.endTwoHands()
    this.endOneHand()
  }
}

/** Which axis just moved decisively — used by learn mode to bind a param. */
export function dominantAxis(
  axes: GestureValues,
  previous: GestureValues,
  threshold = 0.18,
): GestureAxis | null {
  let best: GestureAxis | null = null
  let delta = threshold
  for (const key of ['pinch', 'x', 'y', 'rotate', 'spread'] as GestureAxis[]) {
    const d = Math.abs(axes[key] - previous[key])
    if (d > delta) {
      delta = d
      best = key
    }
  }
  return best
}

function readHand(lm: NormalizedLandmark[], wasPinching: boolean): HandRead {
  const wrist = lm[WRIST]
  const mid = lm[MIDDLE_MCP]
  // Wrist to middle knuckle is the most stable length on a hand, so it is the
  // yardstick that makes everything else depth-invariant.
  const span = Math.max(1e-4, Math.hypot(mid.x - wrist.x, mid.y - wrist.y))

  const pinchRaw = Math.hypot(lm[THUMB_TIP].x - lm[INDEX_TIP].x, lm[THUMB_TIP].y - lm[INDEX_TIP].y)
  const pinch = pinchRaw / span
  const pinching = wasPinching ? pinch < PINCH_OFF : pinch < PINCH_ON

  const indexOut = extended(lm, INDEX_TIP, INDEX_PIP, wrist)
  const middleOut = extended(lm, MIDDLE_TIP, MIDDLE_PIP, wrist)
  const ringOut = extended(lm, RING_TIP, RING_PIP, wrist)
  const pinkyOut = extended(lm, PINKY_TIP, PINKY_PIP, wrist)

  const openPalm = indexOut && middleOut && ringOut && pinkyOut
  const pointing = indexOut && !middleOut && !ringOut && !pinkyOut

  // Flip x: the canvas is a mirror, the camera is not.
  return {
    x: 1 - lm[INDEX_MCP].x,
    y: lm[INDEX_MCP].y,
    pinching,
    pinch: clamp01(pinch / 1.6),
    openPalm,
    pointing,
    indexX: 1 - lm[INDEX_TIP].x,
    indexY: lm[INDEX_TIP].y,
  }
}

function extended(
  lm: NormalizedLandmark[],
  tip: number,
  pip: number,
  wrist: NormalizedLandmark,
): boolean {
  const dTip = Math.hypot(lm[tip].x - wrist.x, lm[tip].y - wrist.y)
  const dPip = Math.hypot(lm[pip].x - wrist.x, lm[pip].y - wrist.y)
  return dTip > dPip * 1.12
}

function shortestAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
