'use strict';
const { CLIENT_CONTEXT, YT_BROWSE_URL, CLIENT_VERSION, LIMITS } = require('./config');

const BROWSE_ID = /^VL[A-Za-z0-9_-]{10,64}$/;

function errJson(msg) { return JSON.stringify({ __error: String(msg) }); }

/**
 * The page asks for "list this playlist" or "give me the next page". Anything else is refused, and the
 * request that goes to YouTube is rebuilt here from scratch, so the page cannot choose the client
 * identity, add fields, or reach other YouTube endpoints through this bridge.
 */
function buildPayload(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > LIMITS.maxBodyChars) return null;
  let j;
  try { j = JSON.parse(raw); } catch (e) { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  for (const k of Object.keys(j)) {
    if (k !== 'context' && k !== 'browseId' && k !== 'continuation') return null;   // context is accepted but ignored
  }
  const hasB = typeof j.browseId === 'string';
  const hasC = typeof j.continuation === 'string';
  if (hasB === hasC) return null;                                                  // exactly one of the two
  if (hasB) return BROWSE_ID.test(j.browseId) ? { context: CLIENT_CONTEXT, browseId: j.browseId } : null;
  if (j.continuation.length === 0 || j.continuation.length > LIMITS.maxContinuationChars) return null;
  return { context: CLIENT_CONTEXT, continuation: j.continuation };
}

function friendlyNetError(e) {
  const m = /net::(ERR_[A-Z0-9_]+)/.exec(String((e && e.message) || ''));
  if (!m) return 'Network error';
  if (/INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE/.test(m[1])) return 'No internet connection (' + m[1] + ')';
  return 'Network error (' + m[1] + ')';
}

function post(net, url, bodyText, o) {
  return new Promise(function (resolve) {
    let done = false, timer = null, req = null;
    const finish = function (text) { if (done) return; done = true; clearTimeout(timer); resolve(text); };
    const fail = function (msg) { try { if (req) req.abort(); } catch (e) { /* already finished */ } finish(errJson(msg)); };
    try {
      req = net.request({ method: 'POST', url: url, redirect: 'error', credentials: 'omit', bypassCustomProtocolHandlers: true });
    } catch (e) { finish(errJson(friendlyNetError(e))); return; }

    req.setHeader('Content-Type', 'application/json');
    if (o.userAgent) req.setHeader('User-Agent', o.userAgent);
    req.setHeader('Accept-Language', 'en-US,en;q=0.9');
    req.setHeader('Origin', 'https://www.youtube.com');
    req.setHeader('X-YouTube-Client-Name', '1');
    req.setHeader('X-YouTube-Client-Version', CLIENT_VERSION);

    timer = setTimeout(function () { fail('Timed out. Check your connection.'); }, o.timeoutMs);
    req.on('response', function (res) {
      if (res.statusCode !== 200) {
        res.on('data', function () { });
        res.on('error', function () { });
        fail('YouTube returned HTTP ' + res.statusCode);
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', function (c) {
        if (done) return;
        total += c.length;
        if (total > o.maxBytes) { fail('Response too large'); return; }
        chunks.push(c);
      });
      res.on('end', function () { finish(Buffer.concat(chunks).toString('utf8')); });
      res.on('error', function (e) { fail(friendlyNetError(e)); });
      res.on('aborted', function () { fail('Network error'); });
    });
    req.on('error', function (e) { fail(friendlyNetError(e)); });
    try { req.write(bodyText); req.end(); } catch (e) { fail(friendlyNetError(e)); }
  });
}

/**
 * Returns browse(rawBody) -> Promise<string>. The string is YouTube's JSON, or {"__error": "..."}.
 * It never rejects. `net` is Electron's net module (the Chromium network stack: system proxy and the
 * Windows certificate store apply), or a stand-in in tests.
 */
function createBrowse(opts) {
  const o = Object.assign({ url: YT_BROWSE_URL, userAgent: '', timeoutMs: LIMITS.timeoutMs, maxBytes: LIMITS.maxResponseBytes, maxInFlight: LIMITS.maxInFlight }, opts);
  let inFlight = 0;
  return function browse(raw) {
    const payload = buildPayload(raw);
    if (!payload) return Promise.resolve(errJson('Bad request'));
    if (inFlight >= o.maxInFlight) return Promise.resolve(errJson('Too many requests at once'));
    inFlight++;
    return post(o.net, o.url, JSON.stringify(payload), o).then(
      function (t) { inFlight--; return t; },
      function () { inFlight--; return errJson('Network error'); });
  };
}

module.exports = { buildPayload, createBrowse, errJson, friendlyNetError, BROWSE_ID };
