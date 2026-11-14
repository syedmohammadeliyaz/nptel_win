'use strict';
/* Constants shared by the main process. Nothing here touches Electron, so it is easy to unit-test. */

const HOST = 'nptel-library.localhost';          // *.localhost is a secure context and never leaves this PC
const ORIGIN = 'http://' + HOST;                  // the page's own origin (localStorage lives under it)
const APP_ID = 'com.coursehub.nptel.desktop';

// YouTube's own web endpoint that lists a playlist's videos, page by page (same one the Android app uses).
// No API key: YouTube's web client does not need one for this call, so none is stored in the app.
const YT_BROWSE_URL = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';
const CLIENT_VERSION = '2.20250925.01.00';
const CLIENT_CONTEXT = { client: { clientName: 'WEB', clientVersion: CLIENT_VERSION, hl: 'en', gl: 'IN' } };

const LIMITS = {
  maxBodyChars: 20000,          // what the page may send to browse()
  maxContinuationChars: 16384,
  maxResponseBytes: 8 * 1024 * 1024,
  timeoutMs: 25000,
  maxInFlight: 6,
  maxBridgeLinkChars: 300,
  maxOpenLinkChars: 2048
};

// Response headers for our own page. Only what is safe without risking YouTube's player:
// no plugins, no <base>, no forms, and frames only from YouTube.
const PAGE_CSP = [
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'frame-src https://youtube.com https://*.youtube.com https://*.youtube-nocookie.com https://*.google.com',
  "img-src 'self' data: https://i.ytimg.com"
].join('; ');

const PERMISSION_ORIGINS = [ORIGIN, 'https://www.youtube.com', 'https://www.youtube-nocookie.com'];

module.exports = { HOST, ORIGIN, APP_ID, YT_BROWSE_URL, CLIENT_VERSION, CLIENT_CONTEXT, LIMITS, PAGE_CSP, PERMISSION_ORIGINS };
