import { useAtmosphereSurface, useBrainState } from '../hooks/useAtmosphere'
import { SECTION_LABELS } from '../state/brainState'
import type { BrainState, SectionId } from '../state/brainState'

interface Props {
  section: SectionId
  /** Receives the word as it stands right now, so the panel can freeze it. */
  onOpen: (state: BrainState) => void
  expanded: boolean
}

/**
 * One word for whatever the current section is measuring, in the current hue.
 * The word is keyed so React replays the fade only when the state actually
 * changes — never on the 10 Hz data frames.
 */
export function StateBadge({ section, onOpen, expanded }: Props) {
  const state = useBrainState()
  const ref = useAtmosphereSurface<HTMLButtonElement>()

  return (
    <button
      className="state-badge"
      ref={ref}
      onClick={() => onOpen(state)}
      aria-expanded={expanded}
      title="What is happening at this ratio?"
    >
      <span className="state-section">{SECTION_LABELS[section]}</span>
      <span className="state-word" key={state.key}>
        {state.word}
      </span>
      <span className="state-note">{state.note}</span>
      <span className="state-cue">{expanded ? 'close' : 'what this means →'}</span>
    </button>
  )
}
