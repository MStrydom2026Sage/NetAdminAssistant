const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const http = require('node:http');
const { EXTENSION_DIR, loadExtension } = require('./load-analyzer');
const { analyseTicket, prepareTicket, collectSources } = require('../server/analysis');
const { createServer } = require('../server/server');

const ARTICLE = 'https://za-kb.sage.com/portal/ss/viewsolution.jsp?solutionid=123';
const COMMUNITY = 'https://communityhub.sage.com/za/sage-300-people/f/general-discussion/123';
const body = (product = 'Sage 300 People') => ({
  consent: true,
  ticket: {
    product, question: 'Scheduler does not send payslips [U60804]. user@example.com',
    resolutionsAttempted: 'Checked recurrence.',
    actions: [{ actionType: 'E-mailed', date: '2026-11-18', actionDescription: 'Please provide the task error.' }]
  },
  attachments: [{ name: 'scheduler.log', text: 'Task failed: SMTP timeout' }]
});
const final = () => ({
  issue: 'Payslip task fails', likelyCause: 'Mail configuration needs confirmation.',
  confidence: 'High', confirmedEvidence: ['The log records an SMTP timeout.'],
  reasoningSummary: 'A timeout does not establish a specific mail setting.',
  alreadyAttempted: ['Checked recurrence.'],
  recommendedSteps: ['Checked recurrence.', 'Confirm whether the SMTP service is reachable.'],
  informationNeeded: ['Task error requested in the previous agent email.'],
  replyNeeded: false, suggestedReply: 'Please send the task error again.', replyNote: 'Agent already requested the error.'
});
function response(value, urls = []) {
  return {
    status: 'completed',
    output: [
      { type: 'web_search_call', action: { sources: urls.map((url) => ({ url, title: 'Sage article' })) } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }
    ]
  };
}
function callsFor(responses) {
  const calls = [];
  const call = async (payload) => {
    calls.push(payload);
    assert.ok(responses.length, 'unexpected extra AI call');
    return responses.shift();
  };
  return { calls, call };
}
const plan = () => response({ primaryQuery: 'Scheduler payslip SMTP timeout', alternateQueries: ['Scheduled Tasks payslips'] });
const evidence = (strength, url) => response({
  strength, findings: url ? [{ finding: 'A task error needs investigation.', sourceUrl: url }] : [], unresolved: []
}, url ? [url] : []);

test('live payload is whitelisted, keeps full query and normalizes existing history fields', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, 'live-ai.js'), 'utf8'), context);
  const ticket = {
    incidentReference: 'WF12345', incidentTypeGroup: 'Support-Sage 300 People',
    question: `Scheduler ${'payslip '.repeat(50)}SMTP timeout at end`,
    customerEmail: 'private@example.com', metadata: { currentUrl: 'https://private/' },
    attachments: [{ url: 'https://private/file' }],
    actions: [{ actionType: 'E-mailed', date: '2026-11-18', actionDescription: 'Requested error details.' }]
  };
  const { analyzer } = loadExtension();
  const local = analyzer.analyseTicket(ticket);
  assert.throws(() => context.NetAdminLiveAI.buildRequest(ticket, local, [], false), /permission/);
  const request = context.NetAdminLiveAI.buildRequest(ticket, local, [], true);
  assert.match(request.ticket.question, /SMTP timeout at end$/);
  assert.equal(request.ticket.actions[0].action, 'E-mailed');
  assert.doesNotMatch(JSON.stringify(request), /WF12345|private@example|https:\/\/private/);
});

test('invalid consent, product, product conflict, HTML and oversized attachments are rejected', () => {
  assert.throws(() => prepareTicket({ ...body(), consent: false }), /consent/);
  assert.throws(() => prepareTicket(body('Sage product not specified')), /Confirm/);
  const conflict = body();
  conflict.ticket.productConflict = true;
  assert.throws(() => prepareTicket(conflict), /conflicting/);
  assert.throws(() => prepareTicket({ ...body(), attachments: [{ name: 'x.log', text: '<html>login</html>' }] }), /web page/);
  assert.throws(() => prepareTicket({ ...body(), attachments: [{ name: 'x.log', text: 'é'.repeat(10001) }] }), /20,000/);
  const prepared = prepareTicket(body());
  assert.doesNotMatch(prepared.question, /U60804|user@example.com/);
});

test('People research is KB-first, propagates log/history evidence and separates attempted work', async () => {
  const mock = callsFor([plan(), evidence('Strong', ARTICLE), response(final())]);
  const result = await analyseTicket(body(), mock.call);
  assert.equal(mock.calls.length, 3);
  assert.deepEqual(mock.calls[1].tools[0].filters.allowed_domains, ['za-kb.sage.com']);
  const synthesis = JSON.parse(mock.calls[2].input);
  assert.match(synthesis.ticket.attachments[0].text, /SMTP timeout/);
  assert.equal(synthesis.ticket.actions[0].action, 'E-mailed');
  assert.equal(result.replyNeeded, false);
  assert.equal(result.suggestedReply, '');
  assert.deepEqual(result.recommendedSteps, ['Confirm whether the SMTP service is reachable.']);
  assert.equal(result.sources[0].url, ARTICLE);
  assert.equal(result.confidence, 'High');
});

