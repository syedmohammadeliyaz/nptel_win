'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT = { width: 1280, height: 800 };
const MIN = { width: 420, height: 560 };

function sane(n, lo, hi) { return typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi; }

function visibleOn(b, area) {
  const w = Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x);
  const h = Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y);
  return w >= 120 && h >= 80;
}

/** Last window size/position/zoom. Anything missing, damaged or off-screen falls back to the defaults. */
function load(file, workAreas) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { s = {}; }
  const out = {
    width: sane(s.width, MIN.width, 10000) ? Math.round(s.width) : DEFAULT.width,
    height: sane(s.height, MIN.height, 10000) ? Math.round(s.height) : DEFAULT.height,
    maximized: s.maximized === true,
    zoom: sane(s.zoom, -3, 4) ? s.zoom : 0
  };
  if (sane(s.x, -30000, 30000) && sane(s.y, -30000, 30000)) {
    const b = { x: Math.round(s.x), y: Math.round(s.y), width: out.width, height: out.height };
    if ((workAreas || []).some(function (a) { return visibleOn(b, a); })) { out.x = b.x; out.y = b.y; }
  }
  return out;
}

function save(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(state));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { /* best effort */ }
}

module.exports = { load, save, DEFAULT, MIN };
