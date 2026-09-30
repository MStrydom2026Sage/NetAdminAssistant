const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const EXTENSION_DIR = path.join(__dirname, '..', 'extension');
const FILES = ['analyze.js', 'knowledge.js', 'history.js', 'sage-sources.js'];

/**
 * Load the extension modules in a bare VM context.
 * The context deliberately provides no Node APIs, so any accidental use of
 * require/process/Buffer in the extension code fails the tests.
 */
function loadExtension() {
  const context = vm.createContext({ console });
  for (const file of FILES) {
    const full = path.join(EXTENSION_DIR, file);
    vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename: full });
  }
  return {
    analyzer: context.NetAdminAnalyzer,
    knowledge: context.NetAdminKnowledge,
    history: context.NetAdminHistory,
    sources: context.NetAdminSources
  };
}

/** Load the curated knowledge file the same way the extension does. */
function loadKnowledgeFile() {
  return JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'knowledge', 'knowledge-base.json'), 'utf8'));
}

function loadAnalyzer() {
  return loadExtension().analyzer;
}

module.exports = { loadExtension, loadAnalyzer, loadKnowledgeFile, EXTENSION_DIR };