test('search plans enforce short technical queries and remove site codes without placeholder debris', async () => {
  const search = response({
    primaryQuery: '[U60804] Scheduler payslip SMTP error sending email with task recurrence failure',
    alternateQueries: ['site code: U60804 Scheduled Tasks payslips', 'user@example.com Scheduler SMTP']
  });
  const mock = callsFor([search, evidence('Strong', ARTICLE), response(final())]);
  const result = await analyseTicket(body(), mock.call);
  assert.ok(result.searchQueries.every((query) => query.length <= 60 && query.split(/\s+/).length <= 6));
  assert.doesNotMatch(result.searchQueries.join(' '), /U60804|example.com|removed|\[|\]/);
  assert.match(result.searchQueries[0], /^Scheduler payslip SMTP/);
});

test('weak People KB evidence triggers secondary community research but not high confidence', async () => {
  const mock = callsFor([plan(), evidence('Weak', ARTICLE), evidence('Strong', COMMUNITY), response(final())]);
  const result = await analyseTicket(body(), mock.call);
  assert.deepEqual(mock.calls[2].tools[0].filters.allowed_domains, ['communityhub.sage.com']);
  assert.equal(result.confidence, 'Medium');
  assert.equal(result.evidence.length, 2);
});

test('Cloud research uses official docs first and source-less responses force low confidence', async () => {
  const mock = callsFor([plan(), evidence('None'), evidence('None'), response(final())]);
  const result = await analyseTicket(body('Sage 300 Cloud'), mock.call);
  assert.deepEqual(mock.calls[1].tools[0].filters.allowed_domains, ['us-kb.sage.com', 'za-kb.sage.com', 'sage.com']);
  assert.equal(result.confidence, 'Low');
  assert.deepEqual(result.sources, []);
});

test('model-written, off-domain and non-HTTPS citations cannot become verified sources', async () => {
  const retrieved = collectSources({
    output: [
      { type: 'message', url: ARTICLE },
      { type: 'web_search_call', action: { sources: [
        { url: 'http://za-kb.sage.com/article' },
        { url: 'https://za-kb.sage.com.evil.example/article' },
        { url: 'https://user:pass@za-kb.sage.com/article' }
      ] } }
    ]
  }, ['za-kb.sage.com']);
  assert.equal(retrieved.size, 0);
  assert.equal(collectSources(evidence('Strong', COMMUNITY), ['sage.com']).size, 0);
  const forged = response({ strength: 'Strong', findings: [{ finding: 'Invented fix', sourceUrl: ARTICLE }], unresolved: [] });
  const mock = callsFor([plan(), forged, evidence('None'), response(final())]);
  const result = await analyseTicket(body(), mock.call);
  assert.equal(result.confidence, 'Low');
  assert.equal(result.evidence[0].findings.length, 0);
  assert.match(result.evidence[0].unresolved[0], /citations could not be verified/);
});

test('incomplete and structurally invalid model outputs fail instead of appearing successful', async () => {
  await assert.rejects(() => analyseTicket(body(), async () => ({ status: 'incomplete', output: [] })), /incomplete/);
  await assert.rejects(() => analyseTicket(body(), async () => response({ primaryQuery: 'SMTP timeout' })), /Invalid/);
});

async function helper(t, options = {}) {
  const server = createServer({ logger: { error() {} }, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (value, headers = {}) => fetch(`${url}/analyse-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-NetAdmin-Request': 'live-analysis', ...headers },
    body: JSON.stringify(value)
  });
  return { url, post };
}

test('helper reports missing configuration and blocks browser origins / simple cross-site requests', async (t) => {
  const { url, post } = await helper(t);
  assert.equal((await (await fetch(url)).json()).configured, false);
  assert.equal((await post(body())).status, 503);
  assert.equal((await post(body(), { Origin: 'https://example.com' })).status, 403);
  assert.equal((await post(body(), { 'X-NetAdmin-Request': '' })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const request = http.get(url, { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(status, 403);
});

test('helper executes full pipeline through mocked provider and never stores provider responses', async (t) => {
  const responses = [plan(), evidence('Strong', ARTICLE), response(final())];
  const providerCalls = [];
  const { post } = await helper(t, {
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      providerCalls.push(JSON.parse(options.body));
      return { ok: true, json: async () => responses.shift() };
    }
  });
  const result = await post(body(), { Origin: `chrome-extension://${'a'.repeat(32)}` });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('access-control-allow-origin'), `chrome-extension://${'a'.repeat(32)}`);
  assert.equal((await result.json()).analysis.sources[0].url, ARTICLE);
  assert.equal(providerCalls.length, 3);
  assert.ok(providerCalls.every((call) => call.store === false));
  assert.doesNotMatch(JSON.stringify(providerCalls), /user@example.com|U60804/);
});

test('helper rejects invalid/oversized requests and sanitizes provider errors', async (t) => {
  let calls = 0;
  const { post } = await helper(t, {
    apiKey: 'test-key',
    fetchImpl: async () => { calls += 1; return { ok: false, status: 401 }; }
  });
  assert.equal((await post({ ...body(), consent: false })).status, 400);
  const result = await post(body());
  assert.equal(result.status, 502);
  assert.match((await result.json()).error, /HTTP 401/);
  assert.equal(calls, 1);
  assert.equal((await post(body())).status, 429);

  const oversized = await helper(t, { apiKey: 'test-key' });
  assert.equal((await oversized.post({ ...body(), padding: 'x'.repeat(300001) })).status, 413);
});

test('slow research sends headers early for MV3 and still reports failure in the JSON envelope', async (t) => {
  let release;
  const { post } = await helper(t, {
    apiKey: 'test-key', heartbeatMs: 5,
    fetchImpl: async () => {
      await new Promise((resolve) => { release = resolve; });
      return { ok: false, status: 429 };
    }
  });
  const result = await post(body());
  assert.equal(result.status, 200);
  release();
  const data = await result.json();
  assert.equal(data.success, false);
  assert.match(data.error, /HTTP 429/);
});
