/**
 * The plugin must be silent while the app is idle.
 *
 * A plugin that keeps writing attributes, or keeps restarting transitions, on
 * an idle screen is what a user sees as flicker. This asserts zero
 * self-inflicted DOM writes and zero running animations, across an idle window
 * and across a theme switch — the operation that first surfaced the bug.
 */

import { createReporter, open, newSession, sleep } from '../harness.mjs'

const OWN_ATTRS = [
  'data-dsh-part', 'data-dsh-mobile', 'data-dsh-drawer',
  'data-dsh-rightpanel', 'data-dsh-modal', 'data-dsh-kb', 'data-dsh-composer',
]

const ARM = `(() => {
  const own = ${JSON.stringify(OWN_ATTRS)}
  window.__q = { ours: [], theirs: 0, started: performance.now() }
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && own.includes(r.attributeName)) {
        window.__q.ours.push(r.attributeName + ' @' + (String(r.target.className || '').slice(-18) || r.target.tagName))
      } else window.__q.theirs++
    }
  })
  obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
  const tick = () => { window.__q.frames++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  return 'armed'
})()`

const READ = `(() => {
  const q = window.__q
  const anims = document.getAnimations().map((a) => {
    const t = a.effect && a.effect.target
    return (a.animationName || a.transitionProperty || '?') + ' @ ' + (t ? String(t.className || t.tagName).slice(-22) : '?')
  })
  return {
    seconds: Math.round((performance.now() - q.started) / 100) / 10,
    pluginWrites: q.ours.length,
    sample: q.ours.slice(0, 6),
    otherMutations: q.theirs,
    runningAnimations: anims,
    kbInset: getComputedStyle(document.documentElement).getPropertyValue('--dshm-kb').trim(),
  }
})()`

export async function run(page, url) {
  const report = createReporter('QUIET')

  console.log('--- A. idle conversation, 3s ---')
  await open(page, url)
  await newSession(page)
  await page.eval(ARM)
  await sleep(3000)
  const idle = await page.eval(READ)
  console.log(JSON.stringify(idle))
  report.check(idle.pluginWrites === 0, `plugin wrote ${idle.pluginWrites} attributes while idle: ${idle.sample.join(', ')}`)
  report.check(idle.runningAnimations.length === 0, `animations still running: ${idle.runningAnimations.join(', ')}`)
  report.check(!idle.kbInset || idle.kbInset === '0px', `keyboard inset is ${idle.kbInset} with nothing focused`)

  console.log('--- B. theme switch, then 3s idle ---')
  await page.tapSelector('[data-dsh-part="nav"]')
  await sleep(800)
  await page.tapSelector('[aria-label="设置"]')
  await sleep(1600)
  const light = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '浅色')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (light) {
    await page.tap(light.x, light.y)
    await sleep(1500)
  }
  await page.eval(`(() => { const c = document.querySelector('[class*="_close"]'); if (c) c.click() })()`)
  await sleep(2000)

  await page.eval(ARM)
  await sleep(3000)
  const themed = await page.eval(READ)
  console.log(JSON.stringify(themed))
  report.check(themed.pluginWrites === 0,
    `plugin wrote ${themed.pluginWrites} attributes while idle in light mode: ${themed.sample.join(', ')}`)
  report.check(themed.runningAnimations.length === 0, `animations still running: ${themed.runningAnimations.join(', ')}`)

  console.log('--- C. focus then blur leaves no inset engaged ---')
  await page.eval(`(() => { const e = document.querySelector('[data-composer-seat] [contenteditable="true"]'); if (e) e.focus() })()`)
  await sleep(1000)
  await page.eval(`(() => { const e = document.querySelector('[data-composer-seat] [contenteditable="true"]'); if (e) e.blur() })()`)
  await sleep(1000)
  const blurred = await page.eval(`(() => ({
    kb: getComputedStyle(document.documentElement).getPropertyValue('--dshm-kb').trim(),
    attr: document.documentElement.hasAttribute('data-dsh-kb'),
  }))()`)
  console.log('  blurred:', JSON.stringify(blurred))
  report.check(blurred.attr === false, 'the keyboard inset stayed engaged after blur')

  report.finish()
}
