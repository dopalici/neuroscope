/**
 * Hand tracking as a controller object rather than React state.
 *
 * Gesture positions change 18 times a second and would re-render the whole
 * mirror if they went through `useState`. Only the *status* is React state;
 * everything continuous lives on a mutable object the render loop reads, the
 * same trade the atmosphere engine makes with colour.
 */
import { useEffect, useRef, useState } from 'react'
import { GestureRecognizer } from './gestures'
import type { GestureEvent, GestureState } from './gestures'
import type { HandFrame, WorkerIn, WorkerOut } from './handWorker'

export type HandsStatus = 'off' | 'loading' | 'ready' | 'error'

export interface HandsController {
  status: HandsStatus
  message: string | null
  /** Mutable; read it from a loop, never copy it into state. */
  state: GestureState
}

/** 18 Hz: hands do not move fast enough to need more, and the GPU has work. */
const CAPTURE_INTERVAL_MS = 55
const INPUT_SIZE = 256

interface Options {
  video: HTMLVideoElement | null
  enabled: boolean
  face?: boolean
  onEvent?: (event: GestureEvent) => void
}

export function useHands({ video, enabled, face = false, onEvent }: Options): HandsController {
  const [status, setStatus] = useState<HandsStatus>('off')
  const [message, setMessage] = useState<string | null>(null)
  const recognizer = useRef<GestureRecognizer>(null)
  recognizer.current ??= new GestureRecognizer()

  const eventRef = useRef(onEvent)
  eventRef.current = onEvent

  useEffect(() => {
    if (!enabled || !video) {
      setStatus('off')
      return
    }

    let disposed = false
    let pending: HandFrame | null = null
    let capturing = false
    setStatus('loading')
    setMessage('loading hand model…')

    const worker = new Worker(new URL('./handWorker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (event: MessageEvent<WorkerOut>) => {
      const data = event.data
      if (data.type === 'ready') {
        setStatus('ready')
        setMessage(null)
      } else if (data.type === 'result') {
        pending = data
      } else {
        setStatus('error')
        setMessage(data.message)
      }
    }

    worker.onerror = (e) => {
      setStatus('error')
      // Prefer the real message; "Script error." is what you get when the
      // worker dies before it can post — usually a missing WASM/module load.
      const detail = [e.message, e.filename, e.lineno].filter(Boolean).join(' · ')
      setMessage(detail || 'hand tracking failed to start')
    }

    worker.onmessageerror = () => {
      setStatus('error')
      setMessage('hand worker message could not be deserialized')
    }

    post(worker, { type: 'init', face })

    const capture = async () => {
      if (disposed || capturing || video.readyState < 2) return
      capturing = true
      try {
        const bitmap = await createImageBitmap(video, {
          resizeWidth: INPUT_SIZE,
          resizeHeight: INPUT_SIZE,
          resizeQuality: 'low',
        })
        if (disposed) {
          bitmap.close()
          return
        }
        worker.postMessage({ type: 'frame', bitmap, t: performance.now() }, [bitmap])
      } catch {
        // A closed track or a backgrounded tab; the next tick tries again.
      } finally {
        capturing = false
      }
    }

    const tick = () => {
      void capture()
      const state = recognizer.current!.update(pending, performance.now() / 1000)
      pending = null
      const handler = eventRef.current
      if (handler) for (const gestureEvent of state.events) handler(gestureEvent)
    }

    const timer = setInterval(tick, CAPTURE_INTERVAL_MS)

    return () => {
      disposed = true
      clearInterval(timer)
      // No 'close' handshake: terminate never runs another task, so the message
      // would sit in a queue that is about to be discarded anyway.
      worker.terminate()
      setStatus('off')
    }
  }, [enabled, video, face])

  return { status, message, state: recognizer.current.state }
}

function post(worker: Worker, message: WorkerIn): void {
  worker.postMessage(message)
}
