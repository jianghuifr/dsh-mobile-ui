/**
 * The keyboard inset, replayed against a stubbed `visualViewport`.
 *
 * Headless Chrome has no soft keyboard and no URL bar, so the two situations
 * that broke this code are only reachable by faking the numbers the browser
 * would report. Three platform behaviours matter:
 *
 *   iOS                keyboard overlays the page; the layout viewport is
 *                      unchanged  -> an inset IS owed
 *   Android            `interactive-widget=resizes-content` lets the keyboard
 *   (resizes-content)  shrink the layout viewport too, so the page is already
 *                      the right size -> NOTHING is owed
 *   Android            the keyboard shrinks only the visual viewport
 *   (resizes-visual)   -> an inset IS owed
 *
 * Getting the second one wrong stacks an inset on a resize the browser already
 * performed and lifts the composer to the top of the screen.
 */

import { createReporter, open, sleep } from '../harness.mjs'

const STUB = `
  (() => {
    const real = window.visualViewport
    if (!real) return
    const listeners = { resize: [], scroll: [] }
    const stub = {
      get height() { return window.__vvHeight === undefined ? real.height : window.__vvHeight },
      get width() { return real.width },
      get offsetTop() { return window.__vvOffsetTop === undefined ? 0 : window.__vvOffsetTop },
      get offsetLeft() { return real.offsetLeft },
      get pageTop() { return real.pageTop },
      get pageLeft() { return real.pageLeft },
      get scale() { return real.scale },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn) },
      removeEventListener(type, fn) {
        const list = listeners[type] || []
        const i = list.indexOf(fn)
        if (i >= 0) list.splice(i, 1)
      },
    }
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => stub })
    let fakeInner = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => fakeInner })
    window.__vvBase = real.height
    window.__vv = {
      set(h) { window.__vvHeight = h; for (const fn of listeners.resize) fn(new Event('resize')) },
      setInner(h) { fakeInner = h; for (const fn of listeners.resize) fn(new Event('resize')) },
      scroll(top) { window.__vvOffsetTop = top; for (const fn of listeners.scroll) fn(new Event('scroll')) },
      reset() { window.__vvHeight = undefined; window.__vvOffsetTop = 0; fakeInner = window.__vvBase },
    }
  })()
`

const READ = `(() => ({
  kb: getComputedStyle(document.documentElement).getPropertyValue('--dshm-kb').trim(),
  attr: document.documentElement.getAttribute('data-dsh-kb'),
  framePad: getComputedStyle(document.querySelector('[data-dsh-part="frame"]')).paddingBottom,
}))()`

const COUNT = `(() => {
  window.__w = { n: 0 }
  window.__wObs = new MutationObserver((records) => {
    for (const r of records) if (r.type === 'attributes' && r.attributeName === 'data-dsh-kb') window.__w.n++
  })
  window.__wObs.observe(document.documentElement, { attributes: true })
  return true
})()`

const KB = 300

export async function run(page, url) {
  const report = createReporter('VV')

  await page.enable()
  // Registered on the PAGE, not the document, so it outlives this check's
  // navigations. It shadows visualViewport and innerHeight, which would corrupt
  // every check that runs after this one — so it is removed again below.
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })
  try {
    await runWithStub(page, url, report)
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
  }
  report.finish()
}

async function runWithStub(page, url, report) {
  await open(page, url)
  const base = await page.eval('window.__vvBase')
  console.log('baseline visual viewport height:', base)

  console.log('--- 1. URL bar oscillating, nothing focused ---')
  await page.eval(COUNT)
  for (let i = 0; i < 30; i++) {
    await page.eval(`window.__vv.set(${base - (i % 2 === 0 ? 0 : 65)})`)
    await sleep(30)
  }
  const urlBar = await page.eval(READ)
  const urlBarWrites = await page.eval('window.__w.n')
  console.log(`  state: ${JSON.stringify(urlBar)} writes=${urlBarWrites}`)
  report.check(urlBarWrites === 0, `URL-bar oscillation caused ${urlBarWrites} inset writes`)
  report.check(urlBar.kb === '0px', `inset is ${urlBar.kb} with nothing focused`)
  await page.eval('window.__vv.reset()')
  await sleep(300)

  console.log('--- 2. iOS: keyboard overlays, layout viewport unchanged ---')
  await page.eval(`(() => { const e = document.querySelector('[data-composer-seat] [contenteditable="true"]'); if (e) e.focus() })()`)
  await sleep(400)
  await page.eval(`window.__vv.set(${base} - ${KB})`)
  await sleep(500)
  const ios = await page.eval(READ)
  console.log(`  state: ${JSON.stringify(ios)}`)
  report.check(ios.kb === `${KB}px`, `iOS: expected a ${KB}px inset, got ${ios.kb}`)
  report.check(ios.framePad === `${KB}px`, `iOS: expected frame padding ${KB}px, got ${ios.framePad}`)

  console.log('--- 3. Android resizes-content: the browser already shrank the layout ---')
  await page.eval(`window.__vv.setInner(${base} - ${KB})`)
  await page.eval(`window.__vv.set(${base} - ${KB})`)
  await sleep(500)
  const android = await page.eval(READ)
  console.log(`  state: ${JSON.stringify(android)}`)
  report.check(android.kb === '0px', `Android resizes-content: inset must be 0 (no double count), got ${android.kb}`)
  report.check(android.framePad === '0px', `Android resizes-content: expected frame padding 0, got ${android.framePad}`)

  console.log('--- 4. keyboard closing releases ---')
  await page.eval(`window.__vv.setInner(${base})`)
  await page.eval(`window.__vv.set(${base} - 40)`)
  await sleep(400)
  const closing = await page.eval(READ)
  report.check(closing.kb === '0px', `inset did not release while closing (${closing.kb})`)

  console.log('--- 5. blur releases ---')
  await page.eval(`(() => { const e = document.querySelector('[data-composer-seat] [contenteditable="true"]'); if (e) e.blur() })()`)
  await sleep(400)
  await page.eval('window.__vv.reset()')
  await sleep(400)
  const blurred = await page.eval(READ)
  report.check(blurred.attr === null, 'the inset stayed engaged after blur')

  console.log('--- 6. idle viewport scrolling writes nothing ---')
  await page.eval(COUNT)
  for (let i = 0; i < 40; i++) {
    await page.eval(`window.__vv.scroll(${i * 4})`)
    await sleep(20)
  }
  const scrollWrites = await page.eval('window.__w.n')
  console.log(`  writes=${scrollWrites}`)
  report.check(scrollWrites === 0, `idle viewport scrolling caused ${scrollWrites} writes`)
  await page.eval('window.__vv.reset()')
}
