import { useEffect, useState } from 'react'
import { museBus } from '../state/museBus'
import type { FrameMessage, MetaMessage } from '../types'

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

function snapshot(): StreamState {
  const { connected, meta, frame, error } = museBus.latest
  return {
    connected,
    meta,
    frame,
    // Fresh arrays every frame: the canvases key their redraw off identity, and
    // the ring buffers themselves must stay off the React side of the fence.
    eegBuffers: museBus.eeg.map((ring) => ring.toArray()),
    focusHistory: museBus.focus.toArray(),
    calmHistory: museBus.calm.toArray(),
    alphaHistory: museBus.alpha.toArray(),
    hrHistory: museBus.hr.toArray(),
    error,
  }
}

/** React view of the signal bus. The socket itself lives in `museBus`. */
export function useMuseStream(): StreamState {
  const [state, setState] = useState<StreamState>(snapshot)

  useEffect(() => {
    museBus.start()
    return museBus.subscribe(() => setState(snapshot()))
  }, [])

  return state
}
