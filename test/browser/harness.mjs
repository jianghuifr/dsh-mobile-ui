/**
 * Shared fixtures for the browser checks.
 *
 * These run against a real dsh instance in a real browser, which is the only
 * way some of this plugin's invariants can be checked at all — an overlay that
 * paints but answers no taps, or a composer that drifts under a keyboard, looks
 * perfectly fine to a geometry assertion and to a screenshot.
 *
 * Three lessons are baked into the helpers here, each learned by getting it
 * wrong first:
 *
 * 1. **A blank session hides the header.** `ConversationRoot` applies
 *    `headerHidden` (display:none) while `session.blank`, so a check that opens
 *    the newest session and looks for header controls passes vacuously. Use
 *    {@link openSession} with `blank: false`.
 * 2. **Submitting changes the world.** Sending a message starts an agent turn,
 *    which alters how the composer behaves and adds transcript nodes on its
 *    own. Anything asserting a delta needs {@link freshPage} per case.
 * 3. **The hero layout is centred.** Opening an empty "新会话" gives a
 *    vertically centred composer, so bottom-anchored assertions fail for a
 *    reason unrelated to what is being tested.
 *
 * @module dsh-mobile-ui/test/browser/harness
 */

import { sleep } from './cdp.mjs'

export { sleep }

/** Collect failures so one run reports every problem, not just the first. */
export function createReporter(title) {
  const problems = []
  return {
    problems,
    /** Record a failure when `ok` is falsy. */
    check(ok, what) {
      if (!ok) problems.push(what)
    },
    /** Print the verdict; sets a non-zero exit code on failure. */
    finish() {
      console.log('')
      if (problems.length === 0) {
        console.log(`${title} PASS`)
        return
      }
      console.log(`${title} FAIL — ${problems.length}:`)
      for (const problem of problems) console.log('  - ' + problem)
      process.exitCode = 1
    },
  }
}

/** The drawer's own toggle, injected by the plugin. */
export const NAV = '[data-dsh-part="nav"]'

/** Point the browser at `url` with a phone viewport and let the app settle. */
export async function open(page, url, { width = 390, height = 844, settle = 2500 } = {}) {
  await page.emulate({ width, height })
  await page.navigate(url, { waitMs: 5000 })
  await sleep(settle)
}

export async function openDrawer(page) {
  await page.tapSelector(NAV)
  await sleep(800)
}

/**
 * Tap the scrim, just right of the drawer, the way a thumb would.
 *
 * The x is computed, never hardcoded: the drawer is `min(86vw, 320px)`, so on a
 * 320px phone it ends at ~275 and a fixed 370 is simply off-screen — the tap
 * lands nowhere and the drawer stays open.
 */
export async function closeDrawer(page) {
  const point = await page.eval(`(() => {
    const drawer = document.querySelector('[data-dsh-part="sidebarCol"]')
    const r = drawer ? drawer.getBoundingClientRect() : null
    const x = r ? Math.min(innerWidth - 12, Math.max(12, r.right + 24)) : innerWidth - 12
    return { x: Math.round(x), y: Math.round(innerHeight / 2) }
  })()`)
  await page.tap(point.x, point.y)
  await sleep(800)
}

