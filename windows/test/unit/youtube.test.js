'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { buildPayload, createBrowse, friendlyNetError } = require('../../lib/youtube');

const GOOD = JSON.stringify({ context: { client: { clientName: 'EVIL' } }, browseId: 'VLPLbMVogVj5nJSHP0t4uPZBv9I-e7CTgV0t' });

test('buildPayload accepts a playlist or a continuation, and rebuilds the context', () => {
  const a = buildPayload(GOOD);
  assert.deepStrictEqual(Object.keys(a), ['context', 'browseId']);
  assert.strictEqual(a.context.client.clientName, 'WEB');
  const b = buildPayload(JSON.stringify({ continuation: 'EpYDEg%3D%3D' }));
  assert.deepStrictEqual(Object.keys(b), ['context', 'continuation']);
  assert.strictEqual(b.continuation, 'EpYDEg%3D%3D');
});

test('buildPayload refuses everything else', () => {
  const bad = [
    '', 'x', '[]', 'null', '"s"', '{}', '{"context":{}}',
    '{"browseId":"VLPLbMVogVj5nJSHP0t4uPZBv9I-e7CTgV0t","extra":1}',
    '{"browseId":"PLbMVogVj5nJSHP0t4uPZBv9I-e7CTgV0t"}',          // no VL prefix
    '{"browseId":"VLshort"}', '{"browseId":"VL' + 'a'.repeat(65) + '"}', '{"browseId":"VLPLabc def ghijklmn"}',
    '{"browseId":"FEwhat_to_watch"}', '{"browseId":123}',
    '{"browseId":"VLPLbMVogVj5nJSHP0t4uPZBv9I-e7CTgV0t","continuation":"x"}',
    '{"continuation":""}', '{"continuation":' + JSON.stringify('x'.repeat(16385)) + '}', '{"continuation":5}',
    '{"__proto__":{"browseId":"x"}}', '{"query":"x"}'
  ];
  for (const b of bad) assert.strictEqual(buildPayload(b), null, 'should refuse ' + b.slice(0, 50));
  assert.strictEqual(buildPayload('x'.repeat(20001)), null);
  assert.strictEqual(buildPayload(null), null);
  assert.strictEqual(buildPayload({}), null);
});

// ---- a stand-in for Electron's net module ----
function fakeNet(script) {
  const made = [];
  return {
    made,
    request(opts) {
      const req = new EventEmitter();
      req.opts = opts; req.headers = {}; req.written = ''; req.aborted = false; req.ended = false;
      req.setHeader = (k, v) => { req.headers[k] = v; };
      req.write = (d) => { req.written += d; };
      req.abort = () => { req.aborted = true; };
      req.end = () => { req.ended = true; setImmediate(() => script(req)); };
      made.push(req);
      return req;
    }
  };
}
function respond(req, status, chunks) {
  const res = new EventEmitter(); res.statusCode = status;
  req.emit('response', res);
  for (const c of chunks) res.emit('data', Buffer.from(c));
  res.emit('end');
}

test('createBrowse: success path, request shape and headers', async () => {
  const net = fakeNet((req) => respond(req, 200, ['{"a":', '"é"}']));
  const browse = createBrowse({ net, url: 'https://example.test/browse', userAgent: 'UA/1' });
  assert.strictEqual(await browse(GOOD), '{"a":"é"}');
  const r = net.made[0];
  assert.deepStrictEqual(r.opts, { method: 'POST', url: 'https://example.test/browse', redirect: 'error', credentials: 'omit', bypassCustomProtocolHandlers: true });
  assert.strictEqual(r.headers['Content-Type'], 'application/json');
  assert.strictEqual(r.headers['User-Agent'], 'UA/1');
  assert.strictEqual(r.headers.Origin, 'https://www.youtube.com');
  assert.strictEqual(r.headers['X-YouTube-Client-Name'], '1');
  assert.ok(/^2\./.test(r.headers['X-YouTube-Client-Version']));
  assert.deepStrictEqual(JSON.parse(r.written), { context: { client: { clientName: 'WEB', clientVersion: r.headers['X-YouTube-Client-Version'], hl: 'en', gl: 'IN' } }, browseId: 'VLPLbMVogVj5nJSHP0t4uPZBv9I-e7CTgV0t' });
  assert.ok(r.ended);
});

