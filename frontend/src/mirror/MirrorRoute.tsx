import { useCallback, useEffect, useRef, useState } from 'react'
import { navigate } from '../routes'
import { atmosphere } from '../state/atmosphere'
import { deriveState } from '../state/brainState'
import { museBus } from '../state/museBus'
import { aperture } from '../state/mirror/aperture'
import { baseline } from '../state/mirror/baseline'
import { MirrorMapping } from '../state/mirror/mapping'
import { ParamGraph } from '../state/mirror/params'
import { MirrorRecorder } from '../state/mirror/recorder'
import type { RecorderStatus, Session } from '../state/mirror/recorder'
import { BAND_ORDER } from '../types'
import { Calibrate } from './Calibrate'
import { ScrubBack } from './ScrubBack'
import { useCamera } from './camera/useCamera'
import { MirrorRenderer } from './gl/renderer'
import { useHands } from './hands/useHands'
import { dominantAxis } from './hands/gestures'
import type { GestureEvent, GestureState } from './hands/gestures'
import { ARC_LENGTH } from './hud/CoherenceArc'
import { Hud } from './hud/Hud'
import type { TickerEntry } from './hud/EventTicker'
import { hud } from './hud/hudBus'
import { ParamPanel } from './panel/ParamPanel'
import './Mirror.css'

const CHANNELS = ['TP9', 'AF7', 'AF8', 'TP10'] as const
const MAX_TICKER = 7
/** Numbers at 10 Hz, transforms at 60 — text reflow is the expensive half. */
const TEXT_INTERVAL_MS = 100
/** Thirty frames over budget in a row is a trend, not a hiccup. */
const SLOW_FRAME_MS = 20
const SLOW_FRAME_RUN = 30

