#!/usr/bin/env node
/**
 * Run the browser checks against a live dsh instance.
 *
 *   # against an instance you already have
 *   DSH_BROWSER_URL='http://127.0.0.1:3099/?token=…' npm run test:browser
 *
 *   # or let this boot a throwaway host (needs `dsh` on PATH; the profile has
 *   # no runtime dependencies, so pnpm only has to link this package)
 *   node test/browser/run.mjs --boot
 *
 *   node test/browser/run.mjs --url <url> --filter enter --headful
 *
 * These need a real browser and a running host, so they are deliberately NOT
 * part of `npm test` or CI. What they cover is what a unit test cannot: an
 * overlay that paints but answers no taps, a composer that drifts under the
 * keyboard, a hidden rail that swallows every tap on the page.
 *
 * @module dsh-mobile-ui/test/browser/run
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, mkdirSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { readdir } from 'node:fs/promises'

import { launch, newPage } from './cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = dirname(dirname(here))

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

/** Every check module, in the order they run. */
async function loadChecks(filter) {
  const dir = join(here, 'checks')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.mjs')).sort()
  return files
    .filter((f) => filter === undefined || f.includes(filter))
    .map((f) => ({ name: f.replace(/\.mjs$/, ''), path: join(dir, f) }))
}

/**
 * Boot a throwaway host with this package installed.
 *
 * A scratch DSH_HOME keeps the developer's own profiles out of it, and the
 * credentials are symlinked rather than copied so nothing secret is duplicated.
 *
 * @returns the tokenized URL, plus a teardown.
 */
async function bootHost({ port = 3099 } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-browser-home-'))
  mkdirSync(join(home, 'profiles'), { recursive: true })
  for (const name of ['.credentials.yaml', '.env', 'settings.yaml']) {
    const from = join(homedir(), '.dsh', name)
    if (existsSync(from)) symlinkSync(from, join(home, name))
  }

  // Seed a workspace, with files varied enough to give the icon check real
  // extensions to resolve.
  const workspaceDir = join(home, 'workspace')
  mkdirSync(workspaceDir, { recursive: true })
  for (const [name, body] of [
    ['README.md', '# scratch workspace\n'],
    ['package.json', '{ "name": "scratch", "private": true }\n'],
    ['index.ts', 'export const answer = 42;\n'],
    ['app.tsx', 'export const App = () => null;\n'],
    ['styles.css', 'body { margin: 0; }\n'],
    ['data.json', '{}\n'],
    ['Dockerfile', 'FROM scratch\n'],
  ]) {
    writeFileSync(join(workspaceDir, name), body)
  }
  for (const dir of ['src', 'node_modules', '.git']) mkdirSync(join(workspaceDir, dir), { recursive: true })

  // Register that directory as a workspace. Without one the composer is
  // replaced by a "choose a workspace" prompt, so the send button is inert and
  // every check that touches the composer measures nothing.
  //
  // The path must be the REALPATH. On macOS both /tmp and /var are symlinks, so
  // `mkdtempSync` hands back /var/folders/... whose realpath is
  // /private/var/folders/... — and a workspace stored under the symlinked form
  // never becomes usable, silently, with no error anywhere. Resolving it is the
  // difference between a working host and one that looks like it has no
  // workspace at all.
  const now = new Date().toISOString()
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['browser-check-workspace'], archivedSessionIds: [] },
    tables: {
      workspaces: {
        'browser-check-workspace': {
          path: realpathSync(workspaceDir),
          title: 'scratch',
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  }, null, 2))

  const run = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn('dsh', args, { env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { out += d })
      child.on('error', reject)
      child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(out))))
    })

  await run(['plugin', '--profile', 'web', 'add', `link:${repo}`])

  // Pin the browser directory picker, the way anyone reaching this host from a
  // phone has to: `directory-picker-auto` samples the host once at boot, and a
  // loopback bind on macOS resolves to the native backend — so "new workspace"
  // opens a Finder window on the host while the operator holds a phone. Without
  // this the picker check is asserting against a host that is configured wrong
  // on purpose.
  writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), [
    '# Written by test/browser/run.mjs so a throwaway host matches the setup the',
    '# README recommends for reaching dsh from a phone.',
    '- id: directory-picker',
    '  disabled: true',
    '- insert:',
    '    - id: directory-picker-browse',
    `      name: '@deepseek-ai/dsh-host-directory-picker-browse'`,
    '    - id: directory-picker-browse-surface',
    `      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'`,
    '',
  ].join('\n'))

  const child = spawn('dsh', ['--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: tmpdir(),
  })
  const url = await new Promise((resolve, reject) => {
    let buffered = ''
    const timer = setTimeout(() => reject(new Error('host never printed a URL:\n' + buffered)), 60_000)
    const scan = (chunk) => {
      buffered += chunk
      const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/.exec(buffered)
      if (match) {
        clearTimeout(timer)
        resolve(match[0])
      }
    }
    child.stdout.on('data', scan)
    child.stderr.on('data', scan)
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`host exited ${code}:\n${buffered}`)) })
  })

  return {
    url,
    teardown: () => {
      child.kill('SIGKILL')
      rmSync(home, { recursive: true, force: true })
    },
  }
}

// An empty env var is "unset", not a URL: `DSH_BROWSER_URL= --boot` should boot.
const url = value('url') ?? (process.env.DSH_BROWSER_URL || undefined)
const filter = value('filter')
const headful = flag('headful')

if (url === undefined && !flag('boot')) {
  console.error(`
No host to test against.

  DSH_BROWSER_URL='http://127.0.0.1:3099/?token=…' npm run test:browser
  node test/browser/run.mjs --boot        # or let it boot a throwaway one
`)
  process.exit(2)
}

const checks = await loadChecks(filter)
if (checks.length === 0) {
  console.error(`no checks matched --filter ${filter}`)
  process.exit(2)
}

let host
let target = url
if (target === undefined) {
  console.log('booting a throwaway host…')
  host = await bootHost({ port: Number(value('port') ?? 3099) })
  target = host.url
  console.log('host:', target.replace(/token=\S+/, 'token=…'))
}

const browser = await launch({ port: Number(value('cdp-port') ?? 9420), headless: !headful })
const page = await newPage(browser.port)
await page.enable()

const results = []
try {
  for (const check of checks) {
    console.log(`\n${'='.repeat(72)}\n${check.name}\n${'='.repeat(72)}`)
    const before = process.exitCode
    process.exitCode = 0
    try {
      const module = await import(check.path)
      await module.run(page, target)
    } catch (error) {
      console.error(`  threw: ${error.message}`)
      process.exitCode = 1
    }
    results.push({ name: check.name, ok: process.exitCode === 0 })
    process.exitCode = before
  }
} finally {
  try { page.close() } catch { /* already gone */ }
  try { browser.proc.kill('SIGKILL') } catch { /* already gone */ }
  host?.teardown()
}

console.log(`\n${'='.repeat(72)}\nsummary\n${'='.repeat(72)}`)
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
if (failed > 0) process.exitCode = 1
