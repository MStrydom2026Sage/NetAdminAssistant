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

test('knowledgebase links are shown as manual click-throughs, never as usable pre-filled searches', () => {
  const { context, nodes } = createPanel();
  context.renderAnalysis(A.analyseTicket(TICKET), false, nodes.results);
  assert.doesNotMatch(nodes.results.innerHTML, /viewsearch\.jsp/);
  assert.match(nodes.results.innerHTML, /cannot be pre-filled/);
  assert.doesNotMatch(nodes.results.innerHTML, /Pre-filled searches \(click to open\)/);
});

test('the sourced-guidance card and the draft reply stay in step with retrieval', () => {
  const { context, nodes } = createPanel();
  context.renderAnalysis(A.analyseTicket(TICKET), false, nodes.results);
  const offline = nodes.replyText.value;
  assert.match(nodes.results.innerHTML, /Guidance from matched Sage sources/);

  context.renderSources({
    enabled: true,
    results: [{ title: 'Report will not print', url: 'https://communityhub.sage.com/t/1', snippet: 'Check the destination.', source: 'Sage Community Hub' }],
    unavailable: [{ name: 'Sage Knowledgebase (ZA)', reason: 'the Knowledgebase search endpoint was retired and returns HTTP 404' }]
  });
  assert.match(nodes.replyText.value, /Report will not print \(Sage Community Hub\): https:\/\/communityhub\.sage\.com\/t\/1/);
  assert.match(nodes.liveSources.innerHTML, /Sage Knowledgebase \(ZA\) — the Knowledgebase search endpoint was retired and returns HTTP 404/);

  context.renderSources({ enabled: false, results: [], unavailable: [] });
  assert.equal(nodes.replyText.value, offline);
  assert.match(nodes.liveSources.innerHTML, /switched off/);
});