export function MirrorRoute() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<MirrorRenderer | null>(null)
  const mapping = useConst(() => new MirrorMapping())
  const graph = useConst(() => new ParamGraph())
  const recorder = useConst(() => new MirrorRecorder())

  const [glError, setGlError] = useState<string | null>(null)
  const [hudVisible, setHudVisible] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [devVisible, setDevVisible] = useState(false)
  const [calOpen, setCalOpen] = useState(false)
  const [sham, setSham] = useState(false)
  // Open-window from the dashboard already proved the camera + hands path; keep
  // them on so the inverse close gesture works without hunting for a toggle.
  const [gesturesOn, setGesturesOn] = useState(() => aperture.consume())
  const [entries, setEntries] = useState<TickerEntry[]>([])
  const [recStatus, setRecStatus] = useState<RecorderStatus>(recorder.status)
  const [session, setSession] = useState<Session | null>(null)
  // Lifted out of the panel: the same pair drives the puck, the pinch-drag and
  // the readout, so they cannot disagree about which params are on the pad.
  const [xyIds, setXyIds] = useState<[string, string]>(['warpAmount', 'trail'])

  const camera = useCamera(true)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  videoRef.current = camera.video

  const onGesture = useCallback((event: GestureEvent) => {
    switch (event.type) {
      case 'window-close':
        aperture.commit()
        navigate('dashboard')
        break
      case 'hud-toggle':
        setHudVisible((v) => !v)
        break
      case 'activate': {
        // Dwell-to-click, resolved against whatever is actually under the
        // reticle — the HUD is real DOM, so the browser does the hit testing.
        const target = document.elementFromPoint(
          event.x * window.innerWidth,
          event.y * window.innerHeight,
        )
        if (target instanceof HTMLElement) target.click()
        break
      }
    }
  }, [])

  const hands = useHands({
    video: camera.video,
    enabled: gesturesOn,
    face: true,
    onEvent: onGesture,
  })
  const handsRef = useRef(hands.state)
  handsRef.current = hands.state

  const panelRef = useRef(panelOpen)
  panelRef.current = panelOpen
  const xyRef = useRef(xyIds)
  xyRef.current = xyIds

  useEffect(() => {
    mapping.setSham(sham)
  }, [mapping, sham])

  /* —— Signal ———————————————————————————————————————————————— */

  useEffect(() => {
    museBus.start()
    const stopAtmosphere = atmosphere.start()
    // The mirror reads the same colour identity the dashboard does; 'focus' is
    // the section whose words describe what the mirror is actually measuring.
    atmosphere.setSection('focus')

    let blink = false
    let jaw = false
    const started = performance.now()
    let nextId = 1

    const unsubscribe = museBus.subscribe((latest) => {
      const frame = latest.frame
      if (!frame) return
      atmosphere.setFrame(frame)

      const at = (performance.now() - started) / 1000
      const add = (kind: string, detail: string) =>
        setEntries((prev) => [{ id: nextId++, at, kind, detail }, ...prev].slice(0, MAX_TICKER))

      if (frame.artifacts.blink && !blink) add('blink', `${frame.artifacts.blink_mag} µV`)
      blink = frame.artifacts.blink
      if (frame.artifacts.jaw && !jaw) add('clench', `${frame.artifacts.jaw_mag} µV rms`)
      jaw = frame.artifacts.jaw
    })

    return () => {
      unsubscribe()
      stopAtmosphere()
    }
  }, [])

  /* —— Renderer ——————————————————————————————————————————————— */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      rendererRef.current = new MirrorRenderer(canvas)
    } catch (err) {
      setGlError(err instanceof Error ? err.message : String(err))
      return
    }
    const renderer = rendererRef.current
    return () => {
      renderer.dispose()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    rendererRef.current?.setVideo(camera.video)
  }, [camera.video])

  /* —— Recorder ——————————————————————————————————————————————— */

  useEffect(
    () =>
      recorder.subscribe(() => {
        setRecStatus(recorder.status)
        if (recorder.status === 'ready') setSession(recorder.session)
      }),
    [recorder],
  )

  /* —— The loop ——————————————————————————————————————————————— */

  useEffect(() => {
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const revealFromGesture = aperture.consume()

    let raf = 0
    let last = performance.now() / 1000
    let lastText = 0
    let videoDirty = true
    let rvfcHandle = 0
    let rvfcVideo: HTMLVideoElement | null = null
    let slowRun = 0
    let scale = 1
    let degraded = false
    let smoothedMs = 16.7
    let reveal = revealFromGesture ? Math.min(1, Math.abs(aperture.eased)) : 0
    let armedFor: string | null = null
    let armSnapshot = { ...handsRef.current.axes }

    const onVideoFrame = () => {
      videoDirty = true
      queueVideoFrame()
    }

    const queueVideoFrame = () => {
      const video = videoRef.current
      if (!video || !('requestVideoFrameCallback' in video)) return
      rvfcVideo = video
      rvfcHandle = video.requestVideoFrameCallback(onVideoFrame)
    }

    const tick = (time: number) => {
      raf = requestAnimationFrame(tick)
      const now = time / 1000
      const dt = Math.min(0.1, Math.max(1 / 480, now - last))
      last = now
      smoothedMs += (dt * 1000 - smoothedMs) * 0.1

      const renderer = rendererRef.current
      if (!renderer) return
      const parent = renderer.canvas.parentElement
      if (parent) {
        renderer.resize(
          parent.clientWidth,
          parent.clientHeight,
          Math.min(window.devicePixelRatio || 1, 1.5),
        )
      }

      // Adaptive resolution: if the budget is blown for long enough, halve the
      // render target rather than let the whole piece run at 25 fps.
      if (dt * 1000 > SLOW_FRAME_MS) slowRun += 1
      else slowRun = 0
      if (slowRun >= SLOW_FRAME_RUN && scale > 0.5) {
        scale = Math.max(0.5, scale * 0.5)
        renderer.setRenderScale(scale)
        degraded = true
        slowRun = 0
      }

      mapping.reduced = reducedQuery.matches
      mapping.update(now, dt)

      const gestures = handsRef.current
      applyGestures(graph, gestures, panelRef.current, xyRef.current)
      // Learn compares against the axes as they were when the param was armed,
      // not against the previous frame — a hand never moves 0.18 in 16 ms.
      if (graph.armed) {
        if (armedFor !== graph.armed) {
          armedFor = graph.armed
          armSnapshot = { ...gestures.axes }
        }
        const axis = dominantAxis(gestures.axes, armSnapshot)
        if (axis) graph.learn(axis)
      } else {
        armedFor = null
      }

      graph.tick(dt, now, mapping.drives, gestures.axes)

      const video = videoRef.current
      if (video) {
        const hasRvfc = 'requestVideoFrameCallback' in video
        if (!hasRvfc || videoDirty) {
          renderer.uploadVideo()
          videoDirty = false
        }
        if (hasRvfc && rvfcVideo !== video) queueVideoFrame()
      }

      // The reveal is the tail of the open-window gesture: the mirror finishes
      // opening after the route has already changed.
      reveal += (1 - reveal) * (1 - Math.exp(-dt / 0.22))
      renderer.canvas.style.setProperty('--reveal', reveal.toFixed(4))

      renderer.render(
        {
          time: now,
          tint: hslToRgb(atmosphere.live.h, atmosphere.live.s, atmosphere.live.l),
          shutterPhase: mapping.shutterPhase,
          shockPhase: mapping.shockPhase,
          reduced: reducedQuery.matches ? 1 : 0,
        },
        graph.values,
      )

      const frame = museBus.latest.frame
      if (frame) {
        recorder.sample({
          focus: frame.indices.focus,
          calm: frame.indices.calm,
          faa: frame.indices.faa,
          alphaAbs: frame.indices.alpha_abs,
          hr: frame.heart.hr,
          drives: mapping.drives,
          params: graph.values,
        })
      }

      paintFast(mapping, gestures, renderer)
      if (time - lastText >= TEXT_INTERVAL_MS) {
        lastText = time
        paintText(mapping, recorder, graph, panelRef.current, xyRef.current, {
          fps: 1000 / smoothedMs,
          frameMs: smoothedMs,
          scale,
          degraded,
          handCost: gestures.cost,
        })
      }
    }

    raf = requestAnimationFrame(tick)
    queueVideoFrame()

    return () => {
      cancelAnimationFrame(raf)
      if (rvfcVideo && rvfcHandle) rvfcVideo.cancelVideoFrameCallback(rvfcHandle)
    }
  }, [graph, mapping, recorder])

  /* —— Keys: every gesture has one ————————————————————————————— */

  const toggleRecord = useCallback(() => {
    if (recorder.status === 'recording') recorder.stop()
    else if (canvasRef.current) recorder.start(canvasRef.current)
  }, [recorder])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) {
        return
      }
      switch (event.key) {
        case 'Escape':
          navigate('dashboard')
          break
        case 'h':
          setHudVisible((v) => !v)
          break
        case 'p':
          setPanelOpen((v) => !v)
          break
        case 'r':
          toggleRecord()
          break
        case 'c':
          setCalOpen((v) => !v)
          break
        case 's':
          setSham((v) => !v)
          break
        case 'd':
          setDevVisible((v) => !v)
          break
        case 'g':
          setGesturesOn((v) => !v)
          break
        // Keyboard stand-in for the two-hand rotate.
        case '[':
          graph.nudge('hueShift', graph.byId.get('hueShift')!.manual - 0.12)
          break
        case ']':
          graph.nudge('hueShift', graph.byId.get('hueShift')!.manual + 0.12)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [graph, toggleRecord])

  const cameraFailed = camera.status !== 'ready' && camera.status !== 'requesting'

  return (
    <div className="mirror" data-hud={hudVisible ? 'on' : 'off'}>
      <canvas className="mirror-canvas" ref={canvasRef} />

      {(glError || cameraFailed) && (
        <div className="mirror-fallback">
          <h1>Mirror</h1>
          <p>{glError ?? camera.message}</p>
          {camera.status === 'denied' && (
            <button type="button" onClick={camera.retry}>
              Try again
            </button>
          )}
          <button type="button" onClick={() => navigate('dashboard')}>
            Back to dashboard
          </button>
        </div>
      )}

      {hudVisible && (
        <Hud
          entries={entries}
          sham={sham}
          uncalibrated={mapping.uncalibrated}
          hands={gesturesOn}
          dev={devVisible}
        />
      )}

      <div className="mirror-bar">
        <button type="button" onClick={() => navigate('dashboard')}>
          ← Dashboard
        </button>
        <button type="button" onClick={() => setCalOpen(true)}>
          Baseline
        </button>
        <button
          type="button"
          aria-pressed={gesturesOn}
          onClick={() => setGesturesOn((v) => !v)}
        >
          Hands
        </button>
        {gesturesOn && hands.status === 'error' && (
          <span className="mirror-hand-err" title={hands.message ?? undefined}>
            {hands.message ?? 'hand tracking error'}
          </span>
        )}
        {gesturesOn && hands.status === 'loading' && (
          <span className="mirror-hand-note">loading hands…</span>
        )}
        <button type="button" aria-pressed={sham} onClick={() => setSham((v) => !v)}>
          Sham
        </button>
        <button
          type="button"
          aria-pressed={recStatus === 'recording'}
          disabled={recStatus === 'unsupported'}
          onClick={toggleRecord}
        >
          {recStatus === 'recording' ? 'Stop' : 'Record'}
        </button>
        <button type="button" aria-pressed={panelOpen} onClick={() => setPanelOpen((v) => !v)}>
          Params
        </button>
        <span className="mirror-keys mono">
          esc exit · h hud · p params · r rec · c baseline · s sham · d dev · [ ] hue
        </span>
      </div>

      {panelOpen && (
        <ParamPanel
          graph={graph}
          xy={xyIds}
          onXy={setXyIds}
          onClose={() => setPanelOpen(false)}
        />
      )}
      {calOpen && <Calibrate onClose={() => setCalOpen(false)} />}
      {session && (
        <ScrubBack
          session={session}
          onClose={() => {
            setSession(null)
            recorder.discard()
          }}
        />
      )}
    </div>
  )
}

