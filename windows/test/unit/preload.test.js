'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

// Load preload.js against a fake 'electron' so we can drive the bridge it would expose to the page.
function loadPreload(invoke) {
  const exposed = {}, executed = [];
  const fake = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
    ipcRenderer: { invoke },
    webFrame: { executeJavaScript: (code) => { executed.push(code); return Promise.resolve(); } }
  };
  const orig = Module._load;
  Module._load = function (request, ...rest) { return request === 'electron' ? fake : orig.call(this, request, ...rest); };
  const file = path.join(__dirname, '..', '..', 'preload.js');
  delete require.cache[require.resolve(file)];
  try { require(file); } finally { Module._load = orig; }
  return { api: exposed.Native, executed, exposed };
}
const tick = () => new Promise((r) => setImmediate(r));

test('exposes exactly Native.{browse,take,openExternal}', () => {
  const { api, exposed } = loadPreload(async () => '');
  assert.deepStrictEqual(Object.keys(exposed), ['Native']);
  assert.deepStrictEqual(Object.keys(api).sort(), ['browse', 'openExternal', 'take']);
});

test('browse -> main -> result is announced to the page by id, and taken exactly once', async () => {
  const sent = [];
  const { api, executed } = loadPreload(async (ch, ...args) => { sent.push([ch, ...args]); return '{"hello":1}'; });
  api.browse('KEY', 'r1xabc', '{"browseId":"VLx"}');
  await tick(); await tick();
  assert.deepStrictEqual(sent, [['nptel:browse', 'KEY', 'r1xabc', '{"browseId":"VLx"}']]);
  assert.deepStrictEqual(executed, ['window.__nativeDone&&window.__nativeDone("r1xabc")']);
  assert.strictEqual(api.take('KEY', 'r1xabc'), '{"hello":1}');
  assert.strictEqual(api.take('KEY', 'r1xabc'), '');          // drained
  assert.strictEqual(api.take('KEY', 'unknown'), '');
  assert.strictEqual(api.take('KEY', null), '');
});

test('ids that could break out of the injected string never leave the preload', async () => {
  const sent = [];
  const { api, executed } = loadPreload(async (...a) => { sent.push(a); return '{}'; });
  for (const id of ['a"b', 'x;alert(1)', '"); evil(); ("', '', 'a'.repeat(65), null, undefined, 5, {}, ['r1']]) api.browse('KEY', id, '{}');
  await tick(); await tick();
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(executed.length, 0);
});

test('arguments are coerced to strings; failures become {"__error"} and still notify the page', async () => {
  const sent = [];
  const { api, executed } = loadPreload(async (ch, ...a) => { sent.push(a); throw new Error('ipc down'); });
  api.browse({ evil: 1 }, 'r2xabc', { a: 1 });
  await tick(); await tick();
  assert.deepStrictEqual(sent[0], ['[object Object]', 'r2xabc', '[object Object]']);
  assert.deepStrictEqual(JSON.parse(api.take('KEY', 'r2xabc')), { __error: 'Internal error' });
  assert.strictEqual(executed.length, 1);

  const bad = loadPreload(async () => ({ not: 'a string' }));
  bad.api.browse('KEY', 'r3xabc', '{}');
  await tick(); await tick();
  assert.deepStrictEqual(JSON.parse(bad.api.take('KEY', 'r3xabc')), { __error: 'Unexpected reply' });
});

test('uncollected results are capped', async () => {
  const { api } = loadPreload(async () => '{}');
  for (let i = 0; i < 40; i++) api.browse('KEY', 'id' + i, '{}');
  await tick(); await tick();
  let kept = 0; for (let i = 0; i < 40; i++) if (api.take('KEY', 'id' + i) !== '') kept++;
  assert.strictEqual(kept, 16);
});

test('openExternal forwards to main with string arguments only', async () => {
  const sent = [];
  const { api } = loadPreload(async (ch, ...a) => { sent.push([ch, ...a]); return true; });
  api.openExternal('KEY', 'https://www.youtube.com/watch?v=abc');
  api.openExternal(undefined, { toString() { return 'x'; } });
  await tick();
  assert.deepStrictEqual(sent, [['nptel:openExternal', 'KEY', 'https://www.youtube.com/watch?v=abc'], ['nptel:openExternal', 'undefined', 'x']]);
});
