'use strict';
const { ORIGIN, LIMITS } = require('./config');

// The page may only ask the app to open these exact YouTube link shapes (same rule as the Android app).
// The raw string is matched, not a parsed URL, so a parser difference can never smuggle another host in.
const BRIDGE_LINK = /^https:\/\/www\.youtube\.com\/(?:watch\?v=[A-Za-z0-9_-]{1,64}(?:&list=[A-Za-z0-9_-]{1,64})?|playlist\?list=[A-Za-z0-9_-]{1,64})$/;

function isBridgeLink(u) {
  return typeof u === 'string' && u.length <= LIMITS.maxBridgeLinkChars && BRIDGE_LINK.test(u);
}

// Links a user clicks inside the YouTube player (title, "Watch on YouTube", ...) may open in the default
// browser, but only on YouTube's own hosts. Returns the normalised URL that is actually opened, or null.
const OPEN_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be']);

function openableLink(u) {
  if (typeof u !== 'string' || u.length === 0 || u.length > LIMITS.maxOpenLinkChars) return null;
  if (/[\u0000- \u007f-\u009f\\]/.test(u)) return null;      // whitespace, control characters, backslashes
  if (!u.startsWith('https://')) return null;
  let p;
  try { p = new URL(u); } catch (e) { return null; }
  if (p.protocol !== 'https:' || p.username || p.password || p.port) return null;
  if (!OPEN_HOSTS.has(p.hostname)) return null;
  return p.href;                                                   // open exactly what was validated
}

function isOwnUrl(u) {
  try { return new URL(u).origin === ORIGIN; } catch (e) { return false; }
}

module.exports = { BRIDGE_LINK, isBridgeLink, openableLink, isOwnUrl };
