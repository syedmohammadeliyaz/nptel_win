'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ws = require('../../lib/windowState');

const AREAS = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 1280, height: 1024 }];
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nptel-ws-')), 'sub', 'window-state.json');

test('defaults when there is no file or it is damaged', () => {
  const f = tmp();
  assert.deepStrictEqual(ws.load(f, AREAS), { width: 1280, height: 800, maximized: false, zoom: 0 });
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '{not json');
  assert.strictEqual(ws.load(f, AREAS).width, 1280);
  fs.writeFileSync(f, 'null');
  assert.strictEqual(ws.load(f, AREAS).width, 1280);
});

test('round trip, creating the folder', () => {
  const f = tmp();
  ws.save(f, { x: 100, y: 50, width: 1111, height: 777, maximized: true, zoom: 1.5 });
  assert.deepStrictEqual(ws.load(f, AREAS), { x: 100, y: 50, width: 1111, height: 777, maximized: true, zoom: 1.5 });
});

test('nonsense values are clamped away; a window left on a removed monitor is brought back', () => {
  const f = tmp(); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ x: 'a', y: null, width: 5, height: 1e9, maximized: 'yes', zoom: 99 }));
  assert.deepStrictEqual(ws.load(f, AREAS), { width: 1280, height: 800, maximized: false, zoom: 0 });
  fs.writeFileSync(f, JSON.stringify({ x: 5000, y: 100, width: 1000, height: 700 }));
  const r = ws.load(f, AREAS);
  assert.ok(!('x' in r) && !('y' in r), 'off-screen position dropped');
  fs.writeFileSync(f, JSON.stringify({ x: 2000, y: 100, width: 1000, height: 700 }));
  assert.strictEqual(ws.load(f, AREAS).x, 2000);          // second monitor is fine
});

test('save never throws', () => {
  assert.doesNotThrow(() => ws.save(path.join(os.tmpdir(), '\u0000bad', 'x.json'), { width: 1 }));
});
