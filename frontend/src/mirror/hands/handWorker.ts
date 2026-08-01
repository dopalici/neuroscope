/**
 * Hand (and optionally face) inference, off the render thread.
 *
 * Running MediaPipe on the main thread is the standard way to destroy frame
 * rate: a 20 ms inference on a 16 ms budget means every third frame is dropped
 * forever. Here it gets its own thread, a 256×256 bitmap, and a 15–20 Hz
 * budget — hands do not move fast enough for more, and the gesture layer
 * smooths what it gets.
 *
 * WASM is imported via Vite `?url` rather than loaded from `/public`. A module
 * worker falls through to `import(wasmLoaderPath)`, and Vite refuses to
 * transform files that live under `public/` — that is the crash the dashboard
 * gesture toggle was hitting. Models stay in public; they are fetched, not
 * imported, so that path is fine.
 */
import { FaceDetector, HandLandmarker } from '@mediapipe/tasks-vision'
import type { Detection, NormalizedLandmark } from '@mediapipe/tasks-vision'
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url'
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url'

const HAND_MODEL = '/mediapipe/models/hand_landmarker.task'
const FACE_MODEL = '/mediapipe/models/blaze_face_short_range.tflite'

interface WasmFileset {
  wasmLoaderPath: string
  wasmBinaryPath: string
}

export interface HandFrame {
  type: 'result'
  t: number
  /** Up to two hands, 21 landmarks each, normalised to the 256² input. */
  hands: NormalizedLandmark[][]
  handedness: ('Left' | 'Right')[]
  /** Face box in normalised input coordinates, when the face model is loaded. */
  face: { x: number; y: number; w: number; h: number } | null
  /** Inference milliseconds, for the dev corner. */
  cost: number
}

export type WorkerOut =
  | HandFrame
  | { type: 'ready'; face: boolean }
  | { type: 'error'; message: string }

export type WorkerIn =
  | { type: 'init'; face: boolean }
  | { type: 'frame'; bitmap: ImageBitmap; t: number }
  | { type: 'close' }

let hands: HandLandmarker | null = null
let faces: FaceDetector | null = null
let busy = false

function fileset(): WasmFileset {
  return {
    wasmLoaderPath: wasmLoaderUrl,
    wasmBinaryPath: wasmBinaryUrl,
  }
}

async function createHands(delegate: 'GPU' | 'CPU'): Promise<HandLandmarker> {
  return HandLandmarker.createFromOptions(fileset(), {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  })
}

async function init(wantFace: boolean): Promise<void> {
  try {
    hands = await createHands('GPU')
  } catch (gpuErr) {
    // Safari / older GPUs often refuse the WebGL delegate; CPU still tracks.
    try {
      hands = await createHands('CPU')
    } catch (cpuErr) {
      const gpu = gpuErr instanceof Error ? gpuErr.message : String(gpuErr)
      const cpu = cpuErr instanceof Error ? cpuErr.message : String(cpuErr)
      throw new Error(`hand model failed (GPU: ${gpu}; CPU: ${cpu})`)
    }
  }

  // Hands are the feature — publish ready before the optional face model, which
  // has been seen to hang on a GPU delegate instead of rejecting.
  post({ type: 'ready', face: false })

  if (!wantFace) return
  try {
    faces = await FaceDetector.createFromOptions(fileset(), {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    })
  } catch {
    try {
      faces = await FaceDetector.createFromOptions(fileset(), {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
      })
    } catch {
      faces = null
    }
  }
}

/** Face detection runs at a third of the hand rate — it barely moves. */
let faceTick = 0
let lastFace: HandFrame['face'] = null

function run(bitmap: ImageBitmap, t: number): void {
  if (!hands) {
    bitmap.close()
    return
  }
  const started = performance.now()
  const result = hands.detectForVideo(bitmap, t)

  faceTick = (faceTick + 1) % 3
  if (faces && faceTick === 0) {
    const detections = faces.detectForVideo(bitmap, t).detections
    lastFace = boxOf(detections, bitmap.width, bitmap.height)
  }

  bitmap.close()

  post({
    type: 'result',
    t,
    hands: result.landmarks ?? [],
    handedness: (result.handedness ?? []).map(
      (h) => (h[0]?.categoryName === 'Left' ? 'Left' : 'Right') as 'Left' | 'Right',
    ),
    face: lastFace,
    cost: performance.now() - started,
  })
}

function boxOf(detections: Detection[], w: number, h: number): HandFrame['face'] {
  const box = detections[0]?.boundingBox
  if (!box) return null
  return { x: box.originX / w, y: box.originY / h, w: box.width / w, h: box.height / h }
}

function post(message: WorkerOut): void {
  self.postMessage(message)
}

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const message = event.data
  if (message.type === 'init') {
    init(message.face).catch((err: unknown) => {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    })
    return
  }
  if (message.type === 'frame') {
    // Drop rather than queue: a backlog of bitmaps is latency the user feels as
    // their hand arriving somewhere they left half a second ago.
    if (busy || !hands) {
      message.bitmap.close()
      return
    }
    busy = true
    try {
      run(message.bitmap, message.t)
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      busy = false
    }
    return
  }
  if (message.type === 'close') {
    hands?.close()
    faces?.close()
    hands = null
    faces = null
  }
}
