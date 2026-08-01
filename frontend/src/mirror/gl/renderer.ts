/**
 * The post chain: one full-screen triangle, three passes, ping-ponged history.
 *
 * Three hundred lines of hand-written WebGL2 instead of a renderer library,
 * because a library would be two orders of magnitude more code than the thing
 * it renders and this repo has two runtime dependencies.
 *
 * The one rule that matters for frame time: nothing here allocates per frame.
 * The video texture is uploaded with `texSubImage2D` after the first frame, the
 * targets are only reallocated when the canvas actually changes size, and
 * uniforms are written by name into a map built once at link time.
 */
import { Program, Target } from './passes'
import { DISPLACE_FRAG } from './shaders/displace'
import { FEEDBACK_FRAG } from './shaders/feedback'
import { GRADE_FRAG } from './shaders/grade'

export interface RenderInput {
  /** Seconds since the mirror opened. */
  time: number
  /** Atmosphere colour, already converted to linear-ish RGB in 0–1. */
  tint: readonly [number, number, number]
  /** 1 at the instant of a blink, decaying to 0 across the shutter. */
  shutterPhase: number
  /** 0→1 as a clench shockwave travels out from the centre. */
  shockPhase: number
  /** 1 when the OS asks for reduced motion. */
  reduced: number
}

export type ParamValues = Readonly<Record<string, number>>

const CONTEXT_OPTIONS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  // `captureStream` reads the compositor's copy, so the drawing buffer never
  // needs preserving. Turning it on would cost a full-frame copy every frame
  // for the benefit of `toDataURL` alone, which the still export avoids by
  // going through `readPixels` instead.
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
}

export class MirrorRenderer {
  readonly gl: WebGL2RenderingContext
  readonly canvas: HTMLCanvasElement

  private readonly displace: Program
  private readonly feedback: Program
  private readonly grade: Program
  private readonly vao: WebGLVertexArrayObject
  private readonly videoTexture: WebGLTexture
  private readonly scratch: Target
  private readonly history: [Target, Target]
  private historyIndex = 0

  private video: HTMLVideoElement | null = null
  private videoUploaded = false
  private videoSize = { w: 0, h: 0 }
  private renderScale = 1

  private width = 1
  private height = 1

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', CONTEXT_OPTIONS)
    if (!gl) throw new Error('WebGL2 is not available in this browser')
    this.gl = gl
    this.canvas = canvas

    this.displace = new Program(gl, DISPLACE_FRAG, 'displace')
    this.feedback = new Program(gl, FEEDBACK_FRAG, 'feedback')
    this.grade = new Program(gl, GRADE_FRAG, 'grade')

