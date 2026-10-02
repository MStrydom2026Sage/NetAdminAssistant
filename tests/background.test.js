const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EXTENSION_DIR } = require('./load-analyzer');

test('cache reuses the same ticket text but invalidates a changed question', async () => {
  const stored = { settings: { cacheEnabled: true }, analysisCache: {
    WF100001: { signature: 'old question', timestamp: Date.now(), data: { topic: 'gl-control-account' } }
  } };
  const chrome = {
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    storage: { local: {
      get(keys, callback) { callback(stored); },
      set(value, callback) { Object.assign(stored, value); callback?.(); }
    } }
  };
  const context = vm.createContext({ chrome, importScripts() {}, console });
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, 'background.js'), 'utf8'), context);
  assert.equal((await context.getCachedAnalysis('WF100001', 'old question')).topic, 'gl-control-account');
  assert.equal(await context.getCachedAnalysis('WF100001', 'new question'), null);
});

test('switching the Incident Type Group never reuses a cached analysis', async () => {
  const { analyzer } = require('./load-analyzer').loadExtension();
  const stored = { settings: { cacheEnabled: true }, analysisCache: {} };
  const chrome = {
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    storage: { local: {
      get(keys, callback) { callback(stored); },
      set(value, callback) { Object.assign(stored, value); callback?.(); }
    } }
  };
  const context = vm.createContext({
    chrome, importScripts() {}, console, NetAdminAnalyzer: analyzer,
    NetAdminKnowledge: { loadKnowledge: async () => [] }
  });
  vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, 'background.js'), 'utf8'), context);
  const analyze = (data) => new Promise((resolve) => context.handleAnalyze(data, resolve));
  const ticket = { incidentReference: 'WF100002', question: 'Error when user logs on', incidentTypeGroup: 'Support-Sage 300 Cloud' };

  const first = await analyze(ticket);
  assert.equal(first.fromCache, false);
  assert.equal(first.data.product, 'Sage 300 Cloud');
  assert.equal((await analyze(Object.assign({}, ticket))).fromCache, true);

  const switched = await analyze(Object.assign({}, ticket, { incidentTypeGroup: 'Support-Sage 300 People' }));
  assert.equal(switched.fromCache, false);
  assert.equal(switched.data.product, 'Sage 300 People');
  assert.ok(switched.data.topic.links.every((link) => !/custom_us_threehundred/.test(link.url)));

  const missing = await analyze(Object.assign({}, ticket, { incidentTypeGroup: '' }));
  assert.equal(missing.fromCache, false);
  assert.equal(missing.data.product, 'Sage product not specified');

  // product metadata and the analysis version are all part of the signature
  const base = context.analysisSignature(ticket);
  assert.notEqual(context.analysisSignature(Object.assign({}, ticket, { product: 'Sage 300 People' })), base);
  assert.notEqual(context.analysisSignature(Object.assign({}, ticket, { module: 'Payroll' })), base);
  assert.match(base, /"0\.7\.3"/);
});
