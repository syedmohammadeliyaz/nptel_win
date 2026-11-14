'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const { createBrowse } = require('./youtube');
const { createBridge } = require('./ipc');
const { pageResponse, createGuards } = require('./guards');
const windowState = require('./windowState');

const ROOT = path.join(__dirname, '..');

/** A plain desktop-Chrome user agent (no "Electron/x.y" or app-name tokens), like the Android app's. */
function chromeUserAgent(versions) {
  const major = String((versions && versions.chrome) || '124').split('.')[0];
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + major + '.0.0.0 Safari/537.36';
}

/**
 * Starts the app. Resolves (after the first page load) with { win, token, reload, userAgent }, or null
 * if another copy is already running. `opts` exists for the automated tests only.
 */
function start(opts) {
  opts = opts || {};
  const electron = opts.electron || require('electron');
  const { app, BrowserWindow, Menu, nativeTheme, ipcMain, session, shell, screen, dialog, net } = electron;
  const argv = opts.argv || process.argv;
  const devtools = argv.indexOf('--devtools') >= 0;
  const selftest = argv.indexOf('--selftest') >= 0;
  const selftestOut = (argv.filter(function (a) { return a.indexOf('--selftest-out=') === 0; })[0] || '').slice('--selftest-out='.length);

  // ---- where the bookmarks (browser storage) live ----
  let userData = opts.userDataDir || null;
  if (!userData && selftest) userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nptel-selftest-'));
  if (!userData && process.env.PORTABLE_EXECUTABLE_DIR) {          // the "portable" build keeps its data next to the .exe
    const d = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'NPTEL-Library-data');
    try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); userData = d; } catch (e) { /* read-only folder: use the normal profile */ }
  }
  if (userData) app.setPath('userData', userData);
  if (process.platform === 'win32') app.setAppUserModelId(cfg.APP_ID);

  let mainWin = null;
  if (!selftest && !opts.allowMultiple) {
    if (!app.requestSingleInstanceLock()) { app.quit(); return Promise.resolve(null); }
    app.on('second-instance', function () {
      if (!mainWin || mainWin.isDestroyed()) return;
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    });
  }
  app.on('window-all-closed', function () { app.quit(); });

  const userAgent = chromeUserAgent(process.versions);
  app.userAgentFallback = userAgent;

  return app.whenReady().then(function () {
    const token = crypto.randomBytes(16).toString('hex');
    // The one-time key travels in the URL fragment. A reload must change something before the '#', otherwise
    // Chromium treats it as a same-page jump and does not reload anything, so each reload gets ?r=<n>.
    let loads = 0;
    const urlFor = function () { return cfg.ORIGIN + '/index.html' + (loads++ ? '?r=' + loads : '') + '#' + token; };
    const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'));
    const ses = session.defaultSession;
    const guards = createGuards({ shell: shell });

    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(null);
    ses.setUserAgent(userAgent);

    // The page is served from memory at http://nptel-library.localhost (not file://, which makes YouTube's
    // player fail with error 153, and not a TCP port). Every other plain-http request is refused.
    ses.protocol.handle('http', function (request) {
      const r = pageResponse({ url: request.url, method: request.method }, html);
      return new Response(r.body, { status: r.status, headers: r.headers });
    });
    ses.setPermissionRequestHandler(function (wc, permission, callback, details) {
      callback(guards.permissionAllowed(permission, (details && details.requestingUrl) || ''));
    });
    ses.setPermissionCheckHandler(function (wc, permission, requestingOrigin) {
      return guards.permissionCheck(permission, requestingOrigin);
    });
    ses.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*', 'https://www.youtube-nocookie.com/embed/*'] }, function (details, callback) {
      callback({ requestHeaders: guards.embedHeaders(details.requestHeaders) });
    });

    app.on('web-contents-created', function (_e, wc) {
      wc.setWindowOpenHandler(function (details) { return guards.windowOpen(details); });
      wc.on('will-navigate', function (details) { guards.willNavigate(details, details.url); });
      wc.on('will-redirect', function (details) { guards.willNavigate(details, details.url); });
      wc.on('will-attach-webview', function (event) { event.preventDefault(); });
    });

    const browse = createBrowse({ net: net, url: opts.ytUrl || cfg.YT_BROWSE_URL, userAgent: userAgent });
    const bridge = createBridge({
      token: token,
      browse: browse,
      openLink: function (u) { try { Promise.resolve(shell.openExternal(u)).catch(function () { }); } catch (e) { /* no browser */ } }
    });
    ipcMain.handle('nptel:browse', function (event, tok, id, body) { return bridge.onBrowse(event, tok, id, body); });
    ipcMain.handle('nptel:openExternal', function (event, tok, url) { return bridge.onOpenExternal(event, tok, url); });

    // ---- window ----
    const stateFile = path.join(app.getPath('userData'), 'window-state.json');
    const st = windowState.load(stateFile, screen.getAllDisplays().map(function (d) { return d.workArea; }));
    const iconFile = path.join(ROOT, 'build', 'icon.png');
    const win = new BrowserWindow({
      width: st.width, height: st.height, x: st.x, y: st.y,
      minWidth: windowState.MIN.width, minHeight: windowState.MIN.height,
      show: false, backgroundColor: '#0F1114', title: 'NPTEL Library', autoHideMenuBar: true,
      icon: fs.existsSync(iconFile) ? iconFile : undefined,
      webPreferences: {
        preload: path.join(ROOT, 'preload.js'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
        webSecurity: true, allowRunningInsecureContent: false, spellcheck: false, safeDialogs: true,
        autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false, devTools: devtools
      }
    });
    mainWin = win;
    const wc = win.webContents;
    win.setTitle('NPTEL Library');
    win.once('ready-to-show', function () { if (st.maximized) win.maximize(); win.show(); });
    setTimeout(function () { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 10000);   // never stay invisible

    function reloadApp() { if (!win.isDestroyed()) win.loadURL(urlFor()); }

    let saveTimer = null;
    function persistNow() {
      if (win.isDestroyed()) return;
      const b = win.getNormalBounds();
      windowState.save(stateFile, { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized(), zoom: wc.getZoomLevel() });
    }
    function persistSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(persistNow, 500); }
    ['resize', 'move', 'maximize', 'unmaximize'].forEach(function (ev) { win.on(ev, persistSoon); });
    win.on('close', function () { clearTimeout(saveTimer); persistNow(); });

    function zoomBy(step) { wc.setZoomLevel(Math.max(-3, Math.min(4, wc.getZoomLevel() + step))); persistSoon(); }
    wc.on('before-input-event', function (event, input) {
      if (input.type !== 'keyDown') return;
      const ctrl = input.control || input.meta;
      if (input.key === 'F11') { event.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
      else if (input.key === 'F5' || (ctrl && !input.alt && (input.key === 'r' || input.key === 'R'))) { event.preventDefault(); reloadApp(); }
      else if (devtools && input.key === 'F12') { event.preventDefault(); wc.toggleDevTools(); }
      else if (ctrl && !input.alt && (input.key === '=' || input.key === '+')) { event.preventDefault(); zoomBy(0.5); }
      else if (ctrl && !input.alt && (input.key === '-' || input.key === '_')) { event.preventDefault(); zoomBy(-0.5); }
      else if (ctrl && !input.alt && input.key === '0') { event.preventDefault(); wc.setZoomLevel(0); persistSoon(); }
    });
    // the mouse's "Back" button (and the keyboard's browser-back key) go up one screen inside the app
    win.on('app-command', function (_e, command) {
      if (command === 'browser-backward') wc.executeJavaScript('window.__back&&window.__back()').catch(function () { });
    });
    wc.on('context-menu', function (_e, params) {
      if (!params.isEditable && !params.selectionText) return;
      Menu.buildFromTemplate(params.isEditable
        ? [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }]
        : [{ role: 'copy' }]).popup({ window: win });
    });

    let lastGone = 0;
    wc.on('render-process-gone', function (_e, details) {
      if (details && details.reason === 'clean-exit') return;
      const now = Date.now();
      if (now - lastGone < 15000) { app.quit(); return; }          // crashed again straight away: stop, don't loop
      lastGone = now;
      setTimeout(reloadApp, 200);
    });
    wc.on('did-fail-load', function (_e, code, desc, url, isMainFrame) {
      if (isMainFrame && code !== -3) dialog.showErrorBox('NPTEL Library', 'The app page could not be loaded (' + desc + ').');
    });

    const ctx = { win: win, token: token, reload: reloadApp, userAgent: userAgent };
    return new Promise(function (resolve) {
      wc.once('did-finish-load', function () {
        if (st.zoom) wc.setZoomLevel(st.zoom);
        if (selftest) {
          require('./selftest').run({ win: win, out: selftestOut }).then(function (code) { app.exit(code); }, function () { app.exit(2); });
        }
        resolve(ctx);
      });
      win.loadURL(urlFor());
    });
  });
}

module.exports = { start, chromeUserAgent };
