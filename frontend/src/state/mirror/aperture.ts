/**
 * The open-window gesture's shared state.
 *
 * The motion starts on the dashboard and finishes in the mirror, on the other
 * side of a route change, so the progress cannot live in either component. It
 * is deliberately a plain mutable object read from two rAF loops — the same
 * shape as `atmosphere.live`.
 */
class Aperture {
  /** Continuous, not a trigger: −1.4 (pushing shut) → 0 (rest) → 1.4 (pulled open). */
  progress = 0
  /** Smoothed for painting, so a lost hand snaps back instead of teleporting. */
  eased = 0
  /** Set at the moment of commit, read by whichever route mounts next. */
  private committedAt = -Infinity

  commit(): void {
    this.committedAt = performance.now()
  }

  /**
   * True for the route that was entered by the gesture. Expires on a clock
   * rather than on first read, because React mounts an effect twice in
   * development and a read-once flag would lose the reveal every other time.
   */
  consume(): boolean {
    return performance.now() - this.committedAt < 1500
  }

  ease(dt: number): number {
    // Fast enough to feel attached to the hands, slow enough to hide the 18 Hz
    // inference rate underneath.
    this.eased += (this.progress - this.eased) * (1 - Math.exp(-dt / 0.09))
    return this.eased
  }

  reset(): void {
    this.progress = 0
    this.eased = 0
  }
}

export const aperture = new Aperture()
