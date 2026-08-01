/**
 * The HUD's write path.
 *
 * Text in GLSL is misery and DOM text is crisp, selectable and accessible, so
 * the overlay is real elements — but real elements re-rendered by React sixty
 * times a second would cost more than the shader chain underneath them. Same
 * bargain the atmosphere engine strikes with colour: React renders the
 * structure once, the loop writes into it directly, and every write is skipped
 * when the value has not changed.
 */
type Node = HTMLElement | SVGElement

class HudBus {
  private nodes = new Map<string, Node>()
  private refs = new Map<string, (el: Node | null) => void>()
  private written = new Map<string, string>()

  /** Stable ref callback per slot name, so React never re-binds. */
  bind(name: string): (el: Node | null) => void {
    let ref = this.refs.get(name)
    if (!ref) {
      ref = (el: Node | null) => {
        if (el) this.nodes.set(name, el)
        else {
          this.nodes.delete(name)
          for (const key of [...this.written.keys()]) {
            if (key.startsWith(`${name}\u0000`)) this.written.delete(key)
          }
        }
      }
      this.refs.set(name, ref)
    }
    return ref
  }

  has(name: string): boolean {
    return this.nodes.has(name)
  }

  text(name: string, value: string): void {
    const node = this.nodes.get(name)
    if (!node || !this.changed(name, 'text', value)) return
    node.textContent = value
  }

  attr(name: string, key: string, value: string): void {
    const node = this.nodes.get(name)
    if (!node || !this.changed(name, key, value)) return
    node.setAttribute(key, value)
  }

  style(name: string, prop: string, value: string): void {
    const node = this.nodes.get(name)
    if (!node || !this.changed(name, prop, value)) return
    node.style.setProperty(prop, value)
  }

  toggle(name: string, className: string, on: boolean): void {
    const node = this.nodes.get(name)
    if (!node || !this.changed(name, `.${className}`, on ? '1' : '0')) return
    node.classList.toggle(className, on)
  }

  private changed(name: string, key: string, value: string): boolean {
    const id = `${name}\u0000${key}`
    if (this.written.get(id) === value) return false
    this.written.set(id, value)
    return true
  }
}

export const hud = new HudBus()
