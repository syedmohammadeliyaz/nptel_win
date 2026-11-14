'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'index.html'), 'utf8');

test('the bundled page is complete and self-contained', () => {
  assert.ok(!html.includes('%%'), 'no unreplaced placeholders');
  assert.match(html, /<title>NPTEL Library<\/title>/);
  assert.ok(!/<script[^>]+src=/i.test(html), 'no external <script src> in the page itself (YouTube API is added at run time)');
  assert.ok(!/<link[^>]+href=/i.test(html), 'no external stylesheets or icons');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, 'one inline script');
  assert.doesNotThrow(() => new Function(m[1]), 'script parses');
    const courses = /var COURSES = (\[[\s\S]*?\]);\r?\n/.exec(m[1]);
  assert.ok(courses, 'course list present');
  const list = JSON.parse(courses[1].replace(/<\\\//g, '</'));
  assert.strictEqual(list.length, 529);
  for (const c of list) assert.match(c.p, /^[A-Za-z0-9_-]{10,64}$/, 'playlist id ' + c.p);
});

test('desktop extras are present: wide layout, shortcuts, key handling', () => {
  assert.match(html, /@media \(min-width:820px\)/);
  assert.match(html, /var TOK=\(location\.hash\|\|''\)\.slice\(1\)/);
  assert.match(html, /window\.__back=back/);
  assert.match(html, /function focusSearch/);
  assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
});
