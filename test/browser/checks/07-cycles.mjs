/**
 * Every overlay returns an interactive main surface.
 *
 * The failure this guards against is a fixed, full-viewport column that keeps
 * hit-testing while its panel is hidden: every tap on the header, transcript and
 * composer lands on an invisible box and the app looks frozen. Geometry checks
 * and screenshots both miss it — only a hit test or a real tap sees it.
 *
 * Both orders matter, and so does the settings sheet, which renders *inside* the
 * sidebar and inherits `pointer-events` from it.
 */

import { createReporter, open, ensureSession, openDrawer, NAV } from '../harness.mjs'

const PROBE = `(() => {
  const reach = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return 'missing'
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return 'zero-size'
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
    const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)
    const hit = document.elementFromPoint(x, y)
    return (el === hit || el.contains(hit)) ? 'ok' : 'BLOCKED by ' + (hit ? hit.tagName + '.' + String(hit.className).slice(-20) : 'nothing')
  }
  const panel = document.querySelector('[data-sidebar-right-panel]')
  const col = document.querySelector('[data-dsh-part="rightbarCol"]')
  return {
    rightpanel: document.documentElement.getAttribute('data-dsh-rightpanel'),
    drawer: document.documentElement.getAttribute('data-dsh-drawer'),
    modal: document.documentElement.getAttribute('data-dsh-modal'),
    colPE: col ? getComputedStyle(col).pointerEvents : null,
    panelVisible: panel ? getComputedStyle(panel).visibility : null,
    panelX: panel ? Math.round(panel.getBoundingClientRect().x) : null,
    nav: reach(${JSON.stringify(NAV)}),
    composer: reach('[data-composer-seat] [contenteditable="true"]'),
    send: reach('[data-composer-seat] [class*="_primary"]'),
  }
})()`

/** The settings sheet is interactive, not merely painted. */
const SETTINGS = `(() => {
  const nav = document.querySelector('[class*="_navCell"]')
  if (!nav) return { open: false }
  const opts = document.querySelector('[class*="_options"]')
  const reach = (el) => {
    if (!el) return 'missing'
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return 'zero-size'
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
    const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)
    const hit = document.elementFromPoint(x, y)
    return (el === hit || el.contains(hit)) ? 'ok' : 'BLOCKED by ' + (hit ? String(hit.className).slice(-20) : 'nothing')
  }
  const cards = [...document.querySelectorAll('button')].filter((b) => ['浅色', '深色', '跟随系统'].includes((b.textContent || '').trim()))
  let scrolls = null
  let scrollable = null
  if (opts) {
    scrollable = opts.scrollHeight > opts.clientHeight + 1
    const before = opts.scrollTop
    opts.scrollTop = 200
    scrolls = opts.scrollTop > before
    opts.scrollTop = before
  }
  return {
    open: true,
    nav: reach(nav),
    firstControl: reach(document.querySelector('[class*="_options"] [class*="_trigger"], [class*="_options"] button')),
    closeButton: reach(document.querySelector('[class*="_close"]')),
    appearanceCard: cards.length ? reach(cards[0]) : 'missing',
    appearanceCount: cards.length,
    scrolls,
    scrollable,
    fits: opts ? opts.getBoundingClientRect().bottom <= innerHeight + 1 : null,
  }
})()`

export async function run(page, url) {
  const report = createReporter('CYCLES')

  await open(page, url)
  if (!(await ensureSession(page))) {
    report.check(false, 'no usable session, and one could not be created')
    report.finish()
    return
  }

  console.log('--- 1. right panel (file manager): open -> close ---')
  const base = await page.eval(PROBE)
  console.log('  baseline   :', JSON.stringify(base))
  for (const key of ['nav', 'composer', 'send']) report.check(base[key] === 'ok', `baseline ${key} is ${base[key]}`)

  await page.tapSelector('[aria-label="打开右侧边栏"]')
  await new Promise((r) => setTimeout(r, 1400))
  const opened = await page.eval(PROBE)
  console.log('  after open :', JSON.stringify(opened))
  report.check(opened.panelVisible === 'visible', 'the file manager did not become visible')
  report.check(opened.colPE === 'none', 'the right column hit-tests while open — it would block its own panel')

  await page.tapSelector('[aria-label="收起右侧边栏"]')
  await new Promise((r) => setTimeout(r, 1800))
  const closed = await page.eval(PROBE)
  console.log('  after close:', JSON.stringify(closed))
  for (const key of ['nav', 'composer', 'send']) {
    report.check(closed[key] === 'ok', `after closing the file manager, ${key} is ${closed[key]}`)
  }
  report.check(closed.panelVisible === 'hidden', 'the file manager stayed visible after close')

  await new Promise((r) => setTimeout(r, 2000))
  const settled = await page.eval(PROBE)
  for (const key of ['nav', 'composer', 'send']) {
    report.check(settled[key] === 'ok', `2s after closing, ${key} is ${settled[key]}`)
  }

  console.log('--- 2. settings sheet ---')
  await openDrawer(page)
  await page.tapSelector('[aria-label="设置"]')
  await new Promise((r) => setTimeout(r, 1600))
  const sheet = await page.eval(SETTINGS)
  console.log('  settings   :', JSON.stringify(sheet))
  report.check(sheet.open === true, 'the settings sheet did not open')
  if (sheet.open) {
    for (const key of ['nav', 'firstControl', 'closeButton']) {
      report.check(sheet[key] === 'ok', `settings ${key} not tappable — ${sheet[key]}`)
    }
    report.check(sheet.appearanceCount === 3, `expected 3 appearance cards, saw ${sheet.appearanceCount}`)
    report.check(sheet.appearanceCard === 'ok', `appearance card not tappable — ${sheet.appearanceCard}`)
    report.check(sheet.scrollable !== true || sheet.scrolls === true, 'settings overflows but will not scroll')
    report.check(sheet.fits !== false, 'settings list overflows the sheet instead of scrolling')
  }
  await page.eval(`(() => { const c = document.querySelector('[class*="_close"]'); if (c) c.click() })()`)
  await new Promise((r) => setTimeout(r, 1200))
  const afterSheet = await page.eval(PROBE)
  for (const key of ['nav', 'composer', 'send']) {
    report.check(afterSheet[key] === 'ok', `after closing settings, ${key} is ${afterSheet[key]}`)
  }

  console.log('--- 3. drawer and right panel nested ---')
  await openDrawer(page)
  await page.eval(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>/打开右侧边栏/.test(x.getAttribute('aria-label')||'')); if(b) b.click() })()`)
  await new Promise((r) => setTimeout(r, 1400))
  await page.eval(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>/收起右侧边栏/.test(x.getAttribute('aria-label')||'')); if(b) b.click() })()`)
  await new Promise((r) => setTimeout(r, 1400))
  await page.tap(370, 400)
  await new Promise((r) => setTimeout(r, 1000))
  const nested = await page.eval(PROBE)
  console.log('  both closed:', JSON.stringify(nested))
  for (const key of ['nav', 'composer', 'send']) {
    report.check(nested[key] === 'ok', `after closing both overlays, ${key} is ${nested[key]}`)
  }

  report.finish()
}
