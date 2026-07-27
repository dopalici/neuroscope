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
  heart: { hr: number; hrv: number; n_beats: number }
  motion: { motion: number; posture: number; still: boolean }
}

export type ServerMessage = MetaMessage | FrameMessage

export const BAND_ORDER = ['delta', 'theta', 'alpha', 'beta', 'gamma'] as const
export type BandName = (typeof BAND_ORDER)[number]

export const BAND_COLORS: Record<BandName, string> = {
  delta: '#5b8def',
  theta: '#3db8a0',
  alpha: '#e8b84a',
  beta: '#e07a45',
  gamma: '#c45c8a',
}

export const CHANNEL_COLORS: Record<string, string> = {
  TP9: '#5b8def',
  AF7: '#3db8a0',
  AF8: '#e8b84a',
  TP10: '#e07a45',
}
