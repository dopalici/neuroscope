import { useEffect, useRef, useState } from 'react'
import { atmosphere } from '../state/atmosphere'
import type { BrainState, SectionId } from '../state/brainState'
import type { FrameMessage } from '../types'

/** Runs the colour loop and feeds it each incoming frame. Call once, in App. */
export function useAtmosphereEngine(frame: FrameMessage | null, section: SectionId): void {
  useEffect(() => atmosphere.start(), [])
  useEffect(() => {
    atmosphere.setFrame(frame)
  }, [frame])
  useEffect(() => {
    atmosphere.setSection(section)
  }, [section])
}

/** Re-renders only when the state word changes, not on every data frame. */
export function useBrainState(): BrainState {
  const [state, setState] = useState<BrainState>(atmosphere.state)
  useEffect(() => atmosphere.subscribe(setState), [])
  return state
}

/** Marks an element as a target for the live colour custom properties. */
export function useAtmosphereSurface<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return atmosphere.addSurface(el)
  }, [])
  return ref
}

/**
 * Whichever section is crossing the middle of the viewport owns the state word.
 * Uses IntersectionObserver rather than a scroll listener so fast scrolling
 * costs nothing on the main thread.
 */
export function useActiveSection(ids: readonly SectionId[]): SectionId {
  const [active, setActive] = useState<SectionId>(ids[0])

  useEffect(() => {
    const visible = new Set<string>()
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        // Document order keeps the choice stable while two bands overlap.
        const next = ids.find((id) => visible.has(id))
        if (next) setActive(next)
      },
      // A thin band across the vertical centre of the screen.
      { rootMargin: '-48% 0px -48% 0px', threshold: 0 },
    )

    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [ids])

  return active
}
