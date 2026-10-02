const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { loadExtension, EXTENSION_DIR } = require('./load-analyzer');

const source = fs.readFileSync(path.join(EXTENSION_DIR, 'sidepanel.js'), 'utf8');
const { analyzer: A } = loadExtension();

/** Minimal DOM stub: enough for the render helpers, nothing more. */
function createPanel() {
  const nodes = {};
  const element = (id) => {
    const node = {
      id,
      innerHTML: '',
      outerHTML: '',
      value: '',
      hidden: true,
      set textContent(value) {
        this.innerHTML = String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }
    };
    nodes[id] = node;
    return node;
  };
  ['results', 'replySection', 'replyText', 'liveSources'].forEach(element);
  const document = {
    addEventListener() {},
    createElement() { return element('scratch'); },
    getElementById(id) { return nodes[id] || null; }
  };
  const context = vm.createContext({
    document,
    console,
    NetAdminAnalyzer: A,
    chrome: { runtime: { sendMessage() {} } }
  });
  vm.runInContext(source, context);
  return { context, nodes };
}

const TICKET = {
  incidentReference: 'WF400001',
  customer: { contactName: 'Thandi' },
  rawLoggedText: 'Product: Sage 300 Cloud\nHow would you best describe this query?: The A/R customer statement report does not print.'
};

test('the side panel no longer renders a similar completed tickets section', () => {
  const { context, nodes } = createPanel();
  context.renderAnalysis(A.analyseTicket(TICKET), false, nodes.results);
  assert.doesNotMatch(nodes.results.innerHTML, /Similar completed tickets|similarSection|No similar completed tickets/i);
});

test('the side panel separates ticket facts, rules-based checks and questions', () => {
  const { context, nodes } = createPanel();
  context.renderAnalysis(A.analyseTicket(TICKET), false, nodes.results);
  const html = nodes.results.innerHTML;
  assert.match(html, /Confirmed from this ticket/);
  assert.match(html, /Rules-based checks derived from the recorded query/);
  assert.match(html, /Local rule: Report printing and print destination/);
  assert.match(html, /Still to confirm with the customer/);
  assert.match(html, /Print Destination/);
  assert.doesNotMatch(html, /Collect screenshots or logs|Reproduce the issue in a safe test environment/);
});

test('knowledgebase searches are pre-filled, and unfiltered ones are labelled as such', () => {
  const { context, nodes } = createPanel();
  context.renderAnalysis(A.analyseTicket(TICKET), false, nodes.results);
  assert.doesNotMatch(nodes.results.innerHTML, /viewsearch\.jsp/);
  assert.match(nodes.results.innerHTML, /za-kb\.sage\.com\/portal\/ss\/\?querytext=Sage\+300\+Cloud\+/);
  assert.match(nodes.results.innerHTML, /results are not filtered by product/);
  assert.doesNotMatch(nodes.results.innerHTML, /Pre-filled searches \(click to open\)/);
});

test('the sourced-guidance card and the draft reply stay in step with retrieval', () => {
  const { context, nodes } = createPanel();
  context.renderAnalysis(A.analyseTicket(TICKET), false, nodes.results);
  const offline = nodes.replyText.value;
  assert.match(nodes.results.innerHTML, /Guidance from matched Sage sources/);

  context.renderSources({
    enabled: true,
    results: [{ title: 'Report will not print', url: 'https://communityhub.sage.com/t/1', snippet: 'Check the destination.', source: 'Sage Community Hub', productVerified: true }],
    unavailable: [{ name: 'Sage Knowledgebase (ZA)', reason: 'the Knowledgebase search endpoint was retired and returns HTTP 404' }]
  });
  assert.match(nodes.replyText.value, /Report will not print \(Sage Community Hub\): https:\/\/communityhub\.sage\.com\/t\/1/);
  assert.match(nodes.liveSources.innerHTML, /Sage Knowledgebase \(ZA\) — the Knowledgebase search endpoint was retired and returns HTTP 404/);

  context.renderSources({ enabled: false, results: [], unavailable: [] });
  assert.equal(nodes.replyText.value, offline);
  assert.match(nodes.liveSources.innerHTML, /switched off/);
});

test('the persistent "Offline rules analysis ready" banner is gone; action feedback is transient', () => {
  const html = fs.readFileSync(path.join(EXTENSION_DIR, 'html', 'sidepanel.html'), 'utf8');
  assert.doesNotMatch(html, /Offline rules analysis ready/);
  assert.doesNotMatch(source, /Offline rules analysis ready/);
  assert.match(html, /id="backendStatus"[^>]*\bhidden\b/);

  const { context } = createPanel();
  const status = { hidden: true, className: '', textContent: '' };
  const timers = [];
  context.document.getElementById = (id) => (id === 'backendStatus' ? status : null);
  context.setTimeout = (callback) => { timers.push(callback); return timers.length; };
  context.clearTimeout = () => {};
  context.setStatus('Cache cleared', 'success');
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, 'Cache cleared');
  timers.forEach((callback) => callback());
  assert.equal(status.hidden, true);
  assert.equal(status.textContent, '');
});

test('Sage searches show the issue phrase and the Incident Type Group product filter separately', () => {
  const question = 'How would you best describe this query?: Error when user logs on to the company';
  const cloud = createPanel();
  cloud.context.renderAnalysis(A.analyseTicket({ incidentReference: 'WF1', incidentTypeGroup: 'Support-Sage 300 Cloud', rawLoggedText: question }), false, cloud.nodes.results);
  const cloudHtml = cloud.nodes.results.innerHTML;
  assert.match(cloudHtml, /Search phrase \(from the recorded query\):<\/p><strong>error when user logs on/i);
  assert.match(cloudHtml, /Product filter: Sage 300 Cloud \(Incident Type Group: Support-Sage 300 Cloud\)/);
  assert.match(cloudHtml, /us-kb\.sage\.com\/portal\/ss\/\?querytext=/);
  assert.doesNotMatch(cloudHtml, /Sage 300 People/);

  const people = createPanel();
  people.context.renderAnalysis(A.analyseTicket({ incidentReference: 'WF2', incidentTypeGroup: 'Support-Sage 300 People', rawLoggedText: question }), false, people.nodes.results);
  const peopleHtml = people.nodes.results.innerHTML;
  assert.match(peopleHtml, /Product filter: Sage 300 People/);
  assert.doesNotMatch(peopleHtml, /custom_us_threehundred|us-kb\.sage\.com|Sage 300 Cloud/);
  assert.match(peopleHtml, /za-kb\.sage\.com\/portal\/ss\/\?querytext=Sage\+300\+People\+Error\+when\+user\+logs\+on/);

  const unknown = createPanel();
  unknown.context.renderAnalysis(A.analyseTicket({ incidentReference: 'WF3', rawLoggedText: question }), false, unknown.nodes.results);
  assert.match(unknown.nodes.results.innerHTML, /No product filter: the Incident Type Group was not found/);
  assert.doesNotMatch(unknown.nodes.results.innerHTML, /custom_us_threehundred/);
});
