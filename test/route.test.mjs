/**
 * The icon route, exercised through the real registration path.
 *
 * `apply()` is called with a stub context, so this covers what the plugin
 * actually wires up (route kind, path, handler) rather than a reimplementation
 * of it. No server is started: the handler takes plain request/response
 * objects, and the assertions are about the contract a browser depends on —
 * status, content type, cacheability, and the refusal of anything that is not a
 * single bare name.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apply, ICON_ROUTE } from '../lib/index.js';

/** Run `apply` against a stub context and hand back the registered route. */
function registeredRoute() {
  let route;
  const registered = [];
  const ctx = {
    logger: { warn() {} },
    effect: (fn) => {
      const dispose = fn();
      registered.push(dispose);
      return dispose;
    },
    webServer: {
      register: (value) => {
        route = value;
        return () => {};
      },
    },
  };
  apply(ctx);
  assert.ok(route, 'apply() did not register a route');
  return route;
}

/** Invoke the handler with plain objects and capture the response. */
async function call(route, method, url) {
  const chunks = [];
  const state = { status: 0, headers: {} };
  const res = {
    writeHead(status, headers) {
      state.status = status;
      state.headers = headers ?? {};
      return this;
    },
    end(body) {
      if (body !== undefined && body !== null) chunks.push(Buffer.from(body));
      return this;
    },
  };
  await route.handler({ method, url }, res);
  return { ...state, body: Buffer.concat(chunks) };
}

const route = registeredRoute();

test('registers a prefix route under the advertised path', () => {
  assert.equal(route.kind, 'prefix');
  assert.equal(route.path, ICON_ROUTE);
  assert.equal(typeof route.handler, 'function');
});

test('serves an icon with a cacheable content type', async () => {
  const res = await call(route, 'GET', `${ICON_ROUTE}/index.ts`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^image\/svg\+xml/);
  assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(Number(res.headers['content-length']), res.body.byteLength);
  assert.match(res.body.toString('utf8'), /^<svg[\s>]/);
});

test('the filename decides the icon', async () => {
  const ts = await call(route, 'GET', `${ICON_ROUTE}/index.ts`);
  const md = await call(route, 'GET', `${ICON_ROUTE}/README.md`);
  assert.equal(ts.status, 200);
  assert.equal(md.status, 200);
  assert.notEqual(ts.body.toString('utf8'), md.body.toString('utf8'));
});

test('the directory flags decide the folder icon', async () => {
  const closed = await call(route, 'GET', `${ICON_ROUTE}/src?d=1&o=0`);
  const open = await call(route, 'GET', `${ICON_ROUTE}/src?d=1&o=1`);
  assert.equal(closed.status, 200);
  assert.equal(open.status, 200);
  assert.notEqual(closed.body.toString('utf8'), open.body.toString('utf8'));
});

test('HEAD answers the same headers with no body', async () => {
  const get = await call(route, 'GET', `${ICON_ROUTE}/index.ts`);
  const head = await call(route, 'HEAD', `${ICON_ROUTE}/index.ts`);
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], get.headers['content-length']);
  assert.equal(head.body.byteLength, 0);
});

test('other methods are refused', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const res = await call(route, method, `${ICON_ROUTE}/index.ts`);
    assert.equal(res.status, 405, `${method} should be 405`);
    assert.equal(res.headers.allow, 'GET, HEAD');
  }
});

test('a missing or over-long name is refused', async () => {
  for (const url of [`${ICON_ROUTE}`, `${ICON_ROUTE}/`, `${ICON_ROUTE}/a/b`, `${ICON_ROUTE}/%00`]) {
    const res = await call(route, 'GET', url);
    assert.equal(res.status, 404, `${url} should be 404`);
  }
});

test('path traversal cannot escape the icon directory', async () => {
  for (const url of [
    `${ICON_ROUTE}/..%2f..%2fpackage.json`,
    `${ICON_ROUTE}/%2e%2e%2findex.json`,
    `${ICON_ROUTE}/../../package.json`,
  ]) {
    const res = await call(route, 'GET', url);
    assert.ok(res.status === 404 || res.status === 400, `${url} should be refused, got ${res.status}`);
    assert.ok(!res.body.toString('utf8').includes('"name"'), `${url} leaked file contents`);
  }
});

test('an undecodable escape is a bad request', async () => {
  const res = await call(route, 'GET', `${ICON_ROUTE}/%E0%A4%A`);
  assert.equal(res.status, 400);
});

test('an unknown extension still answers with the fallback icon', async () => {
  const res = await call(route, 'GET', `${ICON_ROUTE}/mystery.zzz`);
  assert.equal(res.status, 200);
  assert.match(res.body.toString('utf8'), /^<svg[\s>]/);
});
