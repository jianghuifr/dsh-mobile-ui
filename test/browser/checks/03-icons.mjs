/**
 * Material Icon Theme icons in the file explorer.
 *
 * Needs a session (the explorer is reached from the conversation header) and a
 * workspace with entries. The icons come from the host route, so this also
 * proves the host half is serving from `assets/`.
 */

import { createReporter, open, openSession } from '../harness.mjs'

const ROWS = `(() => {
  const out = []
  for (const li of document.querySelectorAll('[data-files-entry]')) {
    const kind = li.getAttribute('data-files-entry')
    if (kind !== 'file' && kind !== 'directory') continue
    const svg = li.querySelector('svg')
    const name = (li.querySelector('[class*="_name"]') || {}).textContent || ''
    const bg = svg ? getComputedStyle(svg).backgroundImage : ''
    const m = /url\\("?([^")]+)"?\\)/.exec(bg)
    out.push({
      kind,
      name: name.trim(),
      expanded: !!li.querySelector('button[aria-expanded="true"]'),
      url: m ? m[1] : null,
      painted: svg ? getComputedStyle(svg).backgroundImage !== 'none' : false,
      glyphHidden: svg && svg.firstElementChild ? getComputedStyle(svg.firstElementChild).display === 'none' : null,
    })
  }
  return out
})()`

export async function run(page, url) {
  const report = createReporter('ICONS')
  const failed = []
  page.on((m) => {
    if (m.method === 'Network.loadingFailed') failed.push(m.params.errorText)
  })
  await page.send('Network.enable')

  await open(page, url)
  if (!(await openSession(page))) {
    report.check(false, 'no session row to open — the explorer cannot be reached')
    report.finish()
    return
  }
  await page.eval(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/打开右侧边栏/.test(x.getAttribute('aria-label')||'')); if(b) b.click() })()`)
  await page.eval('1')
  await new Promise((r) => setTimeout(r, 2000))

  const rows = await page.eval(ROWS)
  console.log(`top level: ${rows.length} rows`)
  for (const row of rows.slice(0, 10)) {
    console.log(`  ${row.kind === 'directory' ? 'dir ' : 'file'} ${row.name.padEnd(20)} painted=${row.painted} glyphHidden=${row.glyphHidden}`)
  }
  report.check(rows.length > 0, 'the explorer rendered no rows')
  for (const row of rows) {
    report.check(row.painted, `${row.name}: no icon painted`)
    report.check(row.glyphHidden === true, `${row.name}: the app's own glyph is not hidden`)
    report.check(Boolean(row.url), `${row.name}: no icon url`)
  }

  const dir = rows.find((row) => row.kind === 'directory')
  if (dir) {
    console.log(`expanding "${dir.name}"`)
    await page.eval(`(() => {
      for (const li of document.querySelectorAll('[data-files-entry="directory"]')) {
        if (((li.querySelector('[class*="_name"]') || {}).textContent || '').trim() === ${JSON.stringify(dir.name)}) {
          const b = li.querySelector('button'); if (b) b.click(); return
        }
      }
    })()`)
    await new Promise((r) => setTimeout(r, 2000))
    const after = await page.eval(ROWS)
    const same = after.find((row) => row.name === dir.name && row.kind === 'directory')
    console.log(`  before: expanded=${dir.expanded} url=${dir.url}`)
    console.log(`  after : expanded=${same?.expanded} url=${same?.url}`)
    report.check(same?.expanded === true, 'the folder did not expand')
    report.check(same?.url !== dir.url, 'the icon did not switch to the open-folder variant')
    for (const row of after) {
      report.check(row.painted, `after expanding, ${row.name}: no icon painted`)
    }
  }

  console.log('network failures:', failed.length ? failed.slice(0, 4) : 'none')
  report.check(failed.length === 0, `${failed.length} failed requests while loading icons`)

  report.finish()
}
