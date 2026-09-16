/**
 * Layout invariants across the phone-size viewports that matter.
 *
 * The welcome screen is enough for all of these: the frame, the drawer and the
 * composer are present before any session is opened, so this check needs no
 * model and no session.
 */

import { createReporter, open, openDrawer, closeDrawer, NAV } from '../harness.mjs'

const DEVICES = [
  { name: 'iPhone SE', w: 320, h: 568 },
  { name: 'iPhone 13 mini', w: 375, h: 812 },
  { name: 'iPhone 15', w: 393, h: 852 },
  { name: 'Pixel 8', w: 412, h: 915 },
  { name: 'iPhone 15 Pro Max', w: 430, h: 932 },
  { name: 'iPad mini portrait', w: 768, h: 1024 },
  { name: 'iPhone 15 landscape', w: 852, h: 393 },
]

const MEASURE = `(() => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
  const q = (s) => document.querySelector(s)
  const reach = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || r.right <= 0 || r.left >= innerWidth) return null
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
    const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)
    const hit = document.elementFromPoint(x, y)
    return (el === hit || el.contains(hit)) ? 'ok' : 'BLOCKED by ' + (hit ? hit.tagName + '.' + String(hit.className).slice(-22) : 'nothing')
  }
  // Anything that pokes outside the viewport, except the parked drawer which
  // sits off the left edge on purpose.
  let worst = null
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    if (el.closest('[data-dsh-part="sidebarCol"]') || el.matches('[data-dsh-part="sidebarCol"]')) continue
    const over = Math.max(r.right - innerWidth, -r.left)
    if (over > 4 && (worst === null || over > worst.by)) {
      worst = { by: Math.round(over), cls: String(el.className).slice(-30), r: [Math.round(r.x), Math.round(r.width)] }
    }
  }
  const composer = q('[data-composer-seat] [contenteditable="true"]')
  const row = q('[data-composer-seat] [class*="_row"]')
  const send = q('[data-composer-seat] [class*="_primary"]')
  const frame = q('[data-dsh-part="frame"]')
  return {
    mobile: document.documentElement.getAttribute('data-dsh-mobile'),
    drawer: document.documentElement.getAttribute('data-dsh-drawer'),
    frameCols: frame ? getComputedStyle(frame).gridTemplateColumns : null,
    centerW: R(q('[data-dsh-part="centerCol"]'))?.[2] ?? null,
    drawerBox: R(q('[data-dsh-part="sidebarCol"]')),
    docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    worst,
    composerFont: composer ? getComputedStyle(composer).fontSize : null,
    rowHeight: row ? Math.round(row.getBoundingClientRect().height) : null,
    sendBox: R(send),
    reach: { nav: reach(q(${JSON.stringify(NAV)})), send: reach(send), composer: reach(composer) },
  }
})()`

export async function run(page, url) {
  const report = createReporter('SMOKE')

  for (const device of DEVICES) {
    await open(page, url, { width: device.w, height: device.h, settle: 1800 })

    const welcome = await page.eval(MEASURE)
    await openDrawer(page)
    const drawer = await page.eval(MEASURE)
    await closeDrawer(page)
    const closed = await page.eval(MEASURE)

    const line = (label, m) =>
      `  ${label.padEnd(9)} center=${m.centerW} cols=${m.frameCols} drawer=${m.drawer} ovfX=${m.docOverflowX} font=${m.composerFont} rowH=${m.rowHeight} reach=${JSON.stringify(m.reach)}`
    console.log(`--- ${device.name} (${device.w}x${device.h}) ---`)
    console.log(line('welcome', welcome))
    console.log(line('drawer', drawer))
    console.log(line('closed', closed))
    for (const [label, m] of [['welcome', welcome], ['drawer', drawer], ['closed', closed]]) {
      if (m.worst) console.log(`  ${label} overflow: ${JSON.stringify(m.worst)}`)
    }

    const at = device.name
    report.check(welcome.mobile === 'true', `${at}: not recognised as mobile`)
    report.check(welcome.centerW === device.w, `${at}: center column is ${welcome.centerW}, expected ${device.w}`)
    report.check(drawer.drawer === 'open', `${at}: drawer did not open (${drawer.drawer})`)
    report.check(closed.drawer === 'closed', `${at}: drawer did not close (${closed.drawer})`)
    report.check(Math.abs(drawer.drawerBox[0]) <= 1, `${at}: open drawer not at the left edge (x=${drawer.drawerBox[0]})`)
    report.check(closed.drawerBox[0] + closed.drawerBox[2] <= 1, `${at}: closed drawer still on screen`)
    report.check(welcome.docOverflowX <= 1, `${at}: document scrolls horizontally by ${welcome.docOverflowX}px`)
    report.check(welcome.composerFont === null || parseFloat(welcome.composerFont) >= 16,
      `${at}: composer font ${welcome.composerFont} < 16px (iOS will zoom)`)
    report.check(welcome.rowHeight === null || welcome.rowHeight <= 60,
      `${at}: composer control row wrapped to ${welcome.rowHeight}px`)
    report.check(drawer.worst === null || drawer.worst.by < 60, `${at}: drawer content overflows by ${drawer.worst?.by}px`)
    report.check(closed.worst === null || closed.worst.by < 12, `${at}: content overflows by ${closed.worst?.by}px`)
    for (const [name, verdict] of Object.entries(closed.reach)) {
      report.check(verdict === null || verdict === 'ok', `${at}: ${name} not tappable — ${verdict}`)
    }
  }

  report.finish()
}
