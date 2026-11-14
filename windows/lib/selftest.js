'use strict';
/* `NPTEL Library.exe --selftest` (or `npm run selftest`): drives the real app through the same steps a user
   does - open a subject, open a course, load its lecture list from YouTube, play the first lecture - and
   prints what happened. It exists so the GitHub build can report, on a machine with real internet, whether
   YouTube answers the app. It changes nothing and exits by itself. */
const fs = require('fs');

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function waitFor(fn, timeoutMs, stepMs) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { /* keep trying */ }
    await sleep(stepMs || 250);
  }
  return null;
}

async function run(ctx) {
  const win = ctx.win, wc = win.webContents;
  const js = function (code) { return wc.executeJavaScript(code, true); };
  const result = { when: new Date().toISOString(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, checks: {} };
  const note = function (name, ok, detail) { result.checks[name] = Object.assign({ ok: !!ok }, detail || {}); console.log('SELFTEST ' + name + ': ' + (ok ? 'ok' : 'FAILED') + (detail ? ' ' + JSON.stringify(detail) : '')); };

  try {
    const tiles = await js("document.querySelectorAll('.tile').length");
    note('page', tiles === 19, { subjectTiles: tiles, origin: await js('location.origin') });
    note('bridge', await js("typeof window.Native==='object' && typeof window.Native.browse==='function' && typeof window.Native.openExternal==='function'"));

    // open the first subject, then its first course, exactly like a click would
    await js("document.querySelector('.tile').click()");
    await waitFor(function () { return js("document.querySelectorAll('#subBody .row').length"); }, 5000);
    await js("document.querySelector('#subBody .row').click()");

    const listed = await waitFor(function () {
      return js("(function(){var n=document.querySelectorAll('#lecList .lec').length,e=document.querySelector('#crFoot .empty');return n>0?{n:n}:(e?{err:e.innerText}:null)})()");
    }, 60000, 500);
    note('lectureList', !!(listed && listed.n), listed ? (listed.n ? { lectures: listed.n } : { error: String(listed.err).slice(0, 300) }) : { error: 'no answer within 60 s' });
    if (!(listed && listed.n)) note('player', false, { skipped: 'there was no lecture list to play from' });

    if (listed && listed.n) {
      await js("document.querySelector('#lecList .lec').click()");
      const frame = await waitFor(function () {
        return wc.mainFrame.framesInSubtree.filter(function (f) { return /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//.test(f.url); })[0];
      }, 30000, 500);
      if (!frame) {
        const msg = await js("(document.querySelector('#playerMsg')||{}).innerText||''");
        note('player', false, { error: 'the YouTube player frame never appeared', pageMessage: String(msg).slice(0, 200) });
      } else {
        const state = await waitFor(async function () {
          const s = await frame.executeJavaScript("(function(){var v=document.querySelector('video'),e=document.querySelector('.ytp-error');return {t:v?v.currentTime:-1,paused:v?v.paused:null,ready:v?v.readyState:-1,err:e?e.innerText:''}})()");
          return (s.t > 0.5 || s.err) ? s : null;
        }, 45000, 1000);
        const last = state || await frame.executeJavaScript("(function(){var v=document.querySelector('video');return {t:v?v.currentTime:-1,paused:v?v.paused:null,ready:v?v.readyState:-1,err:''}})()").catch(function () { return {}; });
        note('player', !!(state && state.t > 0.5), { frame: frame.url.replace(/\?.*/, ''), currentTime: last.t, paused: last.paused, readyState: last.ready, errorText: String(last.err || '').slice(0, 200) });
      }
    }
  } catch (e) {
    note('selftest', false, { error: String((e && e.message) || e) });
  }

  const ok = ['page', 'bridge', 'lectureList', 'player'].every(function (k) { return result.checks[k] && result.checks[k].ok; });
  result.ok = ok;
  console.log('SELFTEST_RESULT ' + JSON.stringify(result));
  if (ctx.out) { try { fs.writeFileSync(ctx.out, JSON.stringify(result, null, 2)); } catch (e) { /* ignore */ } }
  return ok ? 0 : 1;
}

module.exports = { run };
