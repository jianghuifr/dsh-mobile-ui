/**
 * The composer under a keyboard, on the Android `resizes-content` path.
 *
 * `Emulation.setDeviceMetricsOverride` resizes the *layout* viewport exactly the
 * way resizes-content does, so this reproduces "the keyboard opened" without a
 * soft keyboard: the number that matters is `window.innerHeight`.
 *
 * The bug this guards against is an inset added on top of the resize the browser
 * already performed — the composer is then lifted by twice the keyboard height
 * and ends up near the top of the screen, which is what a user sees as "the
 * input box drifted to the top".
 */

import { createReporter, open, openSession, sleep } from '../harness.mjs'

const FULL = 844
const KEYBOARD = 320

const READ = `(() => {
  const R = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }
  }
  return {
    innerHeight: window.innerHeight,
    inset: getComputedStyle(document.documentElement).getPropertyValue('--dshm-kb').trim(),
    framePad: getComputedStyle(document.querySelector('[data-dsh-part="frame"]')).paddingBottom,
    composer: R('[data-composer-seat]'),
    send: R('[data-composer-seat] [class*="_primary"]'),
  }
})()`

export async function run(page, url) {
  const report = createReporter('COMPOSER-KB')

  await open(page, url, { height: FULL })
  if (!(await openSession(page))) {
    report.check(false, 'no session row to open')
    report.finish()
    return
  }

  console.log('--- A. before the keyboard ---')
  const before = await page.eval(READ)
  console.log(JSON.stringify(before))
  report.check(before.innerHeight === FULL, `baseline innerHeight ${before.innerHeight} != ${FULL}`)
  report.check(before.inset === '0px', `baseline inset should be 0, got ${before.inset}`)
  report.check(before.composer.bottom <= FULL + 1 && before.composer.bottom > FULL - 260,
    `composer should sit at the bottom, bottom=${before.composer.bottom}`)

  console.log('--- B. keyboard open (layout viewport shrunk) ---')
  await page.eval(`(() => { const e = document.querySelector('[data-composer-seat] [contenteditable="true"]'); if (e) e.focus() })()`)
  await sleep(400)
  await page.emulate({ width: 390, height: FULL - KEYBOARD })
  await sleep(1200)
  const openState = await page.eval(READ)
  console.log(JSON.stringify(openState))
  const visible = FULL - KEYBOARD
  report.check(openState.inset === '0px',
    `inset must stay 0 — the browser already resized; got ${openState.inset}`)
  report.check(openState.framePad === '0px', `frame padding must stay 0, got ${openState.framePad}`)
  report.check(openState.composer.bottom <= visible + 1,
    `composer bottom ${openState.composer.bottom} goes past the visible area ${visible}`)
  report.check(openState.composer.bottom > visible - 260,
    `composer drifted away from the keyboard: bottom=${openState.composer.bottom}, visible=${visible}`)
  if (openState.send) {
    report.check(openState.send.bottom <= visible + 1,
      `the Send button is under the keyboard (${openState.send.bottom} > ${visible})`)
  }

  console.log('--- C. keyboard closed again ---')
  await page.emulate({ width: 390, height: FULL })
  await sleep(1000)
  const closed = await page.eval(READ)
  console.log(JSON.stringify(closed))
  report.check(closed.inset === '0px', `inset should be back to 0, got ${closed.inset}`)
  report.check(closed.composer.bottom <= FULL + 1 && closed.composer.bottom > FULL - 260,
    `composer should be back at the bottom, bottom=${closed.composer.bottom}`)

  report.finish()
}
