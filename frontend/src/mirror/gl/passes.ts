/**
 * Thin WebGL2 helpers: a compiled program that knows its own uniforms, and a
 * render target.
 *
 * Programs enumerate their active uniforms at link time and expose
 * `setFloat(name, v)` as a no-op when the name is absent. That is what lets the
 * parameter registry write straight into the shaders without a hand-written
 * mapping table per pass — a param whose uniform is not in this pass simply
 * lands nowhere.
 */
import { VERT } from './shaders/common'

export class Program {
  readonly program: WebGLProgram
  private readonly uniforms = new Map<string, WebGLUniformLocation>()
  private readonly gl: WebGL2RenderingContext
  private readonly label: string

  constructor(gl: WebGL2RenderingContext, frag: string, label: string) {
    this.gl = gl
    this.label = label
    const vs = compile(gl, gl.VERTEX_SHADER, VERT, `${label}:vert`)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag, `${label}:frag`)
    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`${label} link failed: ${gl.getProgramInfoLog(program)}`)
    }
    gl.deleteShader(vs)
    gl.deleteShader(fs)

    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i)
      if (!info) continue
      const loc = gl.getUniformLocation(program, info.name)
      if (loc) this.uniforms.set(info.name, loc)
    }
    this.program = program
  }

  has(name: string): boolean {
    return this.uniforms.has(name)
  }

  use(): void {
    this.gl.useProgram(this.program)
  }

  setFloat(name: string, v: number): void {
    const loc = this.uniforms.get(name)
    if (loc) this.gl.uniform1f(loc, v)
  }

  setVec2(name: string, x: number, y: number): void {
    const loc = this.uniforms.get(name)
    if (loc) this.gl.uniform2f(loc, x, y)
  }

  setVec3(name: string, x: number, y: number, z: number): void {
    const loc = this.uniforms.get(name)
    if (loc) this.gl.uniform3f(loc, x, y, z)
  }

  setTexture(name: string, unit: number, texture: WebGLTexture): void {
    const loc = this.uniforms.get(name)
    if (!loc) return
    const { gl } = this
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(loc, unit)
  }

  dispose(): void {
    this.gl.deleteProgram(this.program)
  }

  toString(): string {
    return this.label
  }
}

/** Colour-only RGBA8 target. Depth would be dead weight for a post chain. */
export class Target {
  readonly framebuffer: WebGLFramebuffer
  readonly texture: WebGLTexture
  width = 0
  height = 0
  private readonly gl: WebGL2RenderingContext

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.texture,
      0,
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    const { gl } = this
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    )
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.framebuffer)
    this.gl.deleteTexture(this.texture)
  }
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error(`${label}: could not create shader`)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`${label} compile failed: ${log}`)
  }
  return shader
}
