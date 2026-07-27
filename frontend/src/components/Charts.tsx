import { useEffect, useRef } from 'react'

interface Props {
  series: number[][]
  colors: string[]
  labels?: string[]
  height?: number
  yRange?: number // ±uV half-range; auto if omitted
  grid?: boolean
}

/** Scrolling multi-channel line chart drawn on canvas (fast enough for EEG). */
export function MultiTrace({
  series,
  colors,
  labels,
  height = 220,
  yRange,
  grid = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const dpr = window.devicePixelRatio || 1
    const w = parent.clientWidth
    const h = height
    canvas.width = Math.max(1, Math.floor(w * dpr))
    canvas.height = Math.max(1, Math.floor(h * dpr))
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // Background
    ctx.fillStyle = 'rgba(8, 14, 22, 0.55)'
    ctx.fillRect(0, 0, w, h)

    const nCh = series.length
    if (!nCh) return
    const laneH = h / nCh
    const maxLen = Math.max(...series.map((s) => s.length), 1)

    // Auto range from data if not provided
    let amp = yRange ?? 0
    if (!yRange) {
      let peak = 1
      for (const s of series) {
        for (const v of s) peak = Math.max(peak, Math.abs(v))
      }
      amp = Math.max(40, Math.ceil(peak / 20) * 20)
    }

    for (let ci = 0; ci < nCh; ci++) {
      const y0 = ci * laneH
      const mid = y0 + laneH / 2

      if (grid) {
        ctx.strokeStyle = 'rgba(120, 150, 180, 0.12)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, mid)
        ctx.lineTo(w, mid)
        ctx.stroke()
        if (ci > 0) {
          ctx.beginPath()
          ctx.moveTo(0, y0)
          ctx.lineTo(w, y0)
          ctx.stroke()
        }
      }

      if (labels?.[ci]) {
        ctx.fillStyle = colors[ci] ?? '#9ab'
        ctx.font = '500 11px "JetBrains Mono", monospace'
        ctx.fillText(labels[ci], 8, y0 + 14)
      }

      const data = series[ci]
      if (!data.length) continue

      ctx.strokeStyle = colors[ci] ?? '#7ec8e3'
      ctx.lineWidth = 1.25
      ctx.beginPath()
      const start = Math.max(0, maxLen - data.length)
      for (let i = 0; i < data.length; i++) {
        const x = ((start + i) / (maxLen - 1 || 1)) * (w - 1)
        const y = mid - (data[i] / amp) * (laneH * 0.42)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }, [series, colors, labels, height, yRange, grid])

  return <canvas ref={canvasRef} className="trace-canvas" />
}

interface SparkProps {
  data: number[]
  color?: string
  height?: number
  fill?: boolean
}

export function Sparkline({ data, color = '#3db8a0', height = 56, fill = true }: SparkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const dpr = window.devicePixelRatio || 1
    const w = parent.clientWidth
    const h = height
    canvas.width = Math.max(1, Math.floor(w * dpr))
    canvas.height = Math.max(1, Math.floor(h * dpr))
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    if (data.length < 2) return
    const min = Math.min(...data)
    const max = Math.max(...data)
    const span = max - min || 1
    const pad = 4

    const pts = data.map((v, i) => ({
      x: (i / (data.length - 1)) * (w - 1),
      y: pad + (1 - (v - min) / span) * (h - pad * 2),
    }))

    if (fill) {
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, color + '55')
      grad.addColorStop(1, color + '00')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(pts[0].x, h)
      pts.forEach((p) => ctx.lineTo(p.x, p.y))
      ctx.lineTo(pts[pts.length - 1].x, h)
      ctx.closePath()
      ctx.fill()
    }

    ctx.strokeStyle = color
    ctx.lineWidth = 1.75
    ctx.beginPath()
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
  }, [data, color, height, fill])

  return <canvas ref={canvasRef} className="trace-canvas" />
}
