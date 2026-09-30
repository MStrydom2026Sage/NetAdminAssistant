const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { loadAnalyzer, EXTENSION_DIR } = require('./load-analyzer');

const source = fs.readFileSync(path.join(EXTENSION_DIR, 'content.js'), 'utf8');

function readMarkup(labels, controls = [], ids = {}) {
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById(id) { return ids[id] || null; },
    querySelectorAll(selector) {
      if (selector.startsWith('label, th')) return labels;
      if (selector.startsWith('textarea[')) return controls;
      return [];
    }
  };
  const context = vm.createContext({ document, chrome: { runtime: { onMessage: { addListener() {} } } }, console });
  vm.runInContext(source, context);
  return context.readQuestionAnswer();
}

test('reads a question and multiline answer rendered in NetAdmin table cells', () => {
  const answer = 'Bank reconciliation is out of balance\n after importing the statement.';
  const cell = { innerText: answer, textContent: answer };
  const label = { textContent: 'How would you best describe this query?', getAttribute() { return null; }, nextElementSibling: cell };
  assert.equal(readMarkup([label]), answer);
  const analyzed = loadAnalyzer().analyseTicket({
    question: readMarkup([label]), questionSource: 'How would you best describe this query?',
    subject: 'Error 900987 G/L control account 2026'
  });
  assert.equal(analyzed.topic.id, 'bank-reconciliation');
});

test('reads label/textarea and named controls without swallowing adjacent form fields', () => {
  const control = { value: 'Employee tax PAYE differs between periods.' };
  const label = { textContent: 'How would you best describe this query? *', getAttribute(name) { return name === 'for' ? 'queryField' : null; } };
  assert.equal(readMarkup([label], [], { queryField: control }), control.value);
  const named = { value: 'Bank reconciliation fails.', getAttribute(name) { return name === 'name' ? 'describeThisQuery' : null; } };
  assert.equal(readMarkup([], [named]), named.value);
  const wrapper = { innerText: 'How would you best describe this query?\nBank reconciliation fails.\nProduct: Sage 300 Cloud' };
  assert.equal(readMarkup([{ textContent: 'How would you best describe this query?', getAttribute() { return null; }, parentElement: wrapper }]), 'Bank reconciliation fails.');
});

test('toolbar action has no popup and uses the existing side panel', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.side_panel.default_path, 'html/sidepanel.html');
  assert.match(fs.readFileSync(path.join(EXTENSION_DIR, 'background.js'), 'utf8'), /chrome\.action\.onClicked/);
});
