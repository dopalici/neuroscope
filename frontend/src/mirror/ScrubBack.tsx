import { useEffect, useRef } from 'react'
import { downloadSession } from '../state/mirror/recorder'
import type { Session } from '../state/mirror/recorder'

interface Props {
  session: Session
  onClose: () => void
}

/**
 * Scrub back through what just happened, with the coherence ribbon underneath.
 *
 * This is what the sidecar buys: the ribbon is drawn straight from the JSONL,
 * so clicking the moment you drifted seeks the video to it. Without the
 * sidecar you would be scrubbing a video looking for a face that looks vaguely
 * more smeared than the last one.
 */
export function ScrubBack({ session, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const ribbonRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ribbonRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const width = parent.clientWidth
      const height = 54
      const pw = Math.max(1, Math.floor(width * dpr))
      const ph = Math.max(1, Math.floor(height * dpr))
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const lines = session.sidecar
      if (lines.length < 2) return
      const span = lines[lines.length - 1].t || 1

      ctx.beginPath()
      ctx.moveTo(0, height)
      for (const line of lines) {
        ctx.lineTo((line.t / span) * width, height - line.coherence * (height - 6) - 3)
      }
      ctx.lineTo(width, height)
      ctx.closePath()
      const grad = ctx.createLinearGradient(0, 0, 0, height)
      grad.addColorStop(0, 'rgba(216, 167, 93, 0.42)')
      grad.addColorStop(1, 'rgba(216, 167, 93, 0.02)')
      ctx.fillStyle = grad
      ctx.fill()

      ctx.beginPath()
      for (const [i, line] of lines.entries()) {
        const x = (line.t / span) * width
        const y = height - line.coherence * (height - 6) - 3
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = '#d8a75d'
      ctx.lineWidth = 1.3
      ctx.stroke()

      // Where the veto had the picture fogged — the parts you should not read
      // as a brain state.
      ctx.fillStyle = 'rgba(168, 69, 47, 0.35)'
      for (const line of lines) {
        if ((line.drives.fog ?? 0) < 0.35) continue
        ctx.fillRect((line.t / span) * width, 0, Math.max(1, width / lines.length), height)
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [session])

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video) return
    const box = event.currentTarget.getBoundingClientRect()
    const t = ((event.clientX - box.left) / box.width) * (session.durationMs / 1000)
    video.currentTime = Math.max(0, t)
    void video.play()
  }

  return (
    <div className="scrub">
      <div className="scrub-inner">
        <header className="scrub-head">
          <h2>Session</h2>
          <span className="mono">
            {(session.durationMs / 1000).toFixed(1)} s · {session.sidecar.length} sidecar frames
          </span>
          <button type="button" onClick={() => downloadSession(session)}>
            Download video + JSONL
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <video ref={videoRef} src={session.videoUrl} controls playsInline />
        <div className="scrub-ribbon" onClick={seek} role="presentation">
          <canvas ref={ribbonRef} />
          <span className="scrub-ribbon-label mono">coherence · click to jump</span>
        </div>
      </div>
    </div>
  )
}
