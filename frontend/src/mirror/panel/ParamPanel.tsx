import { useEffect, useReducer } from 'react'
import {
  CURVES,
  GESTURE_AXES,
  SOURCE_KINDS,
  defaultSource,
  describeSource,
} from '../../state/mirror/params'
import type { Curve, GestureAxis, Param, ParamGraph, SourceKind } from '../../state/mirror/params'
import { DRIVE_KEYS } from '../../state/mirror/mapping'
import type { DriveKey } from '../../state/mirror/mapping'
import { hud } from '../hud/hudBus'
import { PresetBar } from './PresetBar'
import { XYPad } from './XYPad'

interface Props {
  graph: ParamGraph
  /** The pair currently on the XY pad, owned by the route. */
  xy: [string, string]
  onXy: (pair: [string, string]) => void
  onClose: () => void
}

/**
 * The panel is generated from the registry, which is the point of having one.
 * Adding an effect means adding a spec in `params.ts` — no control here has to
 * know that it exists.
 *
 * Live values are written into the readouts by the render loop rather than
 * flowing through React, so an open panel costs nothing per frame.
 */
export function ParamPanel({ graph, xy, onXy, onClose }: Props) {
  const [, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => graph.subscribe(bump), [graph])

  return (
    <aside className="pp">
      <header className="pp-head">
        <h2>Parameters</h2>
        <button type="button" className="pp-close" onClick={onClose} aria-label="close panel">
          ✕
        </button>
      </header>

      <PresetBar graph={graph} />
      <XYPad
        graph={graph}
        xId={xy[0]}
        yId={xy[1]}
        onAssign={(axis, id) => onXy(axis === 'x' ? [id, xy[1]] : [xy[0], id])}
      />

      {graph.armed && (
        <p className="pp-learn-hint">
          Learning <strong>{graph.byId.get(graph.armed)?.label}</strong> — perform a hand
          gesture to bind it, or press the button again to cancel.
        </p>
      )}

      <div className="pp-scroll">
        {graph.groups.map((group) => (
          <section key={group} className="pp-group">
            <h3>{group}</h3>
            {graph.params
              .filter((p) => p.group === group)
              .map((param) => (
                <Row key={param.id} graph={graph} param={param} />
              ))}
          </section>
        ))}
      </div>
    </aside>
  )
}

function Row({ graph, param }: { graph: ParamGraph; param: Param }) {
  const source = param.source
  const [lo, hi] = param.range
  const armed = graph.armed === param.id

  return (
    <div className="pp-row" data-armed={armed || undefined}>
      <div className="pp-row-head">
        <span className="pp-label">{param.label}</span>
        <span className="pp-value mono" ref={hud.bind(`param:${param.id}`)}>
          {param.value.toFixed(2)}
        </span>
      </div>

      <input
        className="pp-slider"
        type="range"
        min={lo}
        max={hi}
        step={(hi - lo) / 200}
        value={param.manual}
        onChange={(e) => graph.setManual(param.id, Number(e.target.value))}
      />

      <div className="pp-controls">
        <select
          value={source.kind}
          onChange={(e) =>
            graph.setSource(param.id, defaultSource(e.target.value as SourceKind, source))
          }
        >
          {SOURCE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>

        {(source.kind === 'signal' || source.kind === 'follow') && (
          <select
            value={source.drive}
            onChange={(e) =>
              graph.setSource(param.id, { ...source, drive: e.target.value as DriveKey })
            }
          >
            {DRIVE_KEYS.map((drive) => (
              <option key={drive} value={drive}>
                {drive}
              </option>
            ))}
          </select>
        )}

        {source.kind === 'signal' && (
          <>
            <Num
              label="gain"
              value={source.gain}
              step={0.05}
              onChange={(gain) => graph.setSource(param.id, { ...source, gain })}
            />
            <Num
              label="bias"
              value={source.bias}
              step={0.05}
              onChange={(bias) => graph.setSource(param.id, { ...source, bias })}
            />
            <select
              value={source.curve}
              onChange={(e) =>
                graph.setSource(param.id, { ...source, curve: e.target.value as Curve })
              }
            >
              {CURVES.map((curve) => (
                <option key={curve} value={curve}>
                  {curve}
                </option>
              ))}
            </select>
          </>
        )}

        {source.kind === 'follow' && (
          <>
            <Num
              label="atk"
              value={source.attack}
              step={0.01}
              onChange={(attack) => graph.setSource(param.id, { ...source, attack })}
            />
            <Num
              label="rel"
              value={source.release}
              step={0.01}
              onChange={(release) => graph.setSource(param.id, { ...source, release })}
            />
          </>
        )}

        {source.kind === 'gesture' && (
          <select
            value={source.axis}
            onChange={(e) =>
              graph.setSource(param.id, { kind: 'gesture', axis: e.target.value as GestureAxis })
            }
          >
            {GESTURE_AXES.map((axis) => (
              <option key={axis} value={axis}>
                {axis}
              </option>
            ))}
          </select>
        )}

        {source.kind === 'lfo' && (
          <>
            <Num
              label="Hz"
              value={source.hz}
              step={0.05}
              onChange={(hz) => graph.setSource(param.id, { ...source, hz })}
            />
            <select
              value={source.shape}
              onChange={(e) =>
                graph.setSource(param.id, {
                  ...source,
                  shape: e.target.value as 'sine' | 'tri' | 'noise',
                })
              }
            >
              <option value="sine">sine</option>
              <option value="tri">tri</option>
              <option value="noise">noise</option>
            </select>
          </>
        )}

        <button
          type="button"
          className="pp-learn"
          aria-pressed={armed}
          onClick={() => graph.arm(param.id)}
        >
          learn
        </button>
      </div>

      <span className="pp-source mono">{describeSource(source)}</span>
    </div>
  )
}

function Num({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="pp-num">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
