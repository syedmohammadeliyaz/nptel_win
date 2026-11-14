'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pageResponse, createGuards } = require('../../lib/guards');

const HTML = Buffer.from('<!doctype html>x');

test('pageResponse serves only our page, over GET, from our host', () => {
  const ok = pageResponse({ url: 'http://nptel-library.localhost/index.html', method: 'GET' }, HTML);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body, HTML);
  assert.match(ok.headers['Content-Type'], /^text\/html/);
  assert.match(ok.headers['Content-Security-Policy'], /object-src 'none'/);
  assert.match(ok.headers['Content-Security-Policy'], /frame-src https:\/\/youtube\.com https:\/\/\*\.youtube\.com https:\/\/\*\.youtube-nocookie\.com/);
  assert.strictEqual(ok.headers['X-Content-Type-Options'], 'nosniff');
  assert.strictEqual(pageResponse({ url: 'http://nptel-library.localhost/', method: 'GET' }, HTML).status, 200);
  assert.strictEqual(pageResponse({ url: 'http://nptel-library.localhost/index.html?r=3', method: 'GET' }, HTML).status, 200);
  assert.strictEqual(pageResponse({ url: 'http://nptel-library.localhost/favicon.ico', method: 'GET' }, HTML).status, 404);
  assert.strictEqual(pageResponse({ url: 'http://nptel-library.localhost/../../etc/passwd', method: 'GET' }, HTML).status, 404);
  assert.strictEqual(pageResponse({ url: 'http://nptel-library.localhost/index.html', method: 'POST' }, HTML).status, 405);
  for (const u of ['http://example.com/', 'http://127.0.0.1/', 'http://nptel-library.localhost.evil.com/', 'http://nptel-library.localhost:8080/', 'http://user@nptel-library.localhost/', 'http://localhost/index.html']) {
    assert.strictEqual(pageResponse({ url: u, method: 'GET' }, HTML).status, 403, u);
  }
  assert.strictEqual(pageResponse({ url: 'not a url', method: 'GET' }, HTML).status, 400);
});

function fakeShell() { const opened = []; return { opened, openExternal: async (u) => { opened.push(u); } }; }

test('window.open: never a new window; YouTube links go to the browser', () => {
  const shell = fakeShell(); const g = createGuards({ shell });
  assert.deepStrictEqual(g.windowOpen({ url: 'https://www.youtube.com/watch?v=abc' }), { action: 'deny' });
  assert.deepStrictEqual(g.windowOpen({ url: 'https://evil.com/' }), { action: 'deny' });
  assert.deepStrictEqual(g.windowOpen({ url: 'javascript:alert(1)' }), { action: 'deny' });
  assert.deepStrictEqual(g.windowOpen(undefined), { action: 'deny' });
  assert.deepStrictEqual(shell.opened, ['https://www.youtube.com/watch?v=abc']);
});

test('navigation away from our page is cancelled', () => {
  const shell = fakeShell(); const g = createGuards({ shell });
  const ev = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
  let e = ev(); g.willNavigate(e, 'http://nptel-library.localhost/index.html#x'); assert.ok(!e.prevented);
  e = ev(); g.willNavigate(e, 'https://example.com/'); assert.ok(e.prevented);
  e = ev(); g.willNavigate(e, 'file:///C:/Users/x/secret.html'); assert.ok(e.prevented);
  e = ev(); g.willNavigate(e, 'https://www.youtube.com/watch?v=zzz'); assert.ok(e.prevented);
  assert.deepStrictEqual(shell.opened, ['https://www.youtube.com/watch?v=zzz']);
});

test('shell failures never throw out of the guards', () => {
  const g = createGuards({ shell: { openExternal() { throw new Error('no browser'); } } });
  assert.doesNotThrow(() => g.windowOpen({ url: 'https://www.youtube.com/watch?v=abc' }));
  const g2 = createGuards({ shell: { openExternal() { return Promise.reject(new Error('no browser')); } } });
  assert.doesNotThrow(() => g2.windowOpen({ url: 'https://www.youtube.com/watch?v=abc' }));
});

test('permissions: only full-screen, only for our page and YouTube', () => {
  const g = createGuards({ shell: fakeShell() });
  assert.ok(g.permissionAllowed('fullscreen', 'https://www.youtube.com/embed/abc'));
  assert.ok(g.permissionAllowed('fullscreen', 'http://nptel-library.localhost/index.html'));
  assert.ok(!g.permissionAllowed('fullscreen', 'https://evil.com/'));
  for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal', 'mediaKeySystem', 'display-capture']) {
    assert.ok(!g.permissionAllowed(p, 'https://www.youtube.com/embed/abc'), p);
    assert.ok(!g.permissionCheck(p, 'https://www.youtube.com'), p);
  }
  assert.ok(!g.permissionAllowed('fullscreen', ''));
  assert.ok(g.permissionCheck('fullscreen', 'https://www.youtube.com'));
  assert.ok(!g.permissionCheck('fullscreen', 'https://evil.com'));
});

test('embed requests always carry a Referer', () => {
  const g = createGuards({ shell: fakeShell() });
  assert.strictEqual(g.embedHeaders({ Accept: '*/*' }).Referer, 'http://nptel-library.localhost/');
  assert.strictEqual(g.embedHeaders({ Referer: 'http://nptel-library.localhost/' }).Referer, 'http://nptel-library.localhost/');
  assert.strictEqual(g.embedHeaders({ referer: 'http://x/' }).referer, 'http://x/');
  assert.strictEqual(g.embedHeaders({ Referer: '' }).Referer, 'http://nptel-library.localhost/');
  const input = { A: '1' }; g.embedHeaders(input); assert.deepStrictEqual(input, { A: '1' });
});
