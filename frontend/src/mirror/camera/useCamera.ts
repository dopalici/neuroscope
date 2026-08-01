/**
 * The camera, as a state machine rather than a promise that might throw.
 *
 * Denial and absence are ordinary outcomes here — a mirror that crashes when
 * you say no is worse than one that explains itself — so every failure resolves
 * to a status the UI can render.
 */
import { useEffect, useRef, useState } from 'react'

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'denied'
  | 'missing'
  | 'insecure'
  | 'error'

export interface CameraState {
  video: HTMLVideoElement | null
  status: CameraStatus
  message: string | null
  /** Bump to retry after a denial the user has since reversed in site settings. */
  retry: () => void
}

const MESSAGES: Record<CameraStatus, string | null> = {
  idle: null,
  requesting: 'asking for the camera…',
  ready: null,
  denied: 'Camera permission was refused. Allow it in the address bar, then retry.',
  missing: 'No camera was found on this machine.',
  insecure:
    'The camera needs a secure context. Use http://127.0.0.1:5173 or https, not a LAN IP.',
  error: 'The camera could not be started.',
}

const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 60 },
    facingMode: 'user',
  },
}

export function useCamera(enabled: boolean): CameraState {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [attempt, setAttempt] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('insecure')
      return
    }

    let cancelled = false
    let stream: MediaStream | null = null
    setStatus('requesting')

    navigator.mediaDevices
      .getUserMedia(CONSTRAINTS)
      .then(async (s) => {
        if (cancelled) {
          for (const track of s.getTracks()) track.stop()
          return
        }
        stream = s
        // Detached on purpose: the element is only ever a texture source, and
        // putting a second copy of your face on screen would fight the canvas.
        const el = videoRef.current ?? document.createElement('video')
        el.playsInline = true
        el.muted = true
        el.autoplay = true
        el.srcObject = s
        videoRef.current = el
        await el.play().catch(() => undefined)
        if (cancelled) return
        setVideo(el)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const name = err instanceof DOMException ? err.name : ''
        if (name === 'NotAllowedError' || name === 'SecurityError') setStatus('denied')
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') setStatus('missing')
        else setStatus('error')
      })

    return () => {
      cancelled = true
      if (stream) for (const track of stream.getTracks()) track.stop()
      const el = videoRef.current
      if (el) el.srcObject = null
      setVideo(null)
    }
  }, [enabled, attempt])

  return {
    video: status === 'ready' ? video : null,
    status,
    message: MESSAGES[status],
    retry: () => setAttempt((n) => n + 1),
  }
}
