const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./load-analyzer');
const { TICKETS, QUEUE, COMPLETED } = require('./fixtures/tickets');

const { analyzer: A } = loadExtension();

for (const fixture of TICKETS) {
  test(`classifies: ${fixture.name}`, () => {
    const result = A.analyseTicket(fixture.data);
    assert.equal(result.topic.id, fixture.topic);
    assert.equal(result.topic.resourceMode, fixture.mode);
    if (fixture.product) assert.equal(result.product, fixture.product);
    if (fixture.module) assert.equal(result.module.id, fixture.module);
    assert.ok(result.topic.steps.length, 'expected suggested steps');
    assert.match(result.reply, /^Good day Thandi/);
    assert.match(result.reply, /Kind regards$/);
    assert.ok(result.reply.includes(fixture.data.incidentReference));
    for (const link of result.topic.links) assert.match(link.url, /^https:\/\//);
    assert.doesNotMatch(result.query, /U60804|WF1000/i);
    // deterministic
    assert.equal(JSON.stringify(result), JSON.stringify(A.analyseTicket(structuredClone(fixture.data))));
  });
}

test('two different tickets produce materially different analysis', () => {
  const bom = A.analyseTicket(TICKETS[0].data);
  const paye = A.analyseTicket(TICKETS[1].data);
  assert.notEqual(bom.topic.id, paye.topic.id);
  assert.notEqual(bom.query, paye.query);
  assert.notDeepEqual(Array.from(bom.topic.steps), Array.from(paye.topic.steps));
  assert.notDeepEqual(Array.from(bom.topic.links).map((l) => l.url), Array.from(paye.topic.links).map((l) => l.url));
  assert.notEqual(bom.reply, paye.reply);
  assert.notEqual(bom.analysis.rootCause.content, paye.analysis.rootCause.content);
});

test('webform fields are extracted', () => {
  const fields = A.extractFields(TICKETS[1].data.rawLoggedText);
  assert.match(fields.summary, /Employee tax PAYE difference/);
  assert.match(fields.resolutionsAttempted, /generic tax tables/);
  assert.equal(fields.product, 'Sage 300 People');
});

test('missing summary is explicit', () => {
  assert.match(A.analyseTicket(TICKETS[7].data).summary, /No “Summary of the query”/);
});

test('site codes and greetings are removed from the search phrase', () => {
  assert.doesNotMatch(A.buildSearchPhrase('Good day please assist [U12345] day end error WF123456'), /U12345|good day|please assist|WF123456/i);
  assert.ok(A.buildSearchPhrase('x'.repeat(150)).length <= 70);
  assert.equal(A.stripSiteCodes('Site Code: ZA12345 bank reconciliation'), 'bank reconciliation');
});

test('work already attempted is not proposed again', () => {
  const result = A.analyseTicket(TICKETS[1].data);
  assert.deepEqual(Array.from(result.topic.alreadyTriedLabels), ['tax tables imported', 'Company Rule recalculation']);
  assert.match(result.topic.steps[0], /^Already reported as done/);
  assert.ok(!result.topic.steps.slice(1).some((step) => /tax tables|Company Rule recalculation/i.test(step)));
  assert.match(result.reply, /we will not ask you to repeat it/);
});

test('third-party products are detected and never assumed compatible', () => {
  const result = A.analyseTicket(TICKETS[2].data);
  assert.deepEqual(Array.from(result.thirdParty.products), ['Peresoft Cashbook']);
  assert.equal(result.thirdParty.compatibility, true);
  assert.ok(result.topic.steps.some((step) => /vendor compatibility matrix/i.test(step)));
});

test('attachments stay local evidence and external URLs are not echoed', () => {
  const data = Object.assign({}, TICKETS[0].data, { attachments: [{ name: 'invoice.pdf', url: 'https://other.example/file' }] });
  const result = A.analyseTicket(data);
  assert.ok(result.analysis.rootCause.evidence.some((item) => /invoice\.pdf/.test(item)));
  assert.doesNotMatch(JSON.stringify(result), /other\.example/);
});

test('queue ranking puts critical logged tickets first', () => {
  const ranked = Array.from(A.rankQueue(QUEUE)).map((item) => item.incidentReference);
  assert.equal(ranked[0], 'WF200002');
  assert.ok(ranked.indexOf('WF200003') < ranked.indexOf('WF200001'));
  assert.deepEqual(Array.from(ranked), Array.from(A.rankQueue(QUEUE)).map((item) => item.incidentReference));
});

test('completed tickets are anonymised and ranked as historical context', () => {
  const { history, analyzer } = loadExtension();
  const records = COMPLETED.map((item) => history.anonymizeCompletedTicket(item)).filter(Boolean);
  assert.equal(records.length, 3);
  for (const record of records) {
    assert.match(record.reference, /^past-[0-9a-f]+$/);
    assert.doesNotMatch(JSON.stringify(record), /WF900|ZA12345|example\.com|082 123/);
  }
  const result = analyzer.analyseTicket(TICKETS[4].data, { history: records });
  assert.ok(result.similarTickets.length >= 1);
  assert.equal(result.similarTickets[0].topicId, 'bank-reconciliation');
  assert.equal(result.similarTickets[0].confidence, 'historical context only');
  assert.match(result.similarTickets[0].resolution, /duplicated statement lines/i);
  const unrelated = analyzer.analyseTicket(TICKETS[9].data, { history: records });
  assert.equal(unrelated.similarTickets.length, 0);
});

test('history retention drops expired records and resets cleanly', () => {
  const { history } = loadExtension();
  const now = Date.now();
  const fresh = { reference: 'past-1', storedAt: now };
  const expired = { reference: 'past-2', storedAt: now - (history.MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000 };
  const merged = history.mergeRecords([fresh, expired], [], now);
  assert.deepEqual(Array.from(merged).map((item) => item.reference), ['past-1']);
  assert.ok(history.mergeRecords([], Array.from({ length: 500 }, (_, i) => ({ reference: `past-${i}`, storedAt: now })), now).length <= history.MAX_RECORDS);
});

test('offline chat stays in scope and is deterministic', () => {
  assert.match(A.chat('Write a poem about the sea'), /only help with Sage and IT support/i);
  assert.match(A.chat('Write a poem about Sage'), /only help with Sage and IT support/i);
  assert.match(A.chat('How do I reconcile the bank?', TICKETS[4].data), /Bank reconciliation/);
  assert.match(A.chat('How do I reconcile the bank?', TICKETS[0].data), /Bank reconciliation/);
  assert.match(A.chat('Draft a reply to the customer', TICKETS[0].data), /Kind regards/);
  assert.equal(A.chat('bank reconciliation help', TICKETS[4].data), A.chat('bank reconciliation help', TICKETS[4].data));
});

test('replies never contain raw HTML from the ticket', () => {
  const data = Object.assign({}, TICKETS[0].data, { customer: { contactName: '<img src=x onerror=alert(1)>' } });
  assert.doesNotMatch(A.analyseTicket(data).reply, /<img/);
});
