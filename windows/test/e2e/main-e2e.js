'use strict';
/* Real-Electron end-to-end test (Linux: run it through scripts/e2e.sh, which uses xvfb).
   It starts the real app (real window, real preload, real IPC, real Chromium network stack) against a
   stand-in "YouTube" server on 127.0.0.1, then drives the page and checks what the user would see, plus the
   security rules (navigation, popups, protocol, permissions, bridge validation).
     electron test/e2e/main-e2e.js --phase=1|2 --user-data=<dir> */
const http = require('http');
const path = require('path');
const fs = require('fs');
const electron = require('electron');
const { app, shell, BrowserWindow } = electron;

const arg = (n) => (process.argv.find((a) => a.startsWith('--' + n + '=')) || '').slice(n.length + 3);
const PHASE = arg('phase') || '1';
const USER_DATA = arg('user-data');

const opened = [];                                           // links the app handed to the default browser
shell.openExternal = async (u) => { opened.push(u); };        // never launch a real browser in a test

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log('E2E ' + (c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, step) {
  const end = Date.now() + (ms || 8000);
  for (;;) {
    let v; try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step || 40);
  }
}

// ---------------- stand-in YouTube ----------------
const seen = [];
let mode = 'ok';
const mkVideo = (p, n) => ({ playlistVideoRenderer: { videoId: 'v' + p + 'x' + String(n).padStart(4, '0'), title: { simpleText: 'Lecture ' + n + ' - Fourier analysis & <b>filters</b>' }, lengthText: { simpleText: '45:00' } } });
const server = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    let body = null; try { body = JSON.parse(data); } catch (e) { /* not json */ }
    seen.push({ url: req.url, method: req.method, headers: req.headers, body, raw: data });
    if (mode === '500') { res.statusCode = 500; res.end('boom'); return; }
    if (mode === 'html') { res.setHeader('Content-Type', 'text/html'); res.end('<html>consent</html>'); return; }
    res.setHeader('Content-Type', 'application/json');
    if (body && body.continuation === 'CONT_TOKEN_2') {
      const items = []; for (let i = 1; i <= 20; i++) items.push(mkVideo(2, 40 + i));
      res.end(JSON.stringify({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: items } }] }));
      return;
    }
    const items = []; for (let i = 1; i <= 40; i++) items.push(mkVideo(1, i));
    items.push({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'CONT_TOKEN_2' } } } });
    res.end(JSON.stringify({
      header: { playlistHeaderRenderer: { numVideosText: { runs: [{ text: '60' }, { text: ' videos' }] } } },
      contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ playlistVideoListRenderer: { contents: items } }] } }] } } } }] } }
    }));
  });
});

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const { start } = require('../../lib/app');
  const ctx = await start({ ytUrl: 'http://127.0.0.1:' + port + '/youtubei/v1/browse?prettyPrint=false', userDataDir: USER_DATA, allowMultiple: true });
  const win = ctx.win, wc = win.webContents;
  const js = (c) => wc.executeJavaScript(c, true);
  wc.on('console-message', (e) => { const m = e.message !== undefined ? e.message : ''; if (process.env.E2E_VERBOSE || /error|fail|refused|denied/i.test(m)) console.log('E2E console: ' + String(m).slice(0, 200)); });
  const rowsOnList = () => js("document.querySelectorAll('#lecList .lec').length");
  const reloadPage = async () => {
    const done = new Promise((r) => wc.once('did-finish-load', r));
    ctx.reload();
    await done;
    await until(() => js("document.querySelectorAll('.tile').length===19"), 5000);
  };

  console.log('E2E phase ' + PHASE + ' - electron ' + process.versions.electron + ', chrome ' + process.versions.chrome);

  if (PHASE === '2') {
    ok(await js("JSON.parse(localStorage.getItem('nptel.saved.v2')||'[]').length") === 1, 'phase 2: the bookmark saved in phase 1 survived an app restart');
    const b = win.getBounds();
    ok(Math.abs(b.width - 1111) <= 40 && Math.abs(b.height - 777) <= 80, 'phase 2: window size restored (' + b.width + 'x' + b.height + ' vs 1111x777)');
    await js("document.querySelector('#tabs button[data-tab=saved]').click()");
    ok(await until(() => js("document.querySelectorAll('#savedBody .lec').length === 1"), 3000), 'phase 2: Saved tab shows the lecture');
    return finish();
  }

  // ---------- page + isolation ----------
  console.log('E2E -- page and isolation');
  ok(await js('location.href') === 'http://nptel-library.localhost/index.html', 'page is served at http://nptel-library.localhost/index.html and the key is gone from the address: ' + await js('location.href'));
  ok(await js('document.title') === 'NPTEL Library', 'window/page title');
  ok(await js("document.querySelectorAll('.tile').length") === 19, '19 subject tiles');
  ok(await js('window.isSecureContext') === true, 'page is a secure context');
  ok((await js("[typeof require, typeof process, typeof module, typeof Buffer].join()")) === 'undefined,undefined,undefined,undefined', 'page has no Node globals');
  ok((await js("Object.keys(window.Native).sort().join()")) === 'browse,openExternal,take', 'page sees only Native.{browse,openExternal,take}');
  const wp = wc.getLastWebPreferences();
  ok(wp.sandbox === true && wp.contextIsolation === true && wp.nodeIntegration === false && wp.webSecurity !== false, 'webPreferences: sandbox + contextIsolation on, nodeIntegration off');
  ok(!/Electron|NPTEL/i.test(await js('navigator.userAgent')) && /Chrome\/\d+\.0\.0\.0/.test(await js('navigator.userAgent')), 'user agent is a plain Chrome string: ' + await js('navigator.userAgent'));
  ok(wc.getURL().startsWith('http://nptel-library.localhost/'), 'webContents URL is ours');
  ok(win.getMinimumSize()[0] >= 400 && win.isMenuBarVisible() === false, 'min size set, no menu bar');

  // ---------- protocol handler ----------
  console.log('E2E -- local page server');
  const f = await js("fetch('/index.html').then(r=>({s:r.status,ct:r.headers.get('content-type'),csp:r.headers.get('content-security-policy')||''}))");
  ok(f.s === 200 && /text\/html/.test(f.ct) && /frame-src https:\/\/youtube\.com https:\/\/\*\.youtube\.com/.test(f.csp) && /object-src 'none'/.test(f.csp), 'index.html: 200, html, CSP header present');
  ok((await js("fetch('/secret.txt').then(r=>r.status)")) === 404, 'unknown path: 404');
  ok((await js("fetch('/index.html',{method:'POST',body:'x'}).then(r=>r.status)")) === 405, 'POST: 405');
  const refused = (v) => v === 'blocked' || v === 403;
  const probe = await js("fetch('http://127.0.0.1:" + port + "/probe').then(r=>r.status,()=>'blocked')");
  ok(refused(probe) && !seen.some((x) => x.url === '/probe'), 'plain-http to any other host is refused and never reaches the network (' + probe + ')');
  ok(refused(await js("fetch('http://example.com/').then(r=>r.status,()=>'blocked')")), 'plain-http to example.com is refused');
  ok(refused(await js("fetch('http://nptel-library.localhost:8080/').then(r=>r.status,()=>'blocked')")), 'other port on our own host name is refused');
  const viol = await js("new Promise(function(res){document.addEventListener('securitypolicyviolation',function(e){res(e.violatedDirective)});var i=document.createElement('iframe');i.src='https://example.com/';document.body.appendChild(i);setTimeout(function(){res('none')},3000)})");
  ok(/^frame-src/.test(viol), 'CSP is enforced: an iframe to an unlisted site is blocked (' + viol + ')');

  // ---------- navigation / popups ----------
  console.log('E2E -- navigation guards');
  const startUrl = wc.getURL();
  await js("location.href='https://example.com/'");
  await sleep(600);
  ok(wc.getURL() === startUrl, 'top-level navigation to another site is cancelled');
  ok(opened.length === 0, 'and a non-YouTube site is not handed to the browser either (' + opened.length + ')');
  await js("window.open('https://evil.example/x')"); await sleep(200);
  await js("window.open('http://www.youtube.com/watch?v=abc')"); await sleep(200);
  await js("window.open('javascript:alert(1)')"); await sleep(200);
  ok(opened.length === 0 && BrowserWindow.getAllWindows().length === 1, 'window.open to non-https / other sites: nothing opens');
  await js("window.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=emb_title')"); await sleep(300);
  ok(opened.length === 1 && opened[0] === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=emb_title' && BrowserWindow.getAllWindows().length === 1, 'window.open to a YouTube page goes to the default browser, not a new window: ' + opened[0]);
  opened.length = 0;
  await js("var a=document.createElement('a');a.href='https://www.youtube.com/watch?v=link12345&list=PLabc';a.target='_top';document.body.appendChild(a);a.click()"); await sleep(500);
  ok(wc.getURL() === startUrl && opened[0] === 'https://www.youtube.com/watch?v=link12345&list=PLabc', 'a link that tries to replace the app window opens in the browser instead');
  opened.length = 0;

  // ---------- permissions ----------
  console.log('E2E -- permissions');
  ok((await js("new Promise(function(r){Notification.requestPermission().then(r)})")) === 'denied', 'notifications are denied');
  ok((await js("new Promise(function(r){navigator.geolocation.getCurrentPosition(function(){r('granted')},function(e){r('code '+e.code)})})")) === 'code 1', 'location is denied (code 1)');
  ok((await js("navigator.mediaDevices.getUserMedia({audio:true}).then(()=>'granted',e=>e.name)")) !== 'granted', 'microphone is not granted');

  // ---------- bridge validation ----------
  console.log('E2E -- bridge');
  const good = JSON.stringify({ browseId: 'VLPLabcdefghijklmnop' });
  // The page's own __nativeDone drains each result, so swap in a collector for these direct calls.
  await js("window.__got={};window.__nativeDone=function(id){window.__got[id]=window.Native.take('x',id)};true");
  const call = async (tok, id, body) => {
    await js('window.Native.browse(' + JSON.stringify(tok) + ',' + JSON.stringify(id) + ',' + JSON.stringify(body) + ')');
    await until(() => js('(' + JSON.stringify(id) + ' in window.__got)'), 1500, 30);
    return js('window.__got[' + JSON.stringify(id) + ']');
  };
  const n0 = seen.length;
  ok(/Request refused/.test(await call('WRONG', 'tA', good)), 'wrong key: refused');
  ok(typeof (await call(ctx.token, 'bad id', good)) === 'undefined', 'bad request id (space): dropped before it even leaves the page');
  ok(/Bad request/.test(await call(ctx.token, 'tB', JSON.stringify({ browseId: 'VLPLabcdefghijklmnop', extra: 1 }))), 'extra field: refused');
  ok(/Bad request/.test(await call(ctx.token, 'tC', JSON.stringify({ browseId: 'PLnoVLprefix12345' }))), 'browseId without VL prefix: refused');
  ok(/Bad request/.test(await call(ctx.token, 'tD', JSON.stringify({ browseId: 'VLPLabcdefghijklmnop', continuation: 'x' }))), 'both browseId and continuation: refused');
  ok(/Bad request/.test(await call(ctx.token, 'tE', 'x'.repeat(20001))), 'oversized body: refused');
  ok(/Bad request/.test(await call(ctx.token, 'tF', 'not json')), 'non-JSON body: refused');
  ok(seen.length === n0, 'none of those reached the network (' + (seen.length - n0) + ' requests)');
  const r1 = await call(ctx.token, 'tG', JSON.stringify({ context: { client: { clientName: 'EVIL' } }, browseId: 'VLPLabcdefghijklmnop' }));
  ok(!/__error/.test(r1) && JSON.parse(r1).header, 'valid call goes through and returns the stand-in YouTube JSON');
  const q = seen[seen.length - 1];
  ok(q && q.method === 'POST' && q.body && q.body.browseId === 'VLPLabcdefghijklmnop' && q.body.context.client.clientName === 'WEB' && q.body.context.client.hl === 'en', 'request was rebuilt by the app: the page-supplied context was ignored (' + JSON.stringify(q && q.body && q.body.context) + ')');
  ok(q && q.headers.origin === 'https://www.youtube.com' && q.headers['x-youtube-client-name'] === '1' && /^2\./.test(q.headers['x-youtube-client-version'] || '') && /json/.test(q.headers['content-type']), 'headers: Origin, X-YouTube-Client-Name/Version, Content-Type');
  ok(q && !/Electron|NPTEL/i.test(q.headers['user-agent'] || '') && !q.headers.cookie, 'no Electron token in the user agent, no cookies sent: ' + (q && q.headers['user-agent']));
  ok(q && q.url.startsWith('/youtubei/v1/browse?prettyPrint=false'), 'request path/query as configured');
  await js('window.Native.openExternal("WRONG","https://www.youtube.com/watch?v=abc")'); await sleep(150);
  await js('window.Native.openExternal(' + JSON.stringify(ctx.token) + ',"https://evil.com/")'); await sleep(150);
  await js('window.Native.openExternal(' + JSON.stringify(ctx.token) + ',"https://www.youtube.com/watch?v=abc&redirect=https://evil.com")'); await sleep(150);
  ok(opened.length === 0, 'openExternal: wrong key / other host / extra parameters are refused');
  await js('window.Native.openExternal(' + JSON.stringify(ctx.token) + ',"https://www.youtube.com/playlist?list=PLabc123")'); await sleep(250);
  ok(opened.length === 1 && opened[0] === 'https://www.youtube.com/playlist?list=PLabc123', 'openExternal: exact YouTube playlist link is handed to the browser');
  opened.length = 0;

  // ---------- the real UI flow ----------
  console.log('E2E -- using the app');
  await reloadPage();                                   // fresh page: the collector above is gone, the page's own bridge code is back
  ok(await js("String(window.__nativeDone).indexOf('__got')") === -1, 'the reload really reloaded the page (collector gone)');
  seen.length = 0;
  await js("document.querySelector('.tile').click()");
  ok(await until(() => js("document.querySelectorAll('#subBody .row').length>3"), 3000), 'subject opens with its course list');
  const courseId = await js("document.querySelector('#subBody .row').getAttribute('data-course')");
  await js("document.querySelector('#subBody .row').click()");
  ok(await until(async () => (await rowsOnList()) === 40, 8000), 'course opens and the first 40 lectures arrive through preload -> IPC -> net -> stand-in YouTube');
  ok(seen.length === 1 && seen[0].body.browseId === 'VL' + courseId, 'exactly one request, for the clicked course (VL' + courseId + ')');
  ok(/40 of 60 lectures/.test(await js("document.getElementById('crCount').innerText")), 'lecture count header: ' + await js("document.getElementById('crCount').innerText"));
  ok(await js("document.querySelector('#lecList .lec .lt').innerHTML") === 'Lecture 1 - Fourier analysis &amp; &lt;b&gt;filters&lt;/b&gt;', 'lecture titles are escaped (no HTML injection from YouTube data)');
  await js("(function(){var s=document.getElementById('crScroll');s.scrollTop=s.scrollHeight})()");
  ok(await until(async () => (await rowsOnList()) === 60, 8000), 'scrolling the list lazy-loads the next page (60 lectures)');
  ok(seen.length === 2 && seen[1].body.continuation === 'CONT_TOKEN_2' && !seen[1].body.browseId, 'second request used the continuation token');
  ok(/every lecture/.test(await js("document.getElementById('crFoot').innerText")), 'footer: end of course');
  const crBox = await js("(function(){var r=document.getElementById('crScroll').getBoundingClientRect();return {x:r.x,w:r.width}})()");
  ok(crBox.x > 600, 'desktop layout: lecture list is the right-hand column (x=' + Math.round(crBox.x) + ')');

  // bookmarks
  await js("document.querySelectorAll('#lecList .lec .sv')[2].click()");
  ok(await js("JSON.parse(localStorage.getItem('nptel.saved.v2')).map(function(s){return s.id}).join()") === 'v1x0003', 'bookmark button stores the lecture');
  await reloadPage();
  ok(await js("JSON.parse(localStorage.getItem('nptel.saved.v2')).length") === 1, 'bookmark is still there after reloading the page');

  // player fallback (YouTube itself is not reachable in this test, so the player script cannot load)
  await js("document.querySelector('.tile').click()");
  await until(() => js("document.querySelectorAll('#subBody .row').length>3"), 3000);
  await js("document.querySelector('#subBody .row').click()");
  await until(async () => (await rowsOnList()) === 40, 8000);
  await js("document.querySelectorAll('#lecList .lec')[1].click()");
  ok(await until(() => js("!document.getElementById('playerMsg').classList.contains('hidden') || !!document.querySelector('#ytHost iframe')"), 25000, 100), 'tapping a lecture either shows the player or the fallback message');
  if (await js("!document.getElementById('playerMsg').classList.contains('hidden')")) {
    await js("document.querySelector('#playerMsg [data-pm=ext]').click()"); await sleep(300);
    ok(opened.length === 1 && /^https:\/\/www\.youtube\.com\/watch\?v=v1x0002&list=PL/.test(opened[0]), 'fallback "Open in YouTube" opens the exact lecture in the browser: ' + opened[0]);
  } else {
    console.log('E2E note: the real YouTube player loaded in this environment');
  }
  opened.length = 0;

  // errors
  mode = '500'; seen.length = 0;
  await js("window.__back&&window.__back()");
  await js("document.querySelectorAll('#subBody .row')[1].click()");
  ok(await until(() => js("/HTTP 500/.test(document.getElementById('crFoot').innerText)"), 6000), 'server error is shown on the page ("YouTube returned HTTP 500")');
  mode = 'ok';
  await js("document.querySelector('#crFoot [data-act=retry]').click()");
  ok(await until(async () => (await rowsOnList()) === 40, 6000), '"Try again" recovers once YouTube answers');
  mode = 'html';
  await js("window.__back&&window.__back()");
  await js("document.querySelectorAll('#subBody .row')[2].click()");
  ok(await until(() => js("/Unexpected response/.test(document.getElementById('crFoot').innerText)"), 6000), 'a non-JSON answer (consent page) is reported, not hung on');
  mode = 'ok';

  // ---------- window / keys ----------
  console.log('E2E -- window and keys');
  await js("window.__back&&window.__back()");
  const before = await js("document.getElementById('v-subject').classList.contains('hidden')");
  win.emit('app-command', {}, 'browser-forward');
  await sleep(150);
  ok(before === false && await js("document.getElementById('v-subject').classList.contains('hidden')") === false, 'other app-commands are ignored');
  win.emit('app-command', {}, 'browser-backward');
  ok(await until(() => js("document.getElementById('v-home').classList.contains('hidden')===false"), 2000), 'mouse Back button goes up one screen');
  const marker = await js("window.__marker=1;true");
  const reloaded = new Promise((r) => wc.once('did-finish-load', r));
  wc.emit('before-input-event', { preventDefault() { } }, { type: 'keyDown', key: 'F5' });
  await Promise.race([reloaded, sleep(5000)]);
  ok(await until(() => js("typeof window.__marker==='undefined' && document.querySelectorAll('.tile').length===19"), 5000), 'F5 reloads the page (and the page still has its key)');
  const z0 = wc.getZoomLevel();
  wc.emit('before-input-event', { preventDefault() { } }, { type: 'keyDown', key: '=', control: true });
  ok(wc.getZoomLevel() === z0 + 0.5, 'Ctrl + zooms in');
  wc.emit('before-input-event', { preventDefault() { } }, { type: 'keyDown', key: '0', control: true });
  ok(wc.getZoomLevel() === 0, 'Ctrl 0 resets zoom');
  let prevented = false;
  wc.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', key: 'F12' });
  ok(!prevented && wc.isDevToolsOpened() === false, 'F12 does nothing without --devtools');

  // resize for phase 2, then crash recovery
  win.setSize(1111, 777); await sleep(900);
  ok(fs.existsSync(path.join(USER_DATA, 'window-state.json')), 'window state file written');
  const gone = new Promise((r) => wc.once('did-finish-load', r));
  wc.forcefullyCrashRenderer();
  await Promise.race([gone, sleep(8000)]);
  ok(await until(() => js("document.querySelectorAll('.tile').length===19"), 6000), 'renderer crash: the app page reloads itself (with a valid key)');
  await js("window.__got={};window.__nativeDone=function(id){window.__got[id]=window.Native.take('x',id)};true");
  const call2 = await call(ctx.token, 'tH', good);
  ok(typeof call2 === 'string' && !/__error/.test(call2) && /playlistHeaderRenderer/.test(call2), 'bridge works after the reload (new page, same key)');

  console.log('E2E -- closing; phase 2 will check persistence');
  return finish(true);
}

function finish(closeWindow) {
  console.log('E2E_RESULT ' + pass + ' passed, ' + fail + ' failed');
  server.close();
  setTimeout(() => app.exit(fail ? 1 : 0), closeWindow ? 800 : 100);
  if (closeWindow) { const w = BrowserWindow.getAllWindows()[0]; if (w) w.close(); }
}

main().catch((e) => { console.log('E2E CRASH ' + (e && e.stack || e)); app.exit(2); });
