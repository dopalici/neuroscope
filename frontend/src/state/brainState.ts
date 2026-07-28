/**
 * Terra state system — turns live signal values into one word and one hue.
 *
 * Every section speaks the same language: a short interpretive word, a note,
 * and a point in a neutral earth-tone hue space (HSL). Nothing here invents
 * data — each state is a readable band of the same numbers the panels show.
 * The words are deliberately interpretive, not diagnostic.
 */
import { BAND_ORDER } from '../types'
import type { BandName, FrameMessage } from '../types'

export type SectionId = 'signal' | 'bands' | 'focus' | 'artifacts' | 'heart' | 'nf'

export interface BrainState {
  /** Stable identity — the badge only re-renders when this changes. */
  key: string
  word: string
  note: string
  h: number
  s: number
  l: number
  /** 0–1, drives glow strength and bloom size. */
  intensity: number
  /** Momentary events hold the badge this many ms so words don't flicker. */
  hold?: number
}

export const SECTION_LABELS: Record<SectionId, string> = {
  signal: '01 · Signal',
  bands: '02 · Bands',
  focus: '03 · Focus',
  artifacts: '04 · Body',
  heart: '05 · Heart',
  nf: '06 · Feedback',
}

export const NEUTRAL: BrainState = {
  key: 'neutral',
  word: 'Waiting',
  note: 'no signal yet',
  h: 34,
  s: 8,
  l: 46,
  intensity: 0,
}

export function deriveState(section: SectionId, frame: FrameMessage | null): BrainState {
  if (!frame) return NEUTRAL
  switch (section) {
    case 'signal':
      return signalState(frame)
    case 'bands':
      return bandState(frame)
    case 'focus':
      return focusState(frame)
    case 'artifacts':
      return bodyState(frame)
    case 'heart':
      return heartState(frame)
    case 'nf':
      return feedbackState(frame)
  }
}

/* —— 01 Signal: how well the four electrodes are seated —— */

function signalState(frame: FrameMessage): BrainState {
  const pads = Object.values(frame.quality)
  if (!pads.length) return NEUTRAL

  let score = 0
  for (const pad of pads) {
    score += pad.label === 'green' ? 1 : pad.label === 'amber' ? 0.5 : 0
  }
  score /= pads.length

  if (score >= 0.95)
    return {
      key: 'clear',
      word: 'Clear',
      note: 'all four contacts seated',
      h: 62,
      s: 30,
      l: 54,
      intensity: 1,
    }
  if (score >= 0.7)
    return {
      key: 'seated',
      word: 'Seated',
      note: 'good contact, some noise',
      h: 40,
      s: 44,
      l: 55,
      intensity: 0.72,
    }
  if (score >= 0.4)
    return {
      key: 'settling',
      word: 'Settling',
      note: 'pads still finding skin',
      h: 26,
      s: 34,
      l: 48,
      intensity: 0.45,
    }
  return {
    key: 'drifting',
    word: 'Drifting',
    note: 'electrodes loose or floating',
    h: 28,
    s: 12,
    l: 38,
    intensity: 0.18,
  }
}

/* —— 02 Bands: which rhythm leads, relative to a typical 1/f profile —— */

/**
 * Absolute EEG power always falls off with frequency, so raw argmax would read
 * "delta" forever. Each band is compared against its share in a typical resting
 * spectrum instead, so a genuine alpha rise actually surfaces as a state.
 */
const BAND_REFERENCE: Record<BandName, number> = {
  delta: 0.42,
  theta: 0.22,
  alpha: 0.16,
  beta: 0.15,
  gamma: 0.05,
}

const BAND_STATES: Record<BandName, Omit<BrainState, 'intensity'>> = {
  delta: { key: 'deep', word: 'Deep', note: 'slow delta leads', h: 22, s: 30, l: 33 },
  theta: { key: 'drift', word: 'Drift', note: 'theta — inward, drowsy', h: 84, s: 20, l: 41 },
  alpha: { key: 'open', word: 'Open', note: 'alpha — idle, restful', h: 40, s: 50, l: 57 },
  beta: { key: 'sharp', word: 'Sharp', note: 'beta — alert processing', h: 18, s: 48, l: 52 },
  gamma: { key: 'bright', word: 'Bright', note: 'fast rhythms (or muscle)', h: 8, s: 52, l: 50 },
}

function bandState(frame: FrameMessage): BrainState {
  const avg = frame.bands_avg
  let total = 0
  for (const band of BAND_ORDER) total += avg[band] ?? 0
  if (total <= 1e-9) return NEUTRAL

  let lead: BandName = 'delta'
  let best = 0
  for (const band of BAND_ORDER) {
    const ratio = (avg[band] ?? 0) / total / BAND_REFERENCE[band]
    if (ratio > best) {
      best = ratio
      lead = band
    }
  }

  return { ...BAND_STATES[lead], intensity: clamp01((best - 1) / 1.1) }
}

