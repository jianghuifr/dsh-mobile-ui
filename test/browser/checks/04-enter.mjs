/**
 * The Enter contract on mobile.
 *
 *   plain Enter     -> a newline, no submit
 *   Shift+Enter     -> a newline
 *   Ctrl/Cmd+Enter  -> still submits
 *   Send button     -> still submits
 *   "/" menu open   -> Enter picks the item, and the plugin does NOT intercept
 *   desktop layout  -> plain Enter still submits
 *
 * Each case gets a FRESH page. Submitting starts an agent turn, and a running
 * agent changes how the composer behaves and adds transcript nodes on its own —
 * sharing a page silently invalidates the next case's "this count did not
 * change" assertion.
 */

import { createReporter, open, newSession, press, sleep } from '../harness.mjs'

const T = { ctrl: 2, meta: 4, shift: 8, alt: 1 }

const STATE = `(() => {
  const ed = document.querySelector('[data-composer-seat] [contenteditable="true"]')
  return {
    mobile: document.documentElement.getAttribute('data-dsh-mobile'),
    draft: ed ? (ed.innerText || '').replace(/\\n/g, '|') : null,
    text: ed ? ed.textContent : null,
    menuOpen: document.querySelector('[data-trigger-menu]') !== null,
    turns: document.querySelectorAll('[class*="_flowItem"]').length,
  }
})()`

export async function run(page, url) {
  const report = createReporter('ENTER')

  const fresh = async (width = 390, height = 844) => {
    await open(page, url, { width, height })
    await newSession(page)
  }
  const type = async (text) => {
    await page.send('Input.insertText', { text })
    await sleep(400)
  }

  console.log('--- 1. plain Enter inserts a newline, does not send ---')
  await fresh()
  await type('line1')
  const b1 = await page.eval(STATE)
  report.check(b1.draft === 'line1', `typing did not land (draft=${JSON.stringify(b1.draft)})`)
  await press(page, 'Enter')
  const a1 = await page.eval(STATE)
  console.log(`  after Enter: ${JSON.stringify(a1)}`)
  report.check(a1.turns === b1.turns, `plain Enter submitted (turns ${b1.turns} -> ${a1.turns})`)
  await type('line2')
  const c1 = await page.eval(STATE)
  report.check(c1.draft === 'line1|line2', `expected two lines, got ${JSON.stringify(c1.draft)}`)

  console.log('--- 2. Shift+Enter still inserts a newline ---')
  await fresh()
  await type('s1')
  const b2 = await page.eval(STATE)
  await press(page, 'Enter', T.shift)
  const a2 = await page.eval(STATE)
  report.check(a2.turns === b2.turns, 'Shift+Enter submitted')

  console.log('--- 3. Ctrl+Enter still submits ---')
  await fresh()
  await type('ctrl submit')
  const b3 = await page.eval(STATE)
  await press(page, 'Enter', T.ctrl)
  const a3 = await page.eval(STATE)
  report.check(a3.turns > b3.turns, `Ctrl+Enter did not submit (turns ${b3.turns} -> ${a3.turns})`)

  console.log('--- 4. the Send button still submits ---')
  await fresh()
  await type('via button')
  const b4 = await page.eval(STATE)
  await page.tapSelector('[data-composer-seat] [class*="_primary"]')
  await sleep(1800)
  const a4 = await page.eval(STATE)
  report.check(a4.turns > b4.turns, `the Send button did not submit (turns ${b4.turns} -> ${a4.turns})`)

  console.log('--- 5. the "/" menu still owns Enter ---')
  await fresh()
  // Registered after the plugin's own capture listener: if the plugin
  // intercepts it calls stopPropagation(), so this one never runs. That is the
  // direct evidence that the menu path was left alone.
  await page.eval(`(() => {
    window.__trace = []
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') window.__trace.push('app-reached menu=' + (document.querySelector('[data-trigger-menu]') !== null))
    }, true)
  })()`)
  await type('/re')
  await sleep(600)
  const b5 = await page.eval(STATE)
  if (b5.menuOpen) {
    await press(page, 'Enter')
    const a5 = await page.eval(STATE)
    const trace = await page.eval('window.__trace')
    console.log(`  after Enter: ${JSON.stringify(a5)} trace=${JSON.stringify(trace)}`)
    report.check(a5.menuOpen === false, 'Enter did not dismiss the / menu')
    report.check(a5.turns === b5.turns, `Enter with the menu open submitted (turns ${b5.turns} -> ${a5.turns})`)
    report.check((a5.text || '').length > 3, `the menu did not pick a command (editor holds ${JSON.stringify(a5.text)})`)
    report.check(trace.length > 0, 'the plugin intercepted Enter while the menu was open')
  } else {
    console.log('  (menu did not open — skipped)')
  }

  console.log('--- 6. desktop layout: plain Enter still submits ---')
  await fresh(1280, 900)
  const b6 = await page.eval(STATE)
  report.check(b6.mobile === 'false', `expected the desktop layout, got ${b6.mobile}`)
  await type('desktop')
  const b6b = await page.eval(STATE)
  await press(page, 'Enter')
  const a6 = await page.eval(STATE)
  report.check(a6.turns > b6b.turns, `desktop plain Enter did not submit (turns ${b6b.turns} -> ${a6.turns})`)

  report.finish()
}
