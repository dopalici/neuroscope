/**
 * Recording, plus the sidecar that turns the output from a video into a
 * document.
 *
 * One JSONL line per captured frame: the raw indices, the derived drives, and
 * every parameter value at that instant. Forty lines of code that buy the
 * scrub-back timeline, offline re-grading, and the ability to answer "what was
 * my signal doing at 04:12" without guessing from the picture.
 */
import type { Drives } from './mapping'

export type RecorderStatus = 'idle' | 'recording' | 'ready' | 'unsupported'

export interface SidecarLine {
  /** Milliseconds from the start of the recording. */
  t: number
  focus: number
  calm: number
  faa: number
  alphaAbs: number
  hr: number
  coherence: number
  drives: Record<string, number>
  params: Record<string, number>
}

export interface Session {
  videoUrl: string
  videoMime: string
  extension: string
  durationMs: number
  sidecar: SidecarLine[]
  sidecarUrl: string
  startedAt: number
}

export interface SampleInput {
  focus: number
  calm: number
  faa: number
  alphaAbs: number
  hr: number
  drives: Drives
  params: Readonly<Record<string, number>>
}

/** Safari will not give WebM, so mp4 is the last stop rather than a failure. */
const CANDIDATES: readonly { mime: string; extension: string }[] = [
  { mime: 'video/webm;codecs=vp9', extension: 'webm' },
  { mime: 'video/webm;codecs=vp8', extension: 'webm' },
  { mime: 'video/webm', extension: 'webm' },
  { mime: 'video/mp4', extension: 'mp4' },
]

const FPS = 30
const SAMPLE_INTERVAL_MS = 1000 / FPS

export function pickMime(): { mime: string; extension: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const candidate of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.mime)) return candidate
  }
  return null
}

export class MirrorRecorder {
  status: RecorderStatus = pickMime() ? 'idle' : 'unsupported'
  session: Session | null = null
  startedAt = 0

  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private sidecar: SidecarLine[] = []
  private lastSample = 0
  private listeners = new Set<() => void>()

  get elapsedMs(): number {
    return this.status === 'recording' ? performance.now() - this.startedAt : 0
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  start(canvas: HTMLCanvasElement): void {
    if (this.status === 'recording' || this.status === 'unsupported') return
    const picked = pickMime()
    if (!picked) {
      this.status = 'unsupported'
      this.emit()
      return
    }

    this.revoke()
    this.chunks = []
    this.sidecar = []
    this.session = null
    this.startedAt = performance.now()
    this.lastSample = 0

    // `captureStream` reads the composited canvas, so nothing here needs
    // `preserveDrawingBuffer` and the render path pays nothing when idle.
    const stream = canvas.captureStream(FPS)
    const recorder = new MediaRecorder(stream, {
      mimeType: picked.mime,
      videoBitsPerSecond: 8_000_000,
    })
    recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: picked.mime })
      const jsonl = this.sidecar.map((line) => JSON.stringify(line)).join('\n')
      this.session = {
        videoUrl: URL.createObjectURL(blob),
        videoMime: picked.mime,
        extension: picked.extension,
        durationMs: performance.now() - this.startedAt,
        sidecar: this.sidecar,
        sidecarUrl: URL.createObjectURL(new Blob([jsonl], { type: 'application/x-ndjson' })),
        startedAt: Date.now(),
      }
      this.status = 'ready'
      this.emit()
    }

    recorder.start(1000)
    this.recorder = recorder
    this.status = 'recording'
    this.emit()
  }

  stop(): void {
    if (this.status !== 'recording') return
    this.recorder?.stop()
    this.recorder = null
  }

  /** Called every render frame; writes a line at the recording's own rate. */
  sample(input: SampleInput): void {
    if (this.status !== 'recording') return
    const now = performance.now()
    const t = now - this.startedAt
    if (t - this.lastSample < SAMPLE_INTERVAL_MS) return
    this.lastSample = t

    const drives: Record<string, number> = {}
    for (const key in input.drives) drives[key] = round(input.drives[key as keyof Drives])
    const params: Record<string, number> = {}
    for (const key in input.params) params[key] = round(input.params[key])

    this.sidecar.push({
      t: Math.round(t),
      focus: round(input.focus),
      calm: round(input.calm),
      faa: round(input.faa),
      alphaAbs: round(input.alphaAbs),
      hr: round(input.hr),
      coherence: round(input.drives.coherence),
      drives,
      params,
    })
  }

  discard(): void {
    this.revoke()
    this.session = null
    this.status = pickMime() ? 'idle' : 'unsupported'
    this.emit()
  }

  private revoke(): void {
    if (!this.session) return
    URL.revokeObjectURL(this.session.videoUrl)
    URL.revokeObjectURL(this.session.sidecarUrl)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}

export function downloadSession(session: Session): void {
  const stamp = new Date(session.startedAt)
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19)
  save(session.videoUrl, `mirror-${stamp}.${session.extension}`)
  save(session.sidecarUrl, `mirror-${stamp}.jsonl`)
}

function save(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}

function round(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0
}
