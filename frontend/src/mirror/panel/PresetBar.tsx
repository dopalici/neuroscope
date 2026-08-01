import { useRef } from 'react'
import type { ParamGraph, Preset } from '../../state/mirror/params'

interface Props {
  graph: ParamGraph
}

/** A preset is the serialised registry — nothing else needed inventing. */
export function PresetBar({ graph }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const save = () => {
    const name = `mirror-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
    const blob = new Blob([JSON.stringify(graph.serialize(name), null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const load = async (file: File) => {
    try {
      graph.load(JSON.parse(await file.text()) as Preset)
    } catch {
      // A file that is not a preset is not an error worth a dialog.
    }
  }

  return (
    <div className="pp-presets">
      <button type="button" onClick={save}>
        Save preset
      </button>
      <button type="button" onClick={() => fileRef.current?.click()}>
        Load
      </button>
      <button type="button" onClick={() => graph.reset()}>
        Reset
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void load(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
