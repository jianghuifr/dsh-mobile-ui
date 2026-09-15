/**
 * Node half of `@jianghuifr/dsh-mobile-ui`: serves Material Icon Theme icons to the browser.
 *
 * The file explorer's icons live in a **host** process rather than in the client
 * bundle, for one reason: the theme is a large dataset (~1250 SVGs, 1 MB; the
 * resolution tables alone are 398 KB). Shipping that to the browser so it can
 * pick an icon would mean every page load pays for the whole set to draw the
 * handful of icons actually on screen.
 *
 * Instead the browser asks for an icon **by filename** and this half resolves
 * it against the vendored tables, so the client needs no mapping data at all —
 * it just sets a `background-image`. Answers are immutable and cached forever,
 * so a directory listing costs one small request per *distinct* icon, once.
 *
 * Routes (prefix `/material-icons`):
 *   GET /material-icons/<encoded basename>?d=<0|1>&o=<0|1>
 *     d=1  the entry is a directory
 *     o=1  the directory is expanded (picks the open-folder variant)
 *   -> 200 image/svg+xml, or 404 when nothing resolves.
 *
 * The mapping is the same one VS Code applies: exact filename first, then
 * progressively shorter dotted suffixes (`a.spec.ts` -> `spec.ts` -> `ts`),
 * then the theme default. Both tables upstream are keyed by lowercase for the
 * case-insensitive pass, which is what makes `README.md` and `readme.md` agree.
 *
 * @module @jianghuifr/dsh-mobile-ui
 */

import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Route prefix the client builds its icon URLs from. */
export const ICON_ROUTE = '/material-icons';

/** Required service: the web server that answers the icon route. */
export const inject = ['webServer'];

/** Vendored assets sit beside `lib/`, inside the package. */
const ASSETS = join(dirname(dirname(fileURLToPath(import.meta.url))), 'assets');

/** Cap on resolved SVG bytes held in memory; icons are ~1 KB each. */
const CACHE_LIMIT = 512;

/**
 * Load the vendored mapping tables.
 * @returns the parsed index, or undefined when the assets were never vendored.
 */
function loadIndex() {
  const path = join(ASSETS, 'index.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Resolve a file name to an icon file name.
 *
 * Mirrors VS Code's lookup order, because the vendored tables are generated for
 * it: an exact name wins (`tsconfig.json`), then a case-insensitive name
 * (`README.md`), then the extension chain longest-first so a compound suffix
 * such as `spec.ts` beats a bare `ts`, then the theme default.
 *
 * @param index - vendored mapping tables.
 * @param name - entry basename.
 * @returns the icon file name, e.g. `typescript.svg`.
 */
export function resolveFileIcon(index, name) {
  const lower = name.toLowerCase();
  const byName = index.fileNames[name] ?? index.fileNames[lower];
  if (byName !== undefined) return index.definitions[byName] ?? index.defaultFile;

  const parts = lower.split('.');
  // parts[0] is the stem, so start at 1: "a.spec.ts" tries "spec.ts" then "ts".
  for (let i = 1; i < parts.length; i += 1) {
    const extension = parts.slice(i).join('.');
    if (extension === '') continue;
    const byExtension = index.fileExtensions[extension];
    if (byExtension !== undefined) return index.definitions[byExtension] ?? index.defaultFile;
  }
  return index.defaultFile;
}

/**
 * Resolve a folder name to an icon file name.
 * @param index - vendored mapping tables.
 * @param name - folder basename.
 * @param expanded - whether the folder is open in the tree.
 * @returns the icon file name, e.g. `folder-src.svg`.
 */
export function resolveFolderIcon(index, name, expanded) {
  const lower = name.toLowerCase();
  const table = expanded ? index.folderNamesExpanded : index.folderNames;
  const match = table[name] ?? table[lower];
  if (match !== undefined) return index.definitions[match] ?? (expanded ? index.defaultFolderExpanded : index.defaultFolder);
  return expanded ? index.defaultFolderExpanded : index.defaultFolder;
}

/**
 * Plugin body.
 * @param ctx - host Cordis context.
 */
export function apply(ctx) {
  const index = loadIndex();
  if (index === undefined) {
    ctx.logger?.warn(
      `[@jianghuifr/dsh-mobile-ui] ${join(ASSETS, 'index.json')} is missing — file icons are disabled. ` +
        'Run `node scripts/vendor-icons.mjs` to vendor them.',
    );
  }

  /** icon file name -> SVG bytes, for the icons this session actually draws. */
  const cache = new Map();

  /**
   * Read one vendored icon, memoised.
   * @param file - icon file name.
   * @returns the SVG bytes, or undefined when absent.
   */
  async function readIcon(file) {
    const hit = cache.get(file);
    if (hit !== undefined) return hit;
    let body;
    try {
      body = await readFile(join(ASSETS, 'icons', file));
    } catch {
      return undefined;
    }
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(file, body);
    return body;
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ICON_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD' });
            res.end();
            return;
          }
          if (index === undefined) {
            res.writeHead(404);
            res.end();
            return;
          }

          // `/material-icons/<encoded basename>` — the query carries the two
          // flags that can change which icon a name resolves to.
          const url = new URL(req.url ?? '/', 'http://localhost');
          let name = url.pathname.slice(ICON_ROUTE.length);
          if (name.startsWith('/')) name = name.slice(1);
          try {
            name = decodeURIComponent(name);
          } catch {
            res.writeHead(400);
            res.end();
            return;
          }
          if (name === '' || name.includes('/') || name.includes('\0')) {
            res.writeHead(404);
            res.end();
            return;
          }

          const file =
            url.searchParams.get('d') === '1'
              ? resolveFolderIcon(index, name, url.searchParams.get('o') === '1')
              : resolveFileIcon(index, name);

          if (typeof file !== 'string' || file.includes('/') || file.includes('..')) {
            res.writeHead(404);
            res.end();
            return;
          }
          const body = await readIcon(file);
          if (body === undefined) {
            res.writeHead(404);
            res.end();
            return;
          }

          res.writeHead(200, {
            'content-type': 'image/svg+xml; charset=utf-8',
            'content-length': String(body.byteLength),
            // The URL is a pure function of (name, flags, vendored version), so
            // a hit can never go stale without the version changing.
            'cache-control': 'public, max-age=31536000, immutable',
            'x-content-type-options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end(body);
        },
      }),
    'mobile-ui: material icon route',
  );
}
