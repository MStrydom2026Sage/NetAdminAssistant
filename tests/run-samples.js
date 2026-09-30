/**
 * Print the offline analysis for each sample ticket.
 * Usage: npm run samples [-- --reply]
 */
const { loadExtension, loadKnowledgeFile } = require('./load-analyzer');
const { TICKETS } = require('./fixtures/tickets');

const { analyzer, knowledge } = loadExtension();
const entries = knowledge.normalizeKnowledge(loadKnowledgeFile());

for (const item of TICKETS) {
  const result = analyzer.analyseTicket(item.data, { knowledge: entries });
  const status = result.topic.id === item.topic ? 'PASS' : 'FAIL';
  console.log(`\n${status} ${item.data.incidentReference} ${item.name}`);
  console.log(`  Product: ${result.product} · Module: ${result.module.label}`);
  console.log(`  Topic:   ${result.topic.id} (${result.topic.resourceMode})`);
  console.log(`  Query:   ${result.query}`);
  console.log(`  Checks:  ${result.analysis.solution.hypotheses.length} rules-based · ${result.analysis.solution.questions.length} question(s)`);
  console.log(`  Knowledge: ${result.knowledge.map((entry) => entry.id).join(', ') || 'none'}`);
  console.log(`  Sources: ${result.sourceState.message}`);
  if (process.argv.includes('--reply')) console.log(`  Reply:\n${result.reply.replace(/^/gm, '    ')}`);
}
