/**
 * The client bundle must stay loadable, and its registration id must match the
 * package name — client-modules uses the package name as the graph entry id,
 * and the runtime refuses a bundle that registers anything else.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBundle } from '../scripts/check.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const client = readFileSync(join(root, 'lib', 'client.js'), 'utf8');
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');

test('the bundle passes its integrity checks', () => {
  assert.deepEqual(checkBundle(), []);
});

test('the three identity declarations agree', () => {
  const registered = /id:\s*'([^']+)'/.exec(client)?.[1];
  const rowName = /name:\s*"([^"]+)"/.exec(patch)?.[1];
  assert.equal(registered, pkg.name, 'client bundle id differs from package.json name');
  assert.equal(rowName, pkg.name, 'cordis row name differs from package.json name');
});

test('the package declares what the harness needs to load it', () => {
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.exports['./client'], './lib/client.js');
  assert.equal(pkg.exports['.'], './lib/index.js');
  assert.ok(pkg.files.includes('assets/'), 'assets/ must ship: the host half reads icons from it');
  assert.equal(pkg.publishConfig.access, 'public');
});

test('the bundle never reaches for a module it cannot have', () => {
  // A client bundle is a classic script: no ESM, and `require` only inside the
  // factory for specifiers the module table actually provides.
  const requires = [...client.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
  const allowed = new Set([
    'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-dockkit',
  ]);
  for (const specifier of requires) {
    assert.ok(allowed.has(specifier), `client bundle requires "${specifier}", which is not in the platform table`);
  }
});

test('the host half declares the service it needs', async () => {
  const host = await import('../lib/index.js');
  assert.deepEqual(host.inject, ['webServer']);
});
