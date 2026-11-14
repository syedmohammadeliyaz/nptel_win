'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createBridge } = require('../../lib/ipc');

function setup() {
  const calls = { browse: [], open: [] };
  const mainFrame = { url: 'http://nptel-library.localhost/index.html' };
  const bridge = createBridge({
    token: 'KEY123',
    browse: async (b) => { calls.browse.push(b); return '{"ok":1}'; },
    openLink: (u) => calls.open.push(u)
  });
  const ev = (frame) => ({ sender: { mainFrame }, senderFrame: frame === undefined ? mainFrame : frame });
  return { calls, bridge, ev, mainFrame };
}
const err = async (p) => JSON.parse(await p).__error;

test('browse: needs our page, the top frame, the right key and a sane request id', async () => {
  const { calls, bridge, ev } = setup();
  assert.strictEqual(await bridge.onBrowse(ev(), 'KEY123', 'r1xabc', '{}'), '{"ok":1}');
  assert.strictEqual(calls.browse.length, 1);
  assert.strictEqual(await err(bridge.onBrowse(ev(), 'WRONG', 'r1xabc', '{}')), 'Request refused');
  assert.strictEqual(await err(bridge.onBrowse(ev(), undefined, 'r1xabc', '{}')), 'Request refused');
  assert.strictEqual(await err(bridge.onBrowse(ev(), 'KEY123', 'a"b', '{}')), 'Request refused');
  assert.strictEqual(await err(bridge.onBrowse(ev(), 'KEY123', 'x;alert(1)', '{}')), 'Request refused');
  assert.strictEqual(await err(bridge.onBrowse(ev(), 'KEY123', 'a'.repeat(65), '{}')), 'Request refused');
  assert.strictEqual(await err(bridge.onBrowse(ev(), 'KEY123', null, '{}')), 'Request refused');
  assert.strictEqual(await err(bridge.onBrowse(ev(), ['KEY123'], 'r1xabc', '{}')), 'Request refused');
  assert.strictEqual(calls.browse.length, 1);
});

test('browse: a sub-frame (YouTube player) or a foreign page can never use the bridge', async () => {
  const { calls, bridge, ev } = setup();
  const sub = { url: 'https://www.youtube.com/embed/abc' };
  assert.strictEqual(await err(bridge.onBrowse(ev(sub), 'KEY123', 'r1xabc', '{}')), 'Request refused');
  const ourUrlInASubframe = { url: 'http://nptel-library.localhost/index.html' };   // same URL but not the top frame
  assert.strictEqual(await err(bridge.onBrowse(ev(ourUrlInASubframe), 'KEY123', 'r1xabc', '{}')), 'Request refused');
  assert.strictEqual(await err(bridge.onBrowse(ev(null), 'KEY123', 'r1xabc', '{}')), 'Request refused');
  assert.strictEqual(await err(bridge.onBrowse({}, 'KEY123', 'r1xabc', '{}')), 'Request refused');
  assert.strictEqual(await err(bridge.onBrowse(undefined, 'KEY123', 'r1xabc', '{}')), 'Request refused');
  const evil = { url: 'https://evil.com/' };
  assert.strictEqual(await err(bridge.onBrowse({ sender: { mainFrame: evil }, senderFrame: evil }, 'KEY123', 'r1xabc', '{}')), 'Request refused');
  assert.strictEqual(calls.browse.length, 0);
});

test('openExternal: same rules, plus the exact-link allowlist', () => {
  const { calls, bridge, ev } = setup();
  const good = 'https://www.youtube.com/watch?v=vid00000001&list=PLbMVogVj5nJSHP0t4uPZBv9I-e7CTgV0t';
  assert.strictEqual(bridge.onOpenExternal(ev(), 'KEY123', good), true);
  assert.deepStrictEqual(calls.open, [good]);
  assert.strictEqual(bridge.onOpenExternal(ev(), 'WRONG', good), false);
  assert.strictEqual(bridge.onOpenExternal(ev({ url: 'https://www.youtube.com/embed/x' }), 'KEY123', good), false);
  assert.strictEqual(bridge.onOpenExternal(ev(), 'KEY123', 'https://evil.com/'), false);
  assert.strictEqual(bridge.onOpenExternal(ev(), 'KEY123', 'https://www.youtube.com/watch?v=abc&redirect=https://evil.com'), false);
  assert.strictEqual(bridge.onOpenExternal(ev(), 'KEY123', null), false);
  assert.strictEqual(calls.open.length, 1);
});
