'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isBridgeLink, openableLink, isOwnUrl } = require('../../lib/urls');

test('bridge links: exact YouTube watch/playlist shapes only', () => {
  for (const u of [
    'https://www.youtube.com/watch?v=vid00000001&list=PLbMVogVj5nJSHP0t4uPZBv9I-e7CTgV0t',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/playlist?list=PL2936356E07178528']) {
    assert.ok(isBridgeLink(u), 'should allow ' + u);
  }
  for (const u of [
    'https://evil.com\\@www.youtube.com/watch?v=abc',
    'https://www.youtube.com\\@evil.com/watch?v=abc',
    'https://www.youtube.com@evil.com/watch?v=abc',
    'https://www.youtube.com.evil.com/watch?v=abc',
    'https://evil.com/?https://www.youtube.com/watch?v=abc',
    'https://www.youtube.com/watch?v=abc#@evil.com',
    'https://www.youtube.com/watch?v=abc&redirect=https://evil.com',
    'https://www.youtube.com/watch?v=abc\n',
    'https://www.youtube.com/watch?v=abc%0d%0a',
    'https://www.youtube.com/watch?v=a b',
    'https://www.youtube.com/redirect?q=https://evil.com',
    'http://www.youtube.com/watch?v=abc',
    'HTTPS://www.youtube.com/watch?v=abc',
    'https://m.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe', 'ms-msdt:/id x', 'steam://run/1', '', null, undefined, 42,
    'https://www.youtube.com/watch?v=' + 'a'.repeat(65),
    'https://www.youtube.com/watch?v=abc&list=' + 'a'.repeat(400)]) {
    assert.ok(!isBridgeLink(u), 'should block ' + String(u).replace(/\n/g, '\\n'));
  }
});

test('links clicked inside the player: YouTube hosts only, normalised before opening', () => {
  assert.strictEqual(openableLink('https://www.youtube.com/watch?v=abc123&feature=emb_title'), 'https://www.youtube.com/watch?v=abc123&feature=emb_title');
  assert.strictEqual(openableLink('https://youtu.be/abc123'), 'https://youtu.be/abc123');
  assert.strictEqual(openableLink('https://m.youtube.com/watch?v=abc'), 'https://m.youtube.com/watch?v=abc');
  for (const u of [
    'http://www.youtube.com/watch?v=abc', 'https://evil.com/', 'https://www.youtube.com.evil.com/', 'https://evil.com/www.youtube.com',
    'https://user:pw@www.youtube.com/', 'https://www.youtube.com@evil.com/', 'https://www.youtube.com\\@evil.com/', 'https://www.youtube.com:8443/',
    'https://www.youtube.com/a b', 'https://www.youtube.com/\u0000', 'https://www.youtube.com/\n', 'javascript:alert(1)', 'file:///etc/passwd',
    'https://www.google.com/', 'https://accounts.google.com/', '', null, {}, 'https://www.youtube.com/' + 'a'.repeat(2100)]) {
    assert.strictEqual(openableLink(u), null, 'should refuse ' + String(u).slice(0, 60));
  }
});

test('own origin check', () => {
  assert.ok(isOwnUrl('http://nptel-library.localhost/index.html'));
  assert.ok(isOwnUrl('http://nptel-library.localhost/'));
  assert.ok(!isOwnUrl('https://nptel-library.localhost/'));
  assert.ok(!isOwnUrl('http://nptel-library.localhost:8080/'));
  assert.ok(!isOwnUrl('http://nptel-library.localhost.evil.com/'));
  assert.ok(!isOwnUrl('http://evil.com/#nptel-library.localhost'));
  assert.ok(!isOwnUrl('not a url'));
  assert.ok(!isOwnUrl(undefined));
});
