/**
 * Integrity checks for the hand-written client bundle.
 *
 * A client bundle is served as a classic script and concatenated into a combo
 * batch with every other plugin, so ONE syntax error takes down the whole batch
 * — every plugin in the graph, not just this one. Two failure modes have
 * already bitten during development:
 *
 * 1. A backtick inside the CSS template literal (a Markdown-style code span in
 *    a comment) terminates the string early.
 * 2. Any other syntax error.
 *
 * Exported so the test suite and the CLI share one implementation:
 *
 *   node scripts/check.mjs      # standalone, exits non-zero on failure
 *
 * @module dsh-mobile-ui/scripts/check
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** The interpolations the CSS template is allowed to contain. */
const ALLOWED_INTERPOLATIONS = new Set(['DRAWER_MS']);

/**
 * Collect every integrity problem in the client bundle.
 * @returns a list of human-readable problems; empty means the bundle is sound.
 */
export function checkBundle() {
  const problems = [];
  const clientPath = join(root, 'lib', 'client.js');
  const source = readFileSync(clientPath, 'utf8');

  // 1. Syntax, parsed exactly as the browser will parse it (a classic script).
  try {
    execFileSync(process.execPath, ['--check', clientPath], { stdio: 'pipe' });
  } catch (error) {
    const detail = String(error.stderr ?? error).split('\n').slice(0, 6).join('\n      ');
    problems.push(`syntax: ${detail}`);
  }

  // 2. The bundle must not use ESM syntax at the top level.
  if (/^\s*(import|export)\s/m.test(source)) {
    problems.push('top-level import/export found — the bundle is loaded as a classic script');
  }

  // 3. Backticks inside the CSS template literal, and unexpected `${}`.
  const start = source.indexOf('const CSS = `');
  const end = source.indexOf('\n`;', start);
  if (start === -1 || end === -1) {
    problems.push('could not locate the CSS template literal');
    return problems;
  }
  const css = source.slice(start + 'const CSS = `'.length, end);

  css.split('\n').forEach((line, index) => {
    if (line.includes('`')) {
      problems.push(`backtick inside CSS at CSS line ${index + 1}: ${line.trim().slice(0, 70)}`);
    }
  });

  const interpolations = [...css.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim());
  const unexpected = interpolations.filter((name) => !ALLOWED_INTERPOLATIONS.has(name));
  if (unexpected.length > 0) {
    problems.push(`unexpected CSS interpolation(s): ${unexpected.join(', ')}`);
  }

  return problems;
}

// CLI mode: report and exit.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkBundle();
  if (problems.length === 0) {
    console.log('ok    syntax');
    console.log('ok    no stray backticks in CSS');
    console.log(`ok    CSS interpolations limited to ${[...ALLOWED_INTERPOLATIONS].join(', ')}`);
    console.log('ok    no top-level ESM syntax');
  } else {
    for (const problem of problems) console.error(`FAIL  ${problem}`);
    process.exitCode = 1;
  }
}