/* —— HUD painting ————————————————————————————————————————————
   Direct style and textContent writes, the way the atmosphere engine paints
   colour. React owns the structure; the loop owns the numbers. */

function paintFast(
  mapping: MirrorMapping,
  gestures: GestureState,
  renderer: MirrorRenderer,
): void {
  const d = mapping.drives
  hud.attr('arc', 'stroke-dashoffset', (ARC_LENGTH * (1 - d.coherence)).toFixed(2))
  hud.style('root', 'transform', `translate3d(${(d.tiltX * 9).toFixed(2)}px, ${(d.tiltY * 9).toFixed(2)}px, 0)`)
  hud.style('pip', 'transform', `scale(${(1 + d.pulse * 0.9).toFixed(3)})`)
  hud.style('root', '--fog', d.fog.toFixed(3))

  const cover = renderer.cover
  const toScreen = (x: number, y: number): [number, number] => [
    (0.5 + (x - 0.5) / cover.x) * 1000,
    (0.5 + (y - 0.5) / cover.y) * 1000,
  ]

  const face = gestures.face
  if (face) {
    // Both corners run through the same flip, so the box stays on the face
    // rather than landing on its reflection.
    const [ax, ay] = toScreen(1 - face.x, face.y)
    const [bx, by] = toScreen(1 - (face.x + face.w), face.y + face.h)
    const x = Math.min(ax, bx)
    const y = Math.min(ay, by)
    const w = Math.abs(bx - ax)
    const h = Math.abs(by - ay)
    hud.attr('faceGroup', 'opacity', '1')
    hud.attr(
      'faceGroup',
      'transform',
      `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(w / 200).toFixed(3)} ${(h / 240).toFixed(3)})`,
    )
  } else {
    hud.attr('faceGroup', 'opacity', '0')
  }

  hud.attr('handGroup', 'opacity', gestures.hands ? '1' : '0')
  for (let i = 0; i < 2; i++) {
    const point = gestures.points[i]
    const [px, py] = point ? toScreen(point.x, point.y) : [-50, -50]
    hud.attr(`hand${i}`, 'cx', px.toFixed(1))
    hud.attr(`hand${i}`, 'cy', py.toFixed(1))
    if (point) hud.attr(`hand${i}`, 'r', (6 + (1 - point.pinch) * 8).toFixed(1))
  }
  const dwell = gestures.point
  const [dx, dy] = dwell.active ? toScreen(dwell.x, dwell.y) : [-50, -50]
  hud.attr('dwell', 'cx', dx.toFixed(1))
  hud.attr('dwell', 'cy', dy.toFixed(1))
  hud.attr('dwell', 'r', (26 - dwell.dwell * 14).toFixed(1))
  hud.attr('dwell', 'opacity', dwell.active ? '1' : '0')
}

