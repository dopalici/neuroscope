import { useEffect, useRef } from 'react'
import type { ParamGraph } from '../../state/mirror/params'
import { hud } from '../hud/hudBus'

interface Props {
  graph: ParamGraph
  xId: string
  yId: string
  onAssign: (axis: 'x' | 'y', id: string) => void
}

/**
 * Two params on one square. The puck position is written by the render loop, so
 * dragging it with a pinch and dragging it with a mouse are the same code path
 * downstream.
 */
export function XYPad({ graph, xId, yId, onAssign }: Props) {
  const padRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const pad = padRef.current
    if (!pad) return

    const apply = (event: PointerEvent) => {
      const box = pad.getBoundingClientRect()
      const nx = clamp01((event.clientX - box.left) / box.width)
      const ny = clamp01(1 - (event.clientY - box.top) / box.height)
      graph.setSource(xId, { kind: 'constant' })
      graph.setSource(yId, { kind: 'constant' })
      graph.setManual(xId, lerpRange(graph, xId, nx))
      graph.setManual(yId, lerpRange(graph, yId, ny))
    }

    const down = (event: PointerEvent) => {
      pad.setPointerCapture(event.pointerId)
      apply(event)
    }
    const move = (event: PointerEvent) => {
      if (pad.hasPointerCapture(event.pointerId)) apply(event)
    }

    pad.addEventListener('pointerdown', down)
    pad.addEventListener('pointermove', move)
    return () => {
      pad.removeEventListener('pointerdown', down)
      pad.removeEventListener('pointermove', move)
    }
  }, [graph, xId, yId])

  return (
    <div className="pp-xy">
      <div className="pp-xy-pad" ref={padRef}>
        <span className="pp-xy-puck" ref={hud.bind('xyPuck')} />
      </div>
      <div className="pp-xy-axes">
        <label>
          <span>X</span>
          <select value={xId} onChange={(e) => onAssign('x', e.target.value)}>
            {graph.params.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Y</span>
          <select value={yId} onChange={(e) => onAssign('y', e.target.value)}>
            {graph.params.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

function lerpRange(graph: ParamGraph, id: string, t: number): number {
  const param = graph.byId.get(id)
  if (!param) return 0
  return param.range[0] + (param.range[1] - param.range[0]) * t
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
