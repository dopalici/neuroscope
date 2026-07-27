import { useCallback, useEffect, useRef, useState } from 'react'
import type { FrameMessage, MetaMessage, ServerMessage } from '../types'

const WS_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  // In vite dev, proxy /ws → backend. In production, same host or override.
  const host = import.meta.env.VITE_WS_HOST || window.location.host
  return `${proto}://${host}/ws`
})()

const MAX_EEG_SAMPLES = 256 * 4 // ~4 s at 256 Hz
const HISTORY_LEN = 120 // ~12 s of index history at 10 Hz

export interface StreamState {
  connected: boolean
  meta: MetaMessage | null
  frame: FrameMessage | null
  eegBuffers: number[][] // 4 channels, rolling
  focusHistory: number[]
  calmHistory: number[]
  alphaHistory: number[]
  hrHistory: number[]
  error: string | null
}

export function useMuseStream(): StreamState {
  const [connected, setConnected] = useState(false)
  const [meta, setMeta] = useState<MetaMessage | null>(null)
  const [frame, setFrame] = useState<FrameMessage | null>(null)
  const [eegBuffers, setEegBuffers] = useState<number[][]>([[], [], [], []])
  const [focusHistory, setFocusHistory] = useState<number[]>([])
  const [calmHistory, setCalmHistory] = useState<number[]>([])
  const [alphaHistory, setAlphaHistory] = useState<number[]>([])
  const [hrHistory, setHrHistory] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const retryRef = useRef(0)
  const wsRef = useRef<WebSocket | null>(null)

  const pushHistory = useCallback((f: FrameMessage) => {
    setFocusHistory((h) => [...h, f.indices.focus].slice(-HISTORY_LEN))
    setCalmHistory((h) => [...h, f.indices.calm].slice(-HISTORY_LEN))
    setAlphaHistory((h) => [...h, f.indices.alpha_abs].slice(-HISTORY_LEN))
    if (f.heart.hr > 0) {
      setHrHistory((h) => [...h, f.heart.hr].slice(-HISTORY_LEN))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      if (cancelled) return
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled) return
        setConnected(true)
        setError(null)
        retryRef.current = 0
      }

      ws.onmessage = (ev) => {
        if (cancelled) return
        try {
          const msg = JSON.parse(ev.data) as ServerMessage
          if (msg.type === 'meta') {
            setMeta(msg)
          } else if (msg.type === 'frame') {
            setFrame(msg)
            pushHistory(msg)
            const news = msg.eeg.new
            setEegBuffers((prev) =>
              prev.map((buf, i) => {
                const chunk = news[i] ?? []
                if (!chunk.length) return buf
                const next = buf.concat(chunk)
                return next.length > MAX_EEG_SAMPLES
                  ? next.slice(next.length - MAX_EEG_SAMPLES)
                  : next
              }),
            )
          }
        } catch (e) {
          console.warn('bad ws message', e)
        }
      }

      ws.onerror = () => {
        setError('WebSocket error — is the backend running on :8000?')
      }

      ws.onclose = () => {
        if (cancelled) return
        setConnected(false)
        wsRef.current = null
        const delay = Math.min(5000, 500 * 2 ** retryRef.current)
        retryRef.current += 1
        timer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [pushHistory])

  return {
    connected,
    meta,
    frame,
    eegBuffers,
    focusHistory,
    calmHistory,
    alphaHistory,
    hrHistory,
    error,
  }
}
