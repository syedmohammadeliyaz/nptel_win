'use strict';
const { HOST, PAGE_CSP, PERMISSION_ORIGINS, ORIGIN } = require('./config');
const { openableLink, isOwnUrl } = require('./urls');

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

/**
 * Answer for any plain-http request in the app. Only http://nptel-library.localhost/ is ours (the page,
 * served from memory). Everything else over http is refused: the app has no use for it.
 */
function pageResponse(req, html) {
  let u;
  try { u = new URL(req.url); } catch (e) { return { status: 400, headers: TEXT, body: 'Bad request' }; }
  if (u.hostname !== HOST || u.port !== '' || u.username || u.password) return { status: 403, headers: TEXT, body: 'Blocked' };
  if (req.method !== 'GET') return { status: 405, headers: Object.assign({ Allow: 'GET' }, TEXT), body: 'Method not allowed' };
  if (u.pathname === '/' || u.pathname === '/index.html') {
    return {
      status: 200,
      body: html,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': PAGE_CSP,
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
      }
    };
  }
  return { status: 404, headers: TEXT, body: 'Not found' };
}

function createGuards(o) {
  const shell = o.shell;

  function openOut(u) {
    const href = openableLink(u);
    if (!href) return false;
    try { Promise.resolve(shell.openExternal(href)).catch(function () { }); } catch (e) { /* no default browser */ }
    return true;
  }

  return {
    // window.open / target=_blank from any frame: never a new app window; YouTube links go to the default browser.
    windowOpen: function (details) { openOut(details && details.url); return { action: 'deny' }; },
    // Top-level navigation away from our own page is cancelled (YouTube links go to the browser instead).
    willNavigate: function (event, url) {
      if (isOwnUrl(url)) return;
      event.preventDefault();
      openOut(url);
    },
    // Only full-screen video may be requested, and only by our page or YouTube's player.
    permissionAllowed: function (permission, requestingUrl) {
      if (permission !== 'fullscreen') return false;
      try { return PERMISSION_ORIGINS.indexOf(new URL(requestingUrl).origin) >= 0; } catch (e) { return false; }
    },
    permissionCheck: function (permission, requestingOrigin) {
      return permission === 'fullscreen' && PERMISSION_ORIGINS.indexOf(requestingOrigin) >= 0;
    },
    // YouTube's player wants a Referer; make sure the embed always carries our page's origin.
    embedHeaders: function (requestHeaders) {
      const h = Object.assign({}, requestHeaders);
      const has = Object.keys(h).some(function (k) { return k.toLowerCase() === 'referer' && h[k]; });
      if (!has) h.Referer = ORIGIN + '/';
      return h;
    }
  };
}

module.exports = { pageResponse, createGuards };
