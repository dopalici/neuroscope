/**
 * Muse signal bus — the single owner of the WebSocket.
 *
 * The dashboard is happy being handed fresh arrays ten times a second. A 60 fps
 * GL loop is not: it needs to read the newest numbers without allocating, and
 * it needs to know whether anything has actually changed since it last looked.
 * So the socket lives here instead of inside a hook, history goes into
 * preallocated ring buffers, and `latest` is a plain mutable object that never
 * changes identity.
 *
 * React consumers subscribe and build their own snapshots; the render loop just
 * reads.
 */
import type { FrameMessage, MetaMessage, ServerMessage } from '../types'

const WS_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  // In vite dev, proxy /ws → backend. In production, same host or override.
  const host = import.meta.env.VITE_WS_HOST || window.location.host
  return `${proto}://${host}/ws`
})()

const MAX_EEG_SAMPLES = 256 * 4 // ~4 s at 256 Hz
const HISTORY_LEN = 120 // ~12 s of index history at 10 Hz
const CHANNEL_COUNT = 4

/** Fixed-length rolling buffer of floats, oldest first when read out. */
export class Ring {
  private readonly buf: Float32Array
  private head = 0
  readonly capacity: number
  count = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.buf = new Float32Array(capacity)
  }

  push(v: number): void {
    this.buf[this.head] = v
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count += 1
  }

  /** 0 is the oldest retained sample. */
  at(i: number): number {
    const start = (this.head - this.count + this.capacity) % this.capacity
    return this.buf[(start + i) % this.capacity]
  }

  /** Newest sample, or 0 when empty. */
  last(): number {
    return this.count ? this.at(this.count - 1) : 0
  }

  /** Chronological copy. Allocates, so it is for React consumers only. */
  toArray(): number[] {
    const out = new Array<number>(this.count)
    for (let i = 0; i < this.count; i++) out[i] = this.at(i)
    return out
  }

  clear(): void {
    this.head = 0
    this.count = 0
  }
}

export interface MuseLatest {
  connected: boolean
  meta: MetaMessage | null
  frame: FrameMessage | null
  error: string | null
  /** `performance.now()` of arrival, so consumers can tell how stale a frame is. */
  receivedAt: number
  /** Bumped per frame — a render loop compares this instead of object identity. */
  seq: number
}

class MuseBus {
  /** Stable identity on purpose: read it from a render loop, never copy it. */
  readonly latest: MuseLatest = {
    connected: false,
    meta: null,
    frame: null,
    error: null,
    receivedAt: 0,
    seq: 0,
  }

  readonly focus = new Ring(HISTORY_LEN)
  readonly calm = new Ring(HISTORY_LEN)
  readonly alpha = new Ring(HISTORY_LEN)
  readonly hr = new Ring(HISTORY_LEN)
  readonly eeg: Ring[] = Array.from({ length: CHANNEL_COUNT }, () => new Ring(MAX_EEG_SAMPLES))

  private listeners = new Set<(latest: MuseLatest) => void>()
  private ws: WebSocket | null = null
  private retry = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  /**
   * Idempotent. The socket is deliberately never torn down once opened: this is
   * an app-wide singleton, and closing it on the last unmount would make React's
   * development remount cycle churn a connection.
   */
  start(): void {
    if (this.ws || this.timer) return
    this.connect()
  }

  subscribe(fn: (latest: MuseLatest) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private connect = (): void => {
    this.timer = undefined
    const ws = new WebSocket(WS_URL)
    this.ws = ws

    ws.onopen = () => {
      this.latest.connected = true
      this.latest.error = null
      this.retry = 0
      this.emit()
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerMessage
        if (msg.type === 'meta') {
          this.latest.meta = msg
        } else if (msg.type === 'frame') {
          this.ingest(msg)
        } else {
          return
        }
        this.emit()
      } catch (e) {
        console.warn('bad ws message', e)
      }
    }

    ws.onerror = () => {
      this.latest.error = 'WebSocket error — is the backend running on :8000?'
      this.emit()
    }

    ws.onclose = () => {
      this.ws = null
      this.latest.connected = false
      this.emit()
      const delay = Math.min(5000, 500 * 2 ** this.retry)
      this.retry += 1
      this.timer = setTimeout(this.connect, delay)
    }
  }

  private ingest(frame: FrameMessage): void {
    this.latest.frame = frame
    this.latest.receivedAt = performance.now()
    this.latest.seq += 1

    this.focus.push(frame.indices.focus)
    this.calm.push(frame.indices.calm)
    this.alpha.push(frame.indices.alpha_abs)
    if (frame.heart.hr > 0) this.hr.push(frame.heart.hr)

    const chunks = frame.eeg.new
    for (let ci = 0; ci < CHANNEL_COUNT; ci++) {
      const chunk = chunks[ci]
      if (!chunk) continue
      const ring = this.eeg[ci]
      for (let i = 0; i < chunk.length; i++) ring.push(chunk[i])
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.latest)
  }
}

export const museBus = new MuseBus()