export async function newSession(page) {
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /新建会话/.test(x.getAttribute('aria-label') || ''))
    if (b) b.click()
  })()`)
  await sleep(2500)
  await page.eval(`(() => { const e = document.querySelector('[data-composer-seat] [contenteditable="true"]'); if (e) e.focus() })()`)
  await sleep(300)
}

/**
 * Open a usable session from the drawer.
 *
 * Two session states have to be skipped or every composer assertion fails for a
 * reason unrelated to the plugin:
 *
 * - **empty "新会话" entries** render the hero layout, where the composer is
 *   vertically centred by design;
 * - **a session whose agent asked a question** replaces the composer with the
 *   question card, so there is no contenteditable to measure at all.
 *
 * So this walks the rows until it finds one where the composer is actually
 * there. A fixture that happens to end on a question should not fail a check
 * about overlays.
 *
 * @param page - the CDP page.
 * @param options - `requireComposer: false` accepts the first non-blank session.
 * @returns whether a usable session was opened.
 */
export async function openSession(page, { requireComposer = true } = {}) {
  await openDrawer(page)
  const total = await page.eval(`document.querySelectorAll('[class*="_sessionRow"]').length`)
  if (total === 0) {
    await closeDrawer(page)
    return false
  }

  for (let i = 0; i < total; i++) {
    const isBlank = await page.eval(`(() => {
      const row = [...document.querySelectorAll('[class*="_sessionRow"]')][${i}]
      return row ? /新会话/.test(row.textContent || '') : true
    })()`)
    if (isBlank) continue

    await page.eval(`(() => { const r = [...document.querySelectorAll('[class*="_sessionRow"]')][${i}]; if (r) r.click() })()`)
    await sleep(2500)

    const usable = await page.eval(`(() => {
      const e = document.querySelector('[data-composer-seat] [contenteditable="true"]')
      if (!e) return false
      const r = e.getBoundingClientRect()
      return r.width > 40 && r.height > 10
    })()`)
    if (!requireComposer || usable) {
      await closeDrawer(page)
      return true
    }
    // Still open on this candidate; reopen the drawer to try the next.
    await openDrawer(page)
  }

  await closeDrawer(page)
  return false
}

/**
 * Open a session that is usable, creating one if the host has none.
 *
 * A host can legitimately have zero sessions — a throwaway one seeded by the
 * runner does — and then the app sits in the hero layout, where the composer is
 * centred and the header does not exist. Sending one short message is what turns
 * that into the ordinary conversation layout the checks describe, so this
 * bootstraps it rather than failing every caller.
 *
 * @returns whether a usable session is open.
 */
export async function ensureSession(page) {
  if (await openSession(page)) return true
  console.log('  (no usable session on this host — creating one)')
  await newSession(page)
  await makeSessionNonBlank(page)
  return openSession(page)
}

/**
 * Submit a short message so the session stops being blank.
 *
 * The header only renders once a session has content, so header assertions have
 * nothing to look at until this runs.
 *
 * @returns whether the composer accepted the text.
 */
export async function makeSessionNonBlank(page, text = 'hi') {
  await page.eval(`(() => { const e = document.querySelector('[data-composer-seat] [contenteditable="true"]'); if (e) e.focus() })()`)
  await page.send('Input.insertText', { text })
  await sleep(400)
  const hit = await page.tapSelector('[data-composer-seat] [class*="_primary"]')
  await sleep(4500)
  return hit.hit
}

/** Press a key with an optional CDP modifier bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8). */
export async function press(page, key, modifiers = 0) {
  const virtualKeyCode = key === 'Enter' ? 13 : key === 'Backspace' ? 8 : 0
  const params = { key, code: key, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode, modifiers }
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  await sleep(900)
}

/** Clear the composer draft. */
export async function clearDraft(page) {
  await page.eval(`(() => {
    const e = document.querySelector('[data-composer-seat] [contenteditable="true"]')
    if (!e) return
    e.focus()
    const range = document.createRange()
    range.selectNodeContents(e)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })()`)
  await press(page, 'Backspace')
}

/**
 * A fresh page per case.
 *
 * Submitting in one case starts an agent turn, which changes composer behaviour
 * and grows the transcript on its own — reusing a page silently invalidates any
 * "this count did not change" assertion in the next case.
 */
export async function freshPage(page, url, options = {}) {
  await open(page, url, options)
  return page
}

/** Visibility of an element, distinguishing "absent" from "present but hidden". */
export const visibility = (selector) => `(() => {
  const e = document.querySelector(${JSON.stringify(selector)})
  if (!e) return 'absent'
  const r = e.getBoundingClientRect()
  const cs = getComputedStyle(e)
  return (cs.display === 'none' || r.width < 1 || r.height < 1 || cs.visibility === 'hidden') ? 'hidden' : 'shown'
})()`

/** Whether a control is the topmost element at its own centre point. */
export function reachability(selector) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return 'missing'
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return 'zero-size'
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
    const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)
    const hit = document.elementFromPoint(x, y)
    return (el === hit || el.contains(hit)) ? 'ok'
      : 'BLOCKED by ' + (hit ? hit.tagName + '.' + String(hit.className).slice(-20) : 'nothing')
  })()`
}
