import { useEffect, useRef } from 'react'
import { atmosphere } from '../state/atmosphere'

/**
 * Sizes a canvas to its parent and returns a ready 2D context.
 *
 * Assigning canvas.width/height reallocates the backing bitmap, so it only
 * happens when the box actually changed — otherwise every 10 Hz frame would
 * throw away and reallocate the buffer.
 */
function prepare(canvas: HTMLCanvasElement, height: number) {
  const parent = canvas.parentElement
  if (!parent) return null
  const width = parent.clientWidth
  if (width <= 0) return null

  const dpr = window.devicePixelRatio || 1
  const pixelW = Math.max(1, Math.floor(width * dpr))
  const pixelH = Math.max(1, Math.floor(height * dpr))
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW
    canvas.height = pixelH
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return { ctx, width, height }
}

/** Redraws on data change and on container resize, never on a timer. */
function useCanvasDraw(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  height: number,
  deps: readonly unknown[],
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const render = () => {
      const surface = prepare(canvas, height)
      if (surface) drawRef.current(surface.ctx, surface.width, surface.height)
    }
    render()

    const parent = canvas.parentElement
    if (!parent) return
    const observer = new ResizeObserver(render)
    observer.observe(parent)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, ...deps])

  return canvasRef
}

/** Live state hue with an offset, as an hsl() string. */
function tint(hueOffset: number, satScale = 1, lightScale = 1, alpha = 1) {
  const { h, s, l } = atmosphere.live
  const hue = (((h + hueOffset) % 360) + 360) % 360
  const sat = Math.min(82, s * satScale + 18)
  const light = Math.min(86, l * lightScale + 20)
  return alpha >= 1
    ? `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`
    : `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}% / ${alpha})`
}

interface Props {
  series: number[][]
  hueOffsets: number[]
  labels?: string[]
  height?: number
  yRange?: number
}

/** Scrolling multi-channel EEG traces, drawn as ink on warm ground. */
export function MultiTrace({ series, hueOffsets, labels, height = 220, yRange }: Props) {
  const canvasRef = useCanvasDraw(
    (ctx, w, h) => {
      const lanes = series.length
      if (!lanes) return
      const laneH = h / lanes

      let maxLen = 1
      for (const s of series) if (s.length > maxLen) maxLen = s.length

      let amp = yRange ?? 0
      if (!yRange) {
        let peak = 1
        for (const s of series) {
          for (let i = 0; i < s.length; i++) {
            const v = s[i] < 0 ? -s[i] : s[i]
            if (v > peak) peak = v
          }
        }
        amp = Math.max(40, Math.ceil(peak / 20) * 20)
      }

      for (let ci = 0; ci < lanes; ci++) {
        const top = ci * laneH
        const mid = top + laneH / 2
        const color = tint(hueOffsets[ci] ?? 0)

        ctx.strokeStyle = tint(hueOffsets[ci] ?? 0, 0.5, 0.5, 0.16)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, mid)
        ctx.lineTo(w, mid)
        ctx.stroke()

        if (labels?.[ci]) {
          ctx.fillStyle = tint(hueOffsets[ci] ?? 0, 0.8, 1, 0.75)
          ctx.font = '500 10px "JetBrains Mono", monospace'
          ctx.fillText(labels[ci], 6, top + 13)
        }

        const data = series[ci]
        if (!data.length) continue

        ctx.strokeStyle = color
        ctx.lineWidth = 1.35
        ctx.lineJoin = 'round'
        ctx.beginPath()
        const start = maxLen - data.length
        const span = maxLen - 1 || 1
        for (let i = 0; i < data.length; i++) {
          const x = ((start + i) / span) * (w - 1)
          const y = mid - (data[i] / amp) * (laneH * 0.4)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    },
    height,
    [series, hueOffsets, labels, yRange],
  )

  return <canvas ref={canvasRef} className="trace-canvas" />
}

interface SparkProps {
  data: number[]
  /** Fixed colour, or omit to follow the live state hue. */
  color?: string
  hueOffset?: number
  height?: number
  fill?: boolean
}

export function Sparkline({ data, color, hueOffset = 0, height = 56, fill = true }: SparkProps) {
  const canvasRef = useCanvasDraw(
    (ctx, w, h) => {
      if (data.length < 2) return

      let min = data[0]
      let max = data[0]
      for (let i = 1; i < data.length; i++) {
        if (data[i] < min) min = data[i]
        if (data[i] > max) max = data[i]
      }
      const span = max - min || 1
      const pad = 4
      const stroke = color ?? tint(hueOffset)

      const xs = new Float32Array(data.length)
      const ys = new Float32Array(data.length)
      for (let i = 0; i < data.length; i++) {
        xs[i] = (i / (data.length - 1)) * (w - 1)
        ys[i] = pad + (1 - (data[i] - min) / span) * (h - pad * 2)
      }

      if (fill) {
        const grad = ctx.createLinearGradient(0, 0, 0, h)
        grad.addColorStop(0, color ? `${color}44` : tint(hueOffset, 1, 1, 0.28))
        grad.addColorStop(1, color ? `${color}00` : tint(hueOffset, 1, 1, 0))
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(xs[0], h)
        for (let i = 0; i < xs.length; i++) ctx.lineTo(xs[i], ys[i])
        ctx.lineTo(xs[xs.length - 1], h)
        ctx.closePath()
        ctx.fill()
      }

      ctx.strokeStyle = stroke
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.beginPath()
      for (let i = 0; i < xs.length; i++) {
        if (i === 0) ctx.moveTo(xs[i], ys[i])
        else ctx.lineTo(xs[i], ys[i])
      }
      ctx.stroke()
    },
    height,
    [data, color, hueOffset, fill],
  )

  return <canvas ref={canvasRef} className="trace-canvas" />
}
