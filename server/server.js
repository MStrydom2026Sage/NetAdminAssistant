const http = require('node:http');
const { analyseTicket, prepareTicket } = require('./analysis');

const MAX_BODY_BYTES = 300000;

function createServer({ apiKey, model = 'gpt-5.4-mini', fetchImpl = fetch, logger = console, heartbeatMs = 10000 } = {}) {
  const sessions = new Map();
  let active = 0;
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    const send = (status, data) => {
      if (res.destroyed) return;
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) return send(403, { success: false, error: 'Invalid helper host.' });
    if (origin && !extensionOrigin) return send(403, { success: false, error: 'Only the browser extension may access this helper.' });
    if (extensionOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-NetAdmin-Request');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && req.url === '/') {
      return send(200, { success: true, configured: Boolean(apiKey), model });
    }
    if (req.method !== 'POST' || req.url !== '/analyse-ticket') return send(404, { success: false, error: 'Not found.' });
    if (req.headers['x-netadmin-request'] !== 'live-analysis'
      || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
      return send(403, { success: false, error: 'An explicit extension JSON request is required.' });
    }
    if (!apiKey) return send(503, { success: false, error: 'Set OPENAI_API_KEY and restart the helper.' });
    // Bound paid work even if several panels or scripts call the helper.
    const now = Date.now();
    for (const [key, timestamp] of sessions) if (now - timestamp > 60000) sessions.delete(key);
    if (active >= 2 || sessions.size >= 2) return send(429, { success: false, error: 'Helper busy. Wait a minute before retrying.' });
    const id = Symbol();
    sessions.set(id, now);
    active += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      if (!req.complete) req.destroy();
    }, 150000);
    let heartbeat;
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.resume();
          return send(413, { success: false, error: 'Ticket evidence is too large.' });
        }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return send(400, { success: false, error: 'Invalid JSON request.' }); }
      try { prepareTicket(body); }
      catch (error) { return send(400, { success: false, error: error.message }); }
      // MV3 workers can terminate a fetch that waits 30s for response headers.
      // JSON whitespace keeps long research responses alive without partial results.
      heartbeat = setInterval(() => {
        if (res.destroyed || res.writableEnded) return;
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.write(' \n');
      }, heartbeatMs);
      const call = async (payload) => {
        const response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, model, store: false, max_output_tokens: 5000 })
        });
        if (!response.ok) {
          // Do not return or log provider bodies: they may contain ticket data.
          throw new Error(`OpenAI request failed (HTTP ${response.status}). Check the helper key, model access and quota.`);
        }
        return response.json();
      };
      const analysis = await analyseTicket(body, call);
      send(200, { success: true, analysis, model });
    } catch (error) {
      logger.error('[NetAdmin AI] Analysis failed:', error.name);
      send(502, {
        success: false,
        error: controller.signal.aborted ? 'Live AI timed out or was cancelled. Try again.'
          : /^OpenAI request failed/.test(error.message) ? error.message
            : 'Live AI could not produce a valid, complete analysis. Try again; offline results remain available.'
      });
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      active -= 1;
      // Completed calls still count towards the short-window request limit.
    }
  });
}

if (require.main === module) {
  const server = createServer({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL });
  server.listen(3000, '127.0.0.1', () => console.log('NetAdmin AI helper: http://127.0.0.1:3000'));
}

module.exports = { createServer };
