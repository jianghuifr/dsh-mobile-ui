/**
 * Resolver contract for the vendored Material Icon Theme tables.
 *
 * The expectations encode upstream behaviour, not intuition: `package.json` is
 * the Node.js logo, `App.tsx` maps to `react_ts`, and `Cargo.toml` genuinely
 * has no entry upstream so it falls through to the `toml` extension. Check a
 * surprise against `assets/index.json` before "fixing" it here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveFileIcon, resolveFolderIcon } from '../lib/index.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const index = JSON.parse(readFileSync(join(root, 'assets', 'index.json'), 'utf8'));

/** Strip the `.svg` so expectations read as icon names. */
const fileIcon = (name) => resolveFileIcon(index, name).replace(/\.svg$/, '');
const folderIcon = (name, expanded) => resolveFolderIcon(index, name, expanded).replace(/\.svg$/, '');

test('exact file names win over extensions', () => {
  assert.equal(fileIcon('package.json'), 'nodejs');
  assert.equal(fileIcon('tsconfig.json'), 'tsconfig');
  assert.equal(fileIcon('Dockerfile'), 'docker');
  assert.equal(fileIcon('go.mod'), 'go-mod');
});

test('file name lookup is case-insensitive', () => {
  assert.equal(fileIcon('README.md'), 'readme');
  assert.equal(fileIcon('readme.md'), 'readme');
  assert.equal(fileIcon('LICENSE'), 'license');
});

test('dotfiles resolve by name', () => {
  assert.equal(fileIcon('.gitignore'), 'git');
});

test('compound extensions beat the bare one', () => {
  assert.equal(fileIcon('a.spec.ts'), 'test-ts');
  assert.equal(fileIcon('index.ts'), 'typescript');
  assert.equal(fileIcon('App.tsx'), 'react_ts');
});

test('plain extensions resolve', () => {
  assert.equal(fileIcon('main.js'), 'javascript');
  assert.equal(fileIcon('styles.css'), 'css');
  assert.equal(fileIcon('config.yaml'), 'yaml');
  assert.equal(fileIcon('logo.svg'), 'svg');
  assert.equal(fileIcon('avatar.png'), 'image');
  assert.equal(fileIcon('setup.py'), 'python');
  assert.equal(fileIcon('run.sh'), 'console');
  assert.equal(fileIcon('Cargo.toml'), 'toml');
});

test('unknown names fall back to the theme default', () => {
  assert.equal(fileIcon('unknown.zzz'), 'file');
  assert.equal(fileIcon('no-extension'), 'file');
  assert.equal(fileIcon(''), 'file');
});

test('folder names resolve, including the expanded variant', () => {
  assert.equal(folderIcon('src', false), 'folder-src');
  assert.equal(folderIcon('src', true), 'folder-src-open');
  assert.equal(folderIcon('node_modules', false), 'folder-node');
  assert.equal(folderIcon('.git', false), 'folder-git');
  assert.equal(folderIcon('components', false), 'folder-components');
  assert.equal(folderIcon('test', false), 'folder-test');
});

test('unknown folders fall back to the theme default', () => {
  assert.equal(folderIcon('whatever', false), 'folder');
  assert.equal(folderIcon('whatever', true), 'folder-open');
});

test('every resolved icon exists in the vendored set', () => {
  const names = ['index.ts', 'README.md', 'package.json', 'Dockerfile', 'a.spec.ts', 'logo.svg', 'nope.zzz'];
  for (const name of names) {
    const file = resolveFileIcon(index, name);
    assert.doesNotThrow(() => readFileSync(join(root, 'assets', 'icons', file)), `${name} -> ${file}`);
  }
  for (const [name, expanded] of [['src', false], ['src', true], ['whatever', false], ['whatever', true]]) {
    const file = resolveFolderIcon(index, name, expanded);
    assert.doesNotThrow(() => readFileSync(join(root, 'assets', 'icons', file)), `${name} -> ${file}`);
  }
});

test('the vendored tables are non-trivial', () => {
  assert.ok(Object.keys(index.fileNames).length > 1000, 'file name table looks truncated');
  assert.ok(Object.keys(index.fileExtensions).length > 1000, 'extension table looks truncated');
  assert.ok(Object.keys(index.folderNames).length > 1000, 'folder name table looks truncated');
  assert.equal(index.defaultFile.endsWith('.svg'), true);
  assert.equal(index.defaultFolder.endsWith('.svg'), true);
  assert.equal(index.defaultFolderExpanded.endsWith('.svg'), true);
});
