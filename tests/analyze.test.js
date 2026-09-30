const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./load-analyzer');
const { TICKETS, QUEUE } = require('./fixtures/tickets');
const A = loadAnalyzer();

for (const fixture of TICKETS) {
  test(fixture.name, () => {
    const result = A.analyseTicket(fixture.data);
    assert.equal(result.topic.id, fixture.topic);
    assert.equal(result.topic.resourceMode, fixture.mode);
    if (fixture.product) assert.equal(result.product, fixture.product);
    assert.ok(result.topic.steps.length);
    assert.match(result.reply, /^Good day Thandi/);
    assert.match(result.reply, /Kind regards$/);
    assert.ok(result.reply.includes(fixture.data.incidentReference));
    assert.equal(JSON.stringify(result), JSON.stringify(A.analyseTicket(structuredClone(fixture.data))));
    for (const link of result.topic.links) assert.match(link.url, /^https:\/\/(?:help|community)\.sage\.com\/$/);
    assert.doesNotMatch(result.query, /U60804|WF1000/i);
  });
}
test('attempted work is not proposed again', () => {
  const result = A.analyseTicket(TICKETS[1].data);
  assert.deepEqual(Array.from(result.topic.alreadyTriedLabels), ['tax tables imported', 'company rule / tax recalculation']);
  assert.match(result.topic.steps[0], /^Do not repeat/);
  assert.ok(!result.topic.steps.slice(1).some(step => /tax tables were imported|Company Rule recalculation/i.test(step)));
  assert.match(result.reply, /We will not repeat those checks/);
});
test('missing summary is explicit and attachments remain local evidence', () => {
  assert.match(A.analyseTicket(TICKETS[7].data).summary, /No “Summary of the query”/);
  const item = { ...TICKETS[0].data, attachments: [{ name: 'invoice.pdf', url: 'https://other.example/file' }] };
  assert.match(A.analyseTicket(item).analysis.rootCause.evidence[0], /invoice.pdf/);
  assert.doesNotMatch(JSON.stringify(A.analyseTicket(item)), /other\.example/);
});
test('queue and similar tickets', () => {
  const ranked = A.rankQueue(QUEUE).map(t => t.incidentReference);
  assert.equal(ranked[0], 'WF200002');
  assert.ok(ranked.indexOf('WF200003') < ranked.indexOf('WF200001'));
  assert.equal(A.similarTickets(TICKETS[0].data, [TICKETS[0].data, { ...TICKETS[0].data }, TICKETS[1].data]).length, 1);
});
test('search phrase removes codes', () => {
  assert.doesNotMatch(A.searchPhrase('Good day please assist [U12345] day end error'), /U12345|good day|please assist/i);
  assert.ok(A.searchPhrase('x'.repeat(150)).length <= 70);
});
test('scoped chat rejects unrelated requests', () => {
  assert.match(A.chat('Write a poem about the sea'), /only help with Sage and IT support/i);
  assert.match(A.chat('Write a poem about Sage'), /only help with Sage and IT support/i);
  assert.match(A.chat('How to reconcile bank?', TICKETS[4].data), /Bank reconciliation/);
  assert.match(A.chat('How to reconcile bank?', TICKETS[0].data), /Bank reconciliation/);
  assert.match(A.chat('reply to customer', TICKETS[0].data), /Kind regards/);
  assert.equal(A.chat('How to reconcile bank?', TICKETS[4].data), A.chat('How to reconcile bank?', TICKETS[4].data));
});
