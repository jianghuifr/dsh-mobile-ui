#!/usr/bin/env node
/**
 * Vendor the Material Icon Theme icon set into `assets/`.
 *
 * Upstream ships the theme as a VS Code extension: ~1250 standalone SVGs plus
 * one 450 KB `material-icons.json` describing every filename, extension and
 * folder-name mapping. The file explorer's icons live in the *host* process
 * (see `lib/index.js`), so this script is what turns an installed copy of the
 * extension into the two things the plugin needs:
 *
 *   assets/icons/<name>.svg   the referenced icons, copied verbatim
 *   assets/index.json         the mapping tables, minified
 *   assets/source.json        which install this came from, for reproducibility
 *
 * Re-run it to move to a newer upstream release. Nothing at runtime reads the
 * VS Code extension directory, so upgrading VS Code cannot break the plugin.
 *
 *   node scripts/vendor-icons.mjs [--from <extension-dir>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const assets = join(root, 'assets')
const iconsOut = join(assets, 'icons')

/** Where an installed material-icon-theme may live, newest version first. */
function candidateDirs() {
  const fromArg = process.argv.indexOf('--from')
  if (fromArg !== -1 && process.argv[fromArg + 1]) return [process.argv[fromArg + 1]]
  if (process.env.MATERIAL_ICON_THEME_DIR) return [process.env.MATERIAL_ICON_THEME_DIR]
  const roots = [
    join(homedir(), '.vscode', 'extensions'),
    join(homedir(), '.cursor', 'extensions'),
    join(homedir(), '.vscode-insiders', 'extensions'),
    join(homedir(), '.windsurf', 'extensions'),
  ]
  const found = []
  for (const base of roots) {
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base)) {
      if (!entry.startsWith('pkief.material-icon-theme-')) continue
      const dir = join(base, entry)
      if (existsSync(join(dir, 'dist', 'material-icons.json'))) found.push(dir)
    }
  }
  // Newest version string last, so reverse for newest-first.
  return found.sort().reverse()
}

const source = candidateDirs().find((dir) => existsSync(join(dir, 'dist', 'material-icons.json')))
if (!source) {
  console.error('vendor-icons: no material-icon-theme install found.')
  console.error('  Install it (VS Code: "Material Icon Theme") or pass --from <extension-dir>.')
  process.exit(1)
}

const theme = JSON.parse(readFileSync(join(source, 'dist', 'material-icons.json'), 'utf8'))
const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version
console.log(`source : ${source}`)
console.log(`version: ${version}`)

// Every icon the mapping can reach, so nothing resolves to a missing file.
const referenced = new Set()
for (const definition of Object.values(theme.iconDefinitions)) {
  const path = definition.iconPath
  if (typeof path !== 'string') continue
  referenced.add(path.slice(path.lastIndexOf('/') + 1))
}
const missing = [...referenced].filter((file) => !existsSync(join(source, 'icons', file)))
if (missing.length > 0) {
  console.error(`vendor-icons: ${missing.length} referenced icon(s) are absent upstream, e.g. ${missing.slice(0, 3).join(', ')}`)
  process.exit(1)
}

rmSync(iconsOut, { recursive: true, force: true })
mkdirSync(iconsOut, { recursive: true })
let bytes = 0
for (const file of referenced) {
  copyFileSync(join(source, 'icons', file), join(iconsOut, file))
  bytes += statSync(join(iconsOut, file)).size
}

/** name -> icon file, with the `./../icons/` prefix stripped. */
const definitions = {}
for (const [name, definition] of Object.entries(theme.iconDefinitions)) {
  if (typeof definition.iconPath !== 'string') continue
  definitions[name] = definition.iconPath.slice(definition.iconPath.lastIndexOf('/') + 1)
}

const index = {
  version,
  defaultFile: definitions[theme.file],
  defaultFolder: definitions[theme.folder],
  defaultFolderExpanded: definitions[theme.folderExpanded],
  definitions,
  fileNames: theme.fileNames,
  fileExtensions: theme.fileExtensions,
  folderNames: theme.folderNames,
  folderNamesExpanded: theme.folderNamesExpanded,
}
mkdirSync(assets, { recursive: true })
const indexJson = JSON.stringify(index)
writeFileSync(join(assets, 'index.json'), indexJson)
writeFileSync(join(assets, 'source.json'), `${JSON.stringify({
  package: 'pkief.material-icon-theme',
  version,
  homepage: 'https://github.com/material-extensions/vscode-material-icon-theme',
  vendoredFrom: source,
  license: 'MIT',
}, null, 2)}\n`)

console.log(`icons  : ${referenced.size} files, ${(bytes / 1048576).toFixed(2)} MB`)
console.log(`index  : ${(indexJson.length / 1024).toFixed(0)} KB`)
console.log(`tables : ${Object.keys(index.fileNames).length} file names, ` +
  `${Object.keys(index.fileExtensions).length} extensions, ` +
  `${Object.keys(index.folderNames).length} folder names, ` +
  `${Object.keys(index.definitions).length} definitions`)
