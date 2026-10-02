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
    incidentTypeGroup: 'Support-Sage 300 Cloud',
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

function readGroup(elements, controls = [], ids = {}) {
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById(id) { return ids[id] || null; },
    querySelectorAll(selector) {
      if (selector.startsWith('label, th')) return elements;
      if (selector.startsWith('select[')) return controls;
      return [];
    }
  };
  const context = vm.createContext({ document, chrome: { runtime: { onMessage: { addListener() {} } } }, console });
  vm.runInContext(source, context);
  return context.readIncidentTypeGroup();
}

const node = (textContent, extra = {}) => Object.assign({ textContent, getAttribute: () => null }, extra);

test('reads the Incident Type Group from label/value, bound control, inline and named-control markup', () => {
  // label cell followed by a display cell
  assert.equal(readGroup([node('Incident Type Group', { nextElementSibling: node(' Support-Sage 300 Cloud ') })]), 'Support-Sage 300 Cloud');
  // label bound to a select: the option text is used, not its id value
  const select = { tagName: 'SELECT', value: '17', selectedOptions: [{ text: 'Support-Sage 300 People' }] };
  assert.equal(readGroup([node('Incident type group:', { getAttribute: (name) => (name === 'for' ? 'grp' : null) })], [], { grp: select }), 'Support-Sage 300 People');
  // value and label rendered in one element, followed by another field
  assert.equal(readGroup([node('Incident Type Group: Support-Sage 300 Cloud Priority: High')]), 'Support-Sage 300 Cloud');
  // named control with no visible label
  const named = { value: '9', selectedOptions: [{ text: 'Support-Sage 300 Cloud' }], getAttribute: (name) => (name === 'name' ? 'IncidentTypeGroupId' : null) };
  assert.equal(readGroup([], [named]), 'Support-Sage 300 Cloud');
  // placeholders and missing values are not a group
  const placeholder = { tagName: 'SELECT', selectedOptions: [{ text: '-- Please select --' }] };
  assert.equal(readGroup([node('Incident Type Group *', { nextElementSibling: placeholder })]), '');
  assert.equal(readGroup([]), '');
});

test('the scraped Incident Type Group is passed to the analyzer as an explicit field', () => {
  assert.match(source, /incidentTypeGroup: ''/);
  assert.match(source, /ticketData\.incidentTypeGroup = readIncidentTypeGroup\(\);/);
});

test('a dropdown widget shows the group while its hidden input only holds an id', () => {
  const widget = { textContent: 'Support-Sage 300 Cloud', innerText: 'Support-Sage 300 Cloud' };
  const cell = { querySelector: (selector) => (selector.includes('.k-input') ? widget : null), textContent: 'Support-Sage 300 Cloud' };
  const hidden = { tagName: 'INPUT', value: '12', parentElement: cell };
  const label = node('Incident type group', { getAttribute: (name) => (name === 'for' ? 'IncidentTypeGroupId' : null) });
  assert.equal(readGroup([label], [], { IncidentTypeGroupId: hidden }), 'Support-Sage 300 Cloud');
  // an id on its own is never reported as the group
  assert.equal(readGroup([node('Incident type group', { nextElementSibling: { tagName: 'INPUT', value: '12' } })]), '');
});

test('the query answer stops at the Ticket Survey and the next webform question', () => {
  const answer = 'Posting errors report does not print for French users.';
  const cell = { innerText: `${answer}\nTicket Survey\nHow satisfied were you with Sage 300 People support?` };
  const label = { textContent: 'How would you best describe this query?', getAttribute() { return null; }, nextElementSibling: cell };
  assert.equal(readMarkup([label]), answer);
  const next = { innerText: `${answer}\nDescribe the resolutions attempted: reinstalled` };
  assert.equal(readMarkup([{ textContent: 'How would you best describe this query?', getAttribute() { return null; }, nextElementSibling: next }]), answer);
});

test('labels inside a Ticket Survey section are ignored', () => {
  const surveyLabel = { textContent: 'How would you best describe this query?', getAttribute() { return null; },
    closest: (selector) => (/survey/.test(selector) ? {} : null), nextElementSibling: { innerText: 'Survey answer about Sage 300 People' } };
  const outlineLabel = { textContent: 'How would you best describe this query?', getAttribute() { return null; },
    closest: () => null, nextElementSibling: { innerText: 'Bank reconciliation fails.' } };
  assert.equal(readMarkup([surveyLabel, outlineLabel]), 'Bank reconciliation fails.');
});
