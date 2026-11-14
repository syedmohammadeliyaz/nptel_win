'use strict';
/* Runs in a sandboxed, isolated world before the page. It gives the page the same small "Native" API the
   Android app has (browse / take / openExternal) so one page serves both, and nothing else:
   no Node, no ipcRenderer, no file access. Every call is checked again in the main process. */
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PENDING = 16;
const results = new Map();            // request id -> YouTube's JSON (or an {"__error"} object), until the page takes it

function deliver(id, text) {
  if (results.size >= MAX_PENDING) results.delete(results.keys().next().value);
  results.set(id, text);
  try {
    // id was validated above, so it is safe to place inside the string
    webFrame.executeJavaScript('window.__nativeDone&&window.__nativeDone("' + id + '")').catch(function () { });
  } catch (e) { /* frame is gone */ }
}

contextBridge.exposeInMainWorld('Native', {
  browse: function (tok, id, body) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return;
    ipcRenderer.invoke('nptel:browse', String(tok), id, String(body)).then(
      function (t) { deliver(id, typeof t === 'string' ? t : '{"__error":"Unexpected reply"}'); },
      function () { deliver(id, '{"__error":"Internal error"}'); });
  },
  take: function (tok, id) {
    if (typeof id !== 'string') return '';
    const v = results.get(id);
    results.delete(id);
    return typeof v === 'string' ? v : '';
  },
  openExternal: function (tok, url) {
    ipcRenderer.invoke('nptel:openExternal', String(tok), String(url)).catch(function () { });
  }
});
