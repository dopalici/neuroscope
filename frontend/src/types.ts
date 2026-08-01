export type QualityLabel = 'green' | 'amber' | 'red'

export interface MetaMessage {
  type: 'meta'
  source: string
  simulated: boolean
  channels: string[]
  eeg_fs: number
  ppg_fs: number
  imu_fs: number
  bands: Record<string, [number, number]>
  window_seconds: number
  update_rate_hz: number
  raw_display_seconds: number
}

export interface FrameMessage {
  type: 'frame'
  t: number
  eeg: { channels: string[]; fs: number; new: number[][] }
  bands: Record<string, Record<string, number>>
  bands_avg: Record<string, number>
  quality: Record<string, { label: QualityLabel; uv: number }>
  indices: { focus: number; calm: number; faa: number; alpha_abs: number }
  artifacts: {
    blink: boolean
    jaw: boolean
    blink_mag: number
    jaw_mag: number
    blink_threshold: number
    jaw_threshold: number
    blink_total: number
    jaw_total: number
    blink_rate: number
    jaw_rate: number
  }
  /** Per-channel RMS µV over the newest ~100 ms — the only sub-second drive. */
  envelope: Record<string, number>
  /** `beats` are epoch seconds per detected PPG peak, newest last. */
  heart: { hr: number; hrv: number; n_beats: number; beats: number[] }
  motion: { motion: number; posture: number; still: boolean }
}

export type ServerMessage = MetaMessage | FrameMessage

export const BAND_ORDER = ['delta', 'theta', 'alpha', 'beta', 'gamma'] as const
export type BandName = (typeof BAND_ORDER)[number]

/** Earth-tone band identities: soil → moss → ochre → clay → rust. */
export const BAND_COLORS: Record<BandName, string> = {
  delta: '#7c6247',
  theta: '#848c5c',
  alpha: '#d8a75d',
  beta: '#c2703f',
  gamma: '#a8452f',
}

/** Hue offsets from the live state colour, so traces breathe with the state. */
export const CHANNEL_HUE_OFFSETS: Record<string, number> = {
  TP9: -18,
  AF7: -6,
  AF8: 8,
  TP10: 22,
}
