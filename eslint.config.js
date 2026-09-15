import js from '@eslint/js';

/**
 * Node globals the plugin and its tests touch. Listed by hand so that
 * devDependencies stay at two packages.
 */
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Response: 'readonly',
  fetch: 'readonly',
  structuredClone: 'readonly',
};

/**
 * Browser globals the client bundle touches, likewise hand-listed. The bundle
 * runs in a page, so it may use the DOM but not Node built-ins.
 */
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  Image: 'readonly',
  KeyboardEvent: 'readonly',
  MutationObserver: 'readonly',
  requestAnimationFrame: 'readonly',
  getComputedStyle: 'readonly',
  HTMLElement: 'readonly',
  Element: 'readonly',
  history: 'readonly',
  require: 'readonly',
};

export default [
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // The browser half is a client bundle, not an ES module: it registers its
    // factory through the page global and receives externals as `require`.
    files: ['lib/client.js'],
    languageOptions: {
      sourceType: 'script',
      globals: browserGlobals,
    },
  },
  {
    // The vendored icon set is data, not source.
    ignores: ['node_modules/', 'assets/'],
  },
];
