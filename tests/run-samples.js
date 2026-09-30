/**
 * Print the offline analysis for each sample ticket.
 * Usage: npm run samples [-- --reply]
 */
const { loadExtension, loadKnowledgeFile } = require('./load-analyzer');
const { TICKETS, COMPLETED } = require('./fixtures/tickets');

const { analyzer, knowledge, history } = loadExtension();
const entries = knowledge.normalizeKnowledge(loadKnowledgeFile());
const records = COMPLETED.map((item) => history.anonymizeCompletedTicket(item)).filter(Boolean);

for (const item of TICKETS) {
  const result = analyzer.analyseTicket(item.data, { knowledge: entries, history: records });
  const status = result.topic.id === item.topic ? 'PASS' : 'FAIL';
  console.log(`\n${status} ${item.data.incidentReference} ${item.name}`);
  console.log(`  Product: ${result.product} · Module: ${result.module.label}`);
  console.log(`  Topic:   ${result.topic.id} (${result.topic.resourceMode})`);
  console.log(`  Query:   ${result.query}`);
  console.log(`  Steps:   ${result.topic.steps.length}`);
  console.log(`  Knowledge: ${result.knowledge.map((entry) => entry.id).join(', ') || 'none'}`);
  console.log(`  Similar completed: ${result.similarTickets.map((entry) => entry.reference).join(', ') || 'none'}`);
  if (process.argv.includes('--reply')) console.log(`  Reply:\n${result.reply.replace(/^/gm, '    ')}`);
}