test('createBrowse: bad requests never touch the network', async () => {
  const net = fakeNet(() => { throw new Error('should not be called'); });
  const browse = createBrowse({ net, url: 'https://example.test/' });
  for (const b of ['', 'junk', '{"browseId":"nope"}', 'x'.repeat(20001)]) assert.deepStrictEqual(JSON.parse(await browse(b)), { __error: 'Bad request' });
  assert.strictEqual(net.made.length, 0);
});

test('createBrowse: HTTP errors, huge answers, network errors, timeouts', async () => {
  let net = fakeNet((req) => respond(req, 503, ['x']));
  assert.deepStrictEqual(JSON.parse(await createBrowse({ net, url: 'https://e.test/' })(GOOD)), { __error: 'YouTube returned HTTP 503' });

  net = fakeNet((req) => respond(req, 200, ['a'.repeat(600), 'b'.repeat(600)]));
  assert.deepStrictEqual(JSON.parse(await createBrowse({ net, url: 'https://e.test/', maxBytes: 1000 })(GOOD)), { __error: 'Response too large' });
  assert.ok(net.made[0].aborted, 'the oversized download is cancelled');

  net = fakeNet((req) => req.emit('error', new Error('net::ERR_NAME_NOT_RESOLVED')));
  assert.match(JSON.parse(await createBrowse({ net, url: 'https://e.test/' })(GOOD)).__error, /No internet connection \(ERR_NAME_NOT_RESOLVED\)/);

  net = fakeNet((req) => req.emit('error', new Error('net::ERR_CERT_AUTHORITY_INVALID')));
  assert.match(JSON.parse(await createBrowse({ net, url: 'https://e.test/' })(GOOD)).__error, /Network error \(ERR_CERT_AUTHORITY_INVALID\)/);

  net = fakeNet(() => { /* never answers */ });
  const t0 = Date.now();
  const r = JSON.parse(await createBrowse({ net, url: 'https://e.test/', timeoutMs: 80 })(GOOD));
  assert.match(r.__error, /Timed out/);
  assert.ok(Date.now() - t0 < 1000 && net.made[0].aborted);

  net = { request() { throw new Error('net::ERR_INVALID_URL'); } };
  assert.match(JSON.parse(await createBrowse({ net, url: 'x' })(GOOD)).__error, /Network error/);
});

test('createBrowse: limits parallel requests and frees the slot afterwards', async () => {
  const pending = [];
  const net = fakeNet((req) => pending.push(req));
  const browse = createBrowse({ net, url: 'https://e.test/', maxInFlight: 2, timeoutMs: 5000 });
  const p1 = browse(GOOD), p2 = browse(GOOD);
  const p3 = await browse(GOOD);
  assert.match(JSON.parse(p3).__error, /Too many/);
  await new Promise((r) => setImmediate(r));
  respond(pending[0], 200, ['{}']); respond(pending[1], 200, ['{}']);
  assert.strictEqual(await p1, '{}'); assert.strictEqual(await p2, '{}');
  const p4 = browse(GOOD);
  await new Promise((r) => setImmediate(r));
  respond(pending[2], 200, ['{"ok":1}']);
  assert.strictEqual(await p4, '{"ok":1}');
});

test('friendlyNetError', () => {
  assert.strictEqual(friendlyNetError(new Error('boom')), 'Network error');
  assert.strictEqual(friendlyNetError(null), 'Network error');
  assert.strictEqual(friendlyNetError(new Error('net::ERR_PROXY_CONNECTION_FAILED')), 'Network error (ERR_PROXY_CONNECTION_FAILED)');
});
