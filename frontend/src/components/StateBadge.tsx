import { useAtmosphereSurface, useBrainState } from '../hooks/useAtmosphere'
import { SECTION_LABELS } from '../state/brainState'
import type { SectionId } from '../state/brainState'

interface Props {
  section: SectionId
}

/**
 * One word for whatever the current section is measuring, in the current hue.
 * The word is keyed so React replays the fade only when the state actually
 * changes — never on the 10 Hz data frames.
 */
export function StateBadge({ section }: Props) {
  const state = useBrainState()
  const ref = useAtmosphereSurface<HTMLDivElement>()

  return (
    <div className="state-badge" ref={ref}>
      <span className="state-section">{SECTION_LABELS[section]}</span>
      <span className="state-word" key={state.key}>
        {state.word}
      </span>
      <span className="state-note">{state.note}</span>
    </div>
  )
}
