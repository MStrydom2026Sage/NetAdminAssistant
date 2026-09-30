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
