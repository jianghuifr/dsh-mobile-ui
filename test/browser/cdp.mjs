/**
 * Minimal Chrome DevTools Protocol driver — emulate a phone, tap, evaluate,
 * screenshot. No npm install: it reuses the `ws` inside the global dsh install.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(
  '/Users/jianghui/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/package.json',
)
const WebSocket = require('ws')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export { sleep }

export async function launch({ port = 9333, headless = true } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-cdp-'))
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--hide-scrollbars',
    'about:blank',
  ]
  if (headless) args.unshift('--headless=new')
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stderr.on('data', () => {})
  proc.stdout.on('data', () => {})

  let version
  for (let i = 0; i < 100; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
      break
    } catch {
      await sleep(150)
    }
  }
  if (!version) throw new Error('chrome debug endpoint never came up')
  return { proc, profile, port, version }
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  let id = 0
  const pending = new Map()
  const listeners = []

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.id !== undefined) {
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`))
      else entry.resolve(msg.result)
    } else {
      for (const fn of listeners) fn(msg)
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      const timer = setTimeout(() => {
        pending.delete(msgId)
        reject(new Error(`${method}: no response from the browser after 30s`))
      }, 30_000)
      pending.set(msgId, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
        method,
      })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })

  const page = {
    ws,
    send,
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),

    async enable() {
      await send('Page.enable')
      await send('Runtime.enable')
      await send('DOM.enable')
      await send('Log.enable')
    },

    async emulate({ width, height, dsf = 2, mobile = true }) {
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: dsf, mobile,
        screenWidth: width, screenHeight: height,
      })
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 })
    },

    async navigate(url, { waitMs = 2500 } = {}) {
      await send('Page.navigate', { url })
      await sleep(waitMs)
    },

    async eval(expression) {
      const res = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true, userGesture: true,
      })
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description ?? JSON.stringify(res.exceptionDetails))
      }
      return res.result.value
    },

    async shot(path) {
      const res = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
      writeFileSync(path, Buffer.from(res.data, 'base64'))
      return path
    },

    async tap(x, y, { delay = 60 } = {}) {
      const point = [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }]
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point })
      await sleep(delay)
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await sleep(300)
    },

    async tapSelector(selector, { index = 0, settle = 350 } = {}) {
      const box = await page.eval(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}]
        if (!el) return null
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) return { zero: true }
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, tag: el.tagName }
      })()`)
      if (!box || box.zero) return { hit: false, box }
      await page.tap(box.x, box.y)
      await sleep(settle)
      return { hit: true, box }
    },
  }
  return page
}

export async function newPage(port) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  return connect(target.webSocketDebuggerUrl)
}

export async function withBrowser(fn, opts = {}) {
  const browser = await launch(opts)
  const page = await newPage(browser.port)
  await page.enable()
  try {
    return await fn(page, browser)
  } finally {
    try { page.close() } catch { /* best-effort teardown */ }
    try { browser.proc.kill('SIGKILL') } catch { /* best-effort teardown */ }
    try { rmSync(browser.profile, { recursive: true, force: true }) } catch { /* best-effort teardown */ }
  }
}
