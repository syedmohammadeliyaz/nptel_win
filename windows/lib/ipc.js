'use strict';
const { isBridgeLink, isOwnUrl } = require('./urls');
const { errJson } = require('./youtube');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * What the page may ask the main process to do. Every call must come from OUR page in the top frame and
 * carry the one-time key that only our own page's script knows (it is handed over in the URL fragment).
 */
function createBridge(o) {
  const token = o.token, browse = o.browse, openLink = o.openLink;

  function fromOurPage(event) {
    const f = event && event.senderFrame;
    if (!f || typeof f.url !== 'string') return false;
    if (event.sender && event.sender.mainFrame && f !== event.sender.mainFrame) return false;   // sub-frames (YouTube) never
    return isOwnUrl(f.url);
  }

  return {
    onBrowse: function (event, tok, id, body) {
      if (!fromOurPage(event) || typeof tok !== 'string' || tok !== token) return Promise.resolve(errJson('Request refused'));
      if (typeof id !== 'string' || !ID_RE.test(id)) return Promise.resolve(errJson('Request refused'));
      return browse(body);
    },
    onOpenExternal: function (event, tok, url) {
      if (!fromOurPage(event) || typeof tok !== 'string' || tok !== token) return false;
      if (!isBridgeLink(url)) return false;
      openLink(url);
      return true;
    }
  };
}

module.exports = { createBridge, ID_RE };
