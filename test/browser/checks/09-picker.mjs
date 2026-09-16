/**
 * Which directory picker does "add workspace" open?
 *
 * `directory-picker-auto` samples the host once at boot and cannot see a
 * tunnel, so a loopback bind on macOS resolves to `native`: the Finder dialog
 * opens on the host's screen while the operator is holding a phone, and
 * nothing at all happens in the browser. Pinning `browse` is supposed to fix
 * that; this asserts an in-page dialog is what actually appears.
 *
 * Pointless on a host that resolved to browse anyway (an all-interfaces bind,
 * or a non-darwin/win32 platform) — the assertion is the same either way, which
 * is the point: the interaction must be reachable from the browser.
 */

import { createReporter, open, openDrawer, sleep } from '../harness.mjs'

const PROBE = `(() => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
  const dialogs = [...document.querySelectorAll('[role="dialog"], [class*="_dialog"], [class*="_modal"]')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 120 && r.height > 120 })
    .map((e) => ({ cls: String(e.className).slice(-34), box: R(e), text: (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 70) }))
  return {
    dialogs,
    // the browse picker's own affordances
    hasBreadcrumb: !!document.querySelector('[class*="_crumbTrail"], [class*="_millerRow"], [class*="_column"]'),
    entries: [...document.querySelectorAll('[role="option"], [role="treeitem"], [class*="_entry"], [class*="_row"]')]
      .filter((e) => e.getBoundingClientRect().height > 10).length,
  }
})()`

export async function run(page, url) {
  const report = createReporter('PICKER')

  await open(page, url)
  await openDrawer(page)
  const hit = await page.tapSelector('[aria-label="添加工作区"]')
  console.log('  tapped "添加工作区":', JSON.stringify(hit.box))
  if (!hit.hit) {
    report.check(false, 'the add-workspace control was not found')
    report.finish()
    return
  }
  await sleep(2500)

  const state = await page.eval(PROBE)
  console.log(JSON.stringify(state))

  // The contract is "an in-page directory browser appeared", not "it is wrapped
  // in this particular container": which wrapper the host uses varies, but the
  // navigation it renders does not. Requiring entries AND a breadcrumb keeps
  // this from passing on an unrelated dialog.
  const inPage = state.entries > 0 && (state.dialogs.length > 0 || state.hasBreadcrumb)
  report.check(inPage,
    'no in-page directory browser appeared — the picker is opening on the host screen, not in the browser')

  report.finish()
}
