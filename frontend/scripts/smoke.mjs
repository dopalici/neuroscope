/**
 * Headless smoke test for the Mirror route.
 *
 * Drives Chrome over CDP with a fake camera so the GL chain, the shader
 * compiles and the hand worker all run for real. Shader source is only
 * validated by the driver, so a typo in GLSL is invisible to tsc and lint —
 * this is the only cheap way to catch it before the user does.
 *
 *   node scripts/smoke.mjs [url]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_UNDER_TEST = process.argv[2] ?? 'http://localhost:5173/mirror'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333

const profile = mkdtempSync(join(tmpdir(), 'neuroscope-smoke-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      return (await res.json()).webSocketDebuggerUrl
    } catch {
      await sleep(250)
    }
  }
  throw new Error('Chrome never opened a debugging port')
}

function client(url) {
  const ws = new WebSocket(url)
  const pending = new Map()
  const listeners = []
  let id = 0
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
      return
    }
    if (msg.method) {
      for (const fn of listeners) fn(msg)
    }
  })
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  return {
    open,
    on: (fn) => listeners.push(fn),
    send(method, params = {}, sessionId) {
      const message = { id: ++id, method, params }
      if (sessionId) message.sessionId = sessionId
      ws.send(JSON.stringify(message))
      return new Promise((resolve, reject) => pending.set(message.id, { resolve, reject }))
    },
    close: () => ws.close(),
  }
}

const logs = []
const errors = []

try {
  const browser = client(await endpoint())
  await browser.open

  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })

  browser.on((msg) => {
    if (msg.sessionId !== sessionId) return
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ')
      logs.push(`${msg.params.type}: ${text}`)
      if (msg.params.type === 'error') errors.push(text)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      errors.push(d.exception?.description ?? d.text)
    }
  })

  await browser.send('Runtime.enable', {}, sessionId)
  await browser.send('Page.enable', {}, sessionId)
  await browser.send(
    'Browser.grantPermissions',
    { origin: new URL(URL_UNDER_TEST).origin, permissions: ['videoCapture'] },
  )

  await browser.send('Page.navigate', { url: URL_UNDER_TEST }, sessionId)
  await sleep(4000)

  // Turn hands on from the mirror bar (or press 'g') and wait for the worker.
  for (const type of ['keyDown', 'keyUp']) {
    await browser.send(
      'Input.dispatchKeyEvent',
      { type, key: 'g', code: 'KeyG', text: type === 'keyDown' ? 'g' : undefined },
      sessionId,
    )
  }
  await sleep(5000)

  // 'd' opens the dev corner, which is the only place the render loop reports
  // its own frame rate — a stalled loop is otherwise indistinguishable from a
  // slow one in the DOM.
  for (const type of ['keyDown', 'keyUp']) {
    await browser.send(
      'Input.dispatchKeyEvent',
      { type, key: 'd', code: 'KeyD', text: type === 'keyDown' ? 'd' : undefined },
      sessionId,
    )
  }
  await sleep(2500)

  const probe = `(() => {
    const text = (sel) => {
      const el = document.querySelector(sel)
      return el ? el.textContent.trim() : null
    }
    const canvas = document.querySelector('canvas')
    const video = document.querySelector('video')
    // A frame that never advances means the GL loop stalled even though the
    // context is alive, which the DOM alone would not reveal.
    const px = (() => {
      if (!canvas) return null
      const c = document.createElement('canvas')
      c.width = 8
      c.height = 8
      const ctx = c.getContext('2d')
      ctx.drawImage(canvas, 0, 0, 8, 8)
      const d = ctx.getImageData(0, 0, 8, 8).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
      return Math.round(sum / (64 * 3))
    })()
    const handsBtn = [...document.querySelectorAll('.mirror-bar button')].find(
      (b) => b.textContent.trim() === 'Hands',
    )
    return JSON.stringify({
      canvas: !!canvas,
      backing: canvas ? [canvas.width, canvas.height] : null,
      meanLuma: px,
      video: video ? { w: video.videoWidth, h: video.videoHeight, ready: video.readyState } : null,
      hud: !!document.querySelector('.hud'),
      legend: text('.hud-legend'),
      arcValue: text('.hud-arc-value'),
      arcWord: text('.hud-arc-word'),
      arcLabel: text('.hud-arc-label'),
      heart: text('.hud-heart'),
      session: text('.hud-session'),
      chips: [...document.querySelectorAll('.hud-chip')].map((e) => e.textContent.trim()),
      ticker: text('.hud-ticker'),
      promise: text('.hud-promise'),
      fallback: text('.mirror-fallback'),
      dev: text('.hud-dev'),
      contacts: document.querySelectorAll('.hud-pad').length,
      bands: document.querySelectorAll('.hud-band').length,
      handsPressed: handsBtn ? handsBtn.getAttribute('aria-pressed') : null,
      handErr: text('.mirror-hand-err'),
      handNote: text('.mirror-hand-note'),
    })
  })()`
  const result = await browser.send(
    'Runtime.evaluate',
    { expression: probe, returnByValue: true },
    sessionId,
  )

  console.log('--- probe ---')
  console.log(JSON.stringify(JSON.parse(result.result.value), null, 2))
  console.log('--- console ---')
  console.log(logs.length ? logs.join('\n') : '(silent)')
  console.log('--- errors ---')
  console.log(errors.length ? errors.join('\n---\n') : '(none)')

  browser.close()
  process.exitCode = errors.length ? 1 : 0
} finally {
  chrome.kill()
  // Chrome flushes its profile asynchronously after SIGTERM.
  await sleep(500)
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // A leftover temp profile is not worth failing the run over.
  }
}
