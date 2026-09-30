const { loadAnalyzer } = require('./load-analyzer');
const { TICKETS } = require('./fixtures/tickets');
const A = loadAnalyzer();
for (const item of TICKETS) {
  const r = A.analyseTicket(item.data);
  console.log(`\n${r.topic.id === item.topic ? 'PASS' : 'FAIL'} ${item.data.incidentReference} ${item.name}`);
  console.log(`  Product: ${r.product}\n  Topic: ${r.topic.id} (${r.topic.resourceMode})\n  Resource: ${r.topic.links[0].url}\n  Query: ${r.query}`);
  if (process.argv.includes('--reply')) console.log(`  Reply:\n${r.reply.replace(/^/gm, '    ')}`);
}
