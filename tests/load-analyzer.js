const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAnalyzer() {
  const file = path.join(__dirname, '..', 'extension', 'offline-engine.js');
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.NetAdminEngine;
}
module.exports = { loadAnalyzer };