    this.vao = gl.createVertexArray()
    this.videoTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.scratch = new Target(gl)
    this.history = [new Target(gl), new Target(gl)]

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  }

  setVideo(video: HTMLVideoElement | null): void {
    this.video = video
    this.videoUploaded = false
    this.videoSize = { w: 0, h: 0 }
  }

  /** 1 = full resolution. The adaptive-resolution guard halves this. */
  setRenderScale(scale: number): void {
    this.renderScale = scale
  }

  get scale(): number {
    return this.renderScale
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }

  /**
   * The centre-crop currently applied to the video, so the overlay can place a
   * face box or a fingertip on the same pixel the shader sampled it from.
   */
  get cover(): { x: number; y: number } {
    return this.coverScale(this.width / this.height)
  }

  /** Returns true when the backing store actually changed. */
  resize(cssWidth: number, cssHeight: number, dpr: number): boolean {
    const w = Math.max(2, Math.round(cssWidth * dpr * this.renderScale))
    const h = Math.max(2, Math.round(cssHeight * dpr * this.renderScale))
    if (w === this.width && h === this.height) return false

    this.width = w
    this.height = h
    this.canvas.width = w
    this.canvas.height = h
    this.canvas.style.width = `${cssWidth}px`
    this.canvas.style.height = `${cssHeight}px`
    this.scratch.resize(w, h)
    this.history[0].resize(w, h)
    this.history[1].resize(w, h)
    return true
  }

  /**
   * Pushes the current video frame into its texture. Allocating storage costs a
   * driver-side reallocation, so it happens exactly once per stream.
   */
  uploadVideo(): boolean {
    const { gl, video } = this
    if (!video || video.readyState < 2) return false
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return false

    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture)
    if (!this.videoUploaded || w !== this.videoSize.w || h !== this.videoSize.h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      this.videoUploaded = true
      this.videoSize = { w, h }
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video)
    }
    return true
  }

  render(input: RenderInput, params: ParamValues): void {
    const { gl } = this
    if (!this.videoUploaded) return

    const aspect = this.width / this.height
    const cover = this.coverScale(aspect)

    gl.bindVertexArray(this.vao)
    gl.viewport(0, 0, this.width, this.height)

    // 1 — displace, from the camera into the scratch target.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scratch.framebuffer)
    this.displace.use()
    this.displace.setTexture('uVideo', 0, this.videoTexture)
    this.displace.setFloat('uTime', input.time)
    this.displace.setFloat('uAspect', aspect)
    this.displace.setVec2('uCover', cover.x, cover.y)
    this.displace.setFloat('uShutterPhase', input.shutterPhase)
    this.displace.setFloat('uShockPhase', input.shockPhase)
    this.displace.setFloat('uReduced', input.reduced)
    writeParams(this.displace, params)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // 2 — feedback, mixing the scratch with the previous output.
    const prev = this.history[this.historyIndex]
    const next = this.history[this.historyIndex ^ 1]
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer)
    this.feedback.use()
    this.feedback.setTexture('uSrc', 0, this.scratch.texture)
    this.feedback.setTexture('uHist', 1, prev.texture)
    this.feedback.setFloat('uEcho', input.shutterPhase)
    writeParams(this.feedback, params)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.historyIndex ^= 1

    // 3 — grade, to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.grade.use()
    this.grade.setTexture('uSrc', 0, next.texture)
    this.grade.setVec2('uTexel', 1 / this.width, 1 / this.height)
    this.grade.setVec3('uTint', input.tint[0], input.tint[1], input.tint[2])
    this.grade.setFloat('uTime', input.time)
    this.grade.setFloat('uAspect', aspect)
    this.grade.setFloat('uShutterPhase', input.shutterPhase)
    this.grade.setFloat('uReduced', input.reduced)
    writeParams(this.grade, params)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /**
   * Still export. Going through `readPixels` keeps `preserveDrawingBuffer` off,
   * so the per-frame cost of the feature is zero when nobody is exporting.
   */
  readStill(): HTMLCanvasElement {
    const { gl } = this
    const pixels = new Uint8Array(this.width * this.height * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.history[this.historyIndex].framebuffer)
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    const out = document.createElement('canvas')
    out.width = this.width
    out.height = this.height
    const ctx = out.getContext('2d')!
    const image = ctx.createImageData(this.width, this.height)
    // GL reads bottom-up; the 2D canvas expects top-down.
    const stride = this.width * 4
    for (let y = 0; y < this.height; y++) {
      const src = (this.height - 1 - y) * stride
      image.data.set(pixels.subarray(src, src + stride), y * stride)
    }
    ctx.putImageData(image, 0, 0)
    return out
  }

  dispose(): void {
    const { gl } = this
    this.displace.dispose()
    this.feedback.dispose()
    this.grade.dispose()
    this.scratch.dispose()
    this.history[0].dispose()
    this.history[1].dispose()
    gl.deleteTexture(this.videoTexture)
    gl.deleteVertexArray(this.vao)
    // Deliberately not `loseContext()`: React reuses the canvas element across
    // a development remount, and a lost context is never handed back by
    // `getContext` — the second renderer would come up dead.
  }

  /** Centre-crop the video to the canvas, never letterbox — this is a mirror. */
  private coverScale(canvasAspect: number): { x: number; y: number } {
    const { w, h } = this.videoSize
    if (!w || !h) return { x: 1, y: 1 }
    const videoAspect = w / h
    return videoAspect > canvasAspect
      ? { x: canvasAspect / videoAspect, y: 1 }
      : { x: 1, y: videoAspect / canvasAspect }
  }
}

function writeParams(program: Program, params: ParamValues): void {
  for (const id in params) program.setFloat(`u_${id}`, params[id])
}
