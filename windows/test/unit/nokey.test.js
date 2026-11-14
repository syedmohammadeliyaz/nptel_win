'use strict';
/* No API key or other credential may be stored in the app. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('../../lib/config');

test('the YouTube request URL carries no key', function () {
  const u = new URL(cfg.YT_BROWSE_URL);
  assert.strictEqual(u.origin + u.pathname, 'https://www.youtube.com/youtubei/v1/browse');
  assert.deepStrictEqual(Array.from(u.searchParams.keys()), ['prettyPrint']);
});

test('no Google API key anywhere in the shipped files', function () {
  const root = path.join(__dirname, '..', '..');
  const files = ['main.js', 'preload.js', 'src/index.html', 'package.json']
    .concat(fs.readdirSync(path.join(root, 'lib')).map(function (f) { return 'lib/' + f; }));
  for (const f of files) {
    assert.ok(!/AIza[0-9A-Za-z_-]{30,}/.test(fs.readFileSync(path.join(root, f), 'utf8')), f);
  }
});
