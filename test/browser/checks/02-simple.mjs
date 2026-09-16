/**
 * The decluttered mobile chrome.
 *
 * Default: a text field and a Send button, with the composer's tools behind a
 * small reveal toggle; the header loses the Finder/Terminal split button and the
 * session-download menu; the statistics strip is gone.
 *
 * The header half of this needs a NON-BLANK session — while a session is blank
 * the app applies `headerHidden` (display:none), every header assertion passes
 * vacuously, and the check looks green while proving nothing. So the check
 * sends one message first and refuses to run the header half without it.
 */

import { createReporter, open, newSession, makeSessionNonBlank } from '../harness.mjs'

const STATE = `(() => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
  const vis = (sel) => {
    const e = document.querySelector(sel)
    if (!e) return 'absent'
    const r = e.getBoundingClientRect()
    return (getComputedStyle(e).display === 'none' || r.width < 1 || r.height < 1) ? 'hidden' : 'shown'
  }
  const header = document.querySelector('[data-dsh-part="chatHeader"]')
  const shownHeaderButtons = header
    ? [...header.querySelectorAll('button')]
        .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(b).display !== 'none' })
        .map((b) => b.getAttribute('aria-label') || (b.textContent || '').trim().slice(0, 16))
    : []
  return {
    headerVisible: header ? getComputedStyle(header).display !== 'none' : false,
    composerMode: document.documentElement.getAttribute('data-dsh-composer'),
    headerOpenInApp: vis('[data-dsh-part="chatHeader"] [class*="_split"]'),
    headerMore: vis('[data-dsh-part="chatHeader"] [class*="_moreButton"]'),
    stats: vis('[data-composer-stats]'),
    tools: vis('[data-composer-seat] [class*="_tools"]'),
    modelChip: vis('[data-composer-seat] [class*="_trailing"] [class*="_trigger"]'),
    send: vis('[data-composer-seat] [class*="_primary"]'),
    editable: vis('[data-composer-seat] [contenteditable="true"]'),
    toggle: vis('[data-dsh-composer-toggle]'),
    toggleBox: R(document.querySelector('[data-dsh-composer-toggle]')),
    sendBox: R(document.querySelector('[data-composer-seat] [class*="_primary"]')),
    headerButtons: shownHeaderButtons,
  }
})()`

export async function run(page, url) {
  const report = createReporter('SIMPLE')

  console.log('--- collapsed (default) ---')
  await open(page, url)
  await newSession(page)
  const collapsed = await page.eval(STATE)
  console.log(JSON.stringify(collapsed))
  report.check(collapsed.composerMode === 'simple', `composer mode is ${collapsed.composerMode}, expected simple`)
  report.check(collapsed.tools === 'hidden', `tool row still visible (${collapsed.tools})`)
  report.check(collapsed.modelChip === 'hidden', `model chip still visible (${collapsed.modelChip})`)
  report.check(collapsed.stats !== 'shown', `statistics strip still visible (${collapsed.stats})`)
  report.check(collapsed.send === 'shown', 'the Send button is not visible')
  report.check(collapsed.toggle === 'shown', 'the reveal toggle is not visible')
  report.check(collapsed.editable === 'shown', 'the text field is not visible')
  report.check(collapsed.sendBox && collapsed.sendBox[0] > 250, `Send is not at the right edge: ${JSON.stringify(collapsed.sendBox)}`)
  report.check(collapsed.toggleBox && collapsed.toggleBox[0] < 60, `toggle is not at the left edge: ${JSON.stringify(collapsed.toggleBox)}`)

  console.log('--- expand via the toggle ---')
  await page.tapSelector('[data-dsh-composer-toggle]')
  await page.eval('1')
  const expanded = await page.eval(STATE)
  console.log(JSON.stringify({ mode: expanded.composerMode, tools: expanded.tools, modelChip: expanded.modelChip }))
  report.check(expanded.composerMode === 'full', `toggle did not expand (${expanded.composerMode})`)
  report.check(expanded.tools === 'shown', 'expanded but the tool row is still hidden')
  report.check(expanded.modelChip === 'shown', 'expanded but the model chip is still hidden')

  console.log('--- collapse again ---')
  await page.tapSelector('[data-dsh-composer-toggle]')
  const recollapsed = await page.eval(STATE)
  report.check(recollapsed.composerMode === 'simple', 'toggle did not collapse again')
  report.check(recollapsed.tools === 'hidden', 'collapsed but the tool row is still visible')

  console.log('--- header, once the session has content ---')
  await makeSessionNonBlank(page)
  const header = await page.eval(STATE)
  console.log(JSON.stringify({
    headerVisible: header.headerVisible,
    buttons: header.headerButtons,
    openInApp: header.headerOpenInApp,
    more: header.headerMore,
  }))
  report.check(header.headerVisible === true,
    'the header never appeared, so the header rules proved nothing')
  if (header.headerVisible) {
    report.check(header.headerMore !== 'shown', `session-download menu still visible (${header.headerMore})`)
    report.check(header.headerOpenInApp !== 'shown', `Finder/Terminal button still visible (${header.headerOpenInApp})`)
    report.check(header.headerButtons.length > 0, 'no header buttons rendered at all')
    report.check(header.headerButtons.some((l) => /右侧边栏/.test(l || '')),
      `the right-panel toggle was hidden too (kept: ${JSON.stringify(header.headerButtons)})`)
  }

  console.log('--- desktop is untouched ---')
  await open(page, url, { width: 1280, height: 900 })
  const desktop = await page.eval(STATE)
  const mobile = await page.eval(`document.documentElement.getAttribute('data-dsh-mobile')`)
  console.log(JSON.stringify({ mobile, composerMode: desktop.composerMode, tools: desktop.tools, headerMore: desktop.headerMore }))
  report.check(mobile === 'false', 'not in the desktop layout')
  report.check(desktop.composerMode === null, `desktop carries a composer mode (${desktop.composerMode})`)
  report.check(desktop.tools === 'shown', 'desktop composer lost its tool row')
  report.check(desktop.headerMore !== 'hidden', 'desktop header lost the session-download menu')

  report.finish()
}