/* —— 03 Focus: engagement (β/α) against restfulness (relative α) —— */

function focusState(frame: FrameMessage): BrainState {
  const engaged = clamp01(frame.indices.focus / 2.2)
  const restful = clamp01(frame.indices.calm / 0.6)
  const intensity = Math.max(engaged, restful)

  if (engaged < 0.2 && restful < 0.2)
    return {
      key: 'adrift',
      word: 'Adrift',
      note: 'no clear tilt either way',
      h: 32,
      s: 8,
      l: 45,
      intensity: 0.15,
    }

  const tilt = engaged - restful
  if (tilt > 0.45)
    return {
      key: 'charged',
      word: 'Charged',
      note: 'beta well above alpha',
      h: 10,
      s: 55,
      l: 50,
      intensity,
    }
  if (tilt > 0.12)
    return {
      key: 'engaged',
      word: 'Engaged',
      note: 'leaning alert',
      h: 20,
      s: 48,
      l: 52,
      intensity,
    }
  if (tilt < -0.3)
    return {
      key: 'soft',
      word: 'Soft',
      note: 'alpha-rich, unhurried',
      h: 88,
      s: 24,
      l: 46,
      intensity,
    }
  return { key: 'even', word: 'Even', note: 'focus and calm balanced', h: 44, s: 40, l: 56, intensity }
}

/* —— 04 Body: blinks and jaw EMG read as signal, not noise —— */

function bodyState(frame: FrameMessage): BrainState {
  const a = frame.artifacts
  if (a.jaw)
    return {
      key: 'clench',
      word: 'Clench',
      note: 'jaw EMG burst on TP9/TP10',
      h: 12,
      s: 50,
      l: 48,
      intensity: 0.9,
      hold: 900,
    }
  if (a.blink)
    return {
      key: 'blink',
      word: 'Blink',
      note: 'slow frontal deflection',
      h: 44,
      s: 45,
      l: 68,
      intensity: 0.8,
      hold: 550,
    }
  if (a.blink_rate + a.jaw_rate > 28)
    return {
      key: 'restless',
      word: 'Restless',
      note: 'frequent body artifacts',
      h: 26,
      s: 35,
      l: 48,
      intensity: 0.55,
    }
  return { key: 'still', word: 'Still', note: 'face and jaw quiet', h: 80, s: 16, l: 42, intensity: 0.25 }
}

/* —— 05 Heart: PPG rate read alongside head motion —— */

function heartState(frame: FrameMessage): BrainState {
  const { hr } = frame.heart
  const { still } = frame.motion

  if (hr <= 0)
    return {
      key: 'listening',
      word: 'Listening',
      note: 'no PPG beats yet',
      h: 34,
      s: 8,
      l: 45,
      intensity: 0.1,
    }
  if (!still)
    return {
      key: 'stirring',
      word: 'Stirring',
      note: 'head moving — expect artifacts',
      h: 24,
      s: 42,
      l: 52,
      intensity: 0.7,
    }
  if (hr >= 100)
    return { key: 'racing', word: 'Racing', note: `${hr.toFixed(0)} bpm at rest`, h: 8, s: 55, l: 50, intensity: 1 }
  if (hr <= 64)
    return { key: 'settled', word: 'Settled', note: `${hr.toFixed(0)} bpm, still`, h: 92, s: 22, l: 44, intensity: 0.4 }
  return { key: 'steady', word: 'Steady', note: `${hr.toFixed(0)} bpm, still`, h: 40, s: 45, l: 55, intensity: 0.6 }
}

/* —— 06 Feedback: the same calm index the bloom is driven by —— */

export function feedbackScore(frame: FrameMessage | null): number {
  return clamp01(((frame?.indices.calm ?? 0) - 0.15) / 0.45)
}

function feedbackState(frame: FrameMessage): BrainState {
  const score = feedbackScore(frame)
  if (score < 0.25)
    return { key: 'quiet', word: 'Quiet', note: 'little relative alpha', h: 34, s: 10, l: 45, intensity: score }
  if (score < 0.5)
    return { key: 'easing', word: 'Easing', note: 'alpha starting to lift', h: 86, s: 24, l: 46, intensity: score }
  if (score < 0.75)
    return { key: 'opening', word: 'Opening', note: 'alpha holding steady', h: 42, s: 45, l: 58, intensity: score }
  return { key: 'blooming', word: 'Blooming', note: 'strong relative alpha', h: 38, s: 58, l: 63, intensity: score }
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