interface DevStats {
  fps: number
  frameMs: number
  scale: number
  degraded: boolean
  handCost: number
}

function paintText(
  mapping: MirrorMapping,
  recorder: MirrorRecorder,
  graph: ParamGraph,
  panelOpen: boolean,
  xy: [string, string],
  dev: DevStats,
): void {
  const frame = museBus.latest.frame
  const d = mapping.drives

  hud.text('stateWord', mapping.state.word)
  hud.text('coherenceText', d.coherence.toFixed(2))
  hud.text('clock', clock(performance.now() / 1000))
  hud.toggle('rec', 'is-live', recorder.status === 'recording')

  // Only once the fog has actually built: a blink trips the veto for 100 ms and
  // a chip that flashed on every blink would be noise, not information.
  const veto = mapping.veto.active && d.fog > 0.25
  hud.toggle('vetoChip', 'is-on', veto)
  if (veto && mapping.veto.reason) hud.text('vetoChip', `SIGNAL INTERRUPTED · ${mapping.veto.reason}`)

  const legend = mapping.legend
  hud.text('legendEffect', legend.effect)
  hud.text(
    'legendDriver',
    `${legend.driver} ${legend.value.toFixed(2)} (${legend.z >= 0 ? '+' : ''}${legend.z.toFixed(1)}σ)`,
  )
  hud.text(
    'legendWindow',
    `· ${legend.window.toFixed(1)} s window${baseline.calibrated ? '' : ' · session baseline'}`,
  )

  if (frame) {
    let total = 0
    for (const band of BAND_ORDER) total += frame.bands_avg[band] ?? 0
    for (const band of BAND_ORDER) {
      const share = total > 1e-9 ? (frame.bands_avg[band] ?? 0) / total : 0
      hud.style(`band:${band}`, 'height', `${(share * 100).toFixed(1)}%`)
    }
    for (const ch of CHANNELS) {
      hud.attr(`pad:${ch}`, 'data-q', frame.quality[ch]?.label ?? 'red')
    }
    hud.text('hr', frame.heart.hr > 0 ? frame.heart.hr.toFixed(0) : '--')
    hud.text('hrv', frame.heart.hrv > 0 ? `hrv ${frame.heart.hrv.toFixed(0)} ms` : '')
    // The dashboard's own word for the same section, so the two agree.
    hud.text('arcLabel', `coherence · ${deriveState('focus', frame).word.toLowerCase()}`)
  }

  if (panelOpen) {
    for (const param of graph.params) hud.text(`param:${param.id}`, param.value.toFixed(2))
    hud.style('xyPuck', 'left', `${(norm(graph, xy[0]) * 100).toFixed(1)}%`)
    hud.style('xyPuck', 'bottom', `${(norm(graph, xy[1]) * 100).toFixed(1)}%`)
  }

  hud.text(
    'dev',
    `${dev.fps.toFixed(0)} fps · ${dev.frameMs.toFixed(1)} ms · scale ${dev.scale.toFixed(2)}` +
      `${dev.degraded ? ' (reduced)' : ''} · hands ${dev.handCost.toFixed(1)} ms`,
  )
}

function applyGestures(
  graph: ParamGraph,
  gestures: GestureState,
  panelOpen: boolean,
  xy: [string, string],
): void {
  if (gestures.rotate.active) {
    graph.nudge('hueShift', gestures.rotate.turns * Math.PI)
  }
  if (gestures.drag.active && panelOpen) {
    graph.nudge(xy[0], lerpRange(graph, xy[0], gestures.drag.x))
    graph.nudge(xy[1], lerpRange(graph, xy[1], 1 - gestures.drag.y))
  }
}

function lerpRange(graph: ParamGraph, id: string, t: number): number {
  const param = graph.byId.get(id)
  if (!param) return 0
  return param.range[0] + (param.range[1] - param.range[0]) * clamp01(t)
}

function norm(graph: ParamGraph, id: string): number {
  const param = graph.byId.get(id)
  if (!param) return 0
  return clamp01((param.value - param.range[0]) / (param.range[1] - param.range[0]))
}

function useConst<T>(make: () => T): T {
  const ref = useRef<T>(null)
  ref.current ??= make()
  return ref.current
}

/** HSL as the atmosphere engine stores it (s and l in percent) to 0–1 RGB. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100
  const light = l / 100
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = light - c / 2
  let rgb: [number, number, number]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m]
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
