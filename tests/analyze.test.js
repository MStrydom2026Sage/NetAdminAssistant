const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./load-analyzer');
const { TICKETS, QUEUE, COMPLETED } = require('./fixtures/tickets');

const { analyzer: A, sources: S } = loadExtension();

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

test('the webform question is authoritative over unrelated codes and metadata', () => {
  const data = TICKETS.at(-1).data;
  const result = A.analyseTicket(data, { knowledge: require('./load-analyzer').loadKnowledgeFile().entries });
  assert.match(result.fields.question, /Bank reconciliation is out of balance/);
  assert.equal(result.questionSource, 'How would you best describe this query?');
  assert.match(result.summary, /Bank reconciliation is out of balance/);
  assert.equal(result.topic.id, 'bank-reconciliation');
  assert.equal(result.module.id, 'bank');
  assert.ok(!result.knowledge.some((entry) => entry.id === 'kb-gl-control-account'));
  assert.doesNotMatch(result.analysis.rootCause.content + result.reply, /control account|A\/P|A\/R/);
  assert.doesNotMatch(result.query, /900987|2026/);
});

test('webform answer survives same-line and multiline question markup', () => {
  const sameLine = A.extractFields('How would you best describe this query? Bank reconciliation out of balance.\nProduct: Sage 300 Cloud');
  assert.equal(sameLine.question, 'Bank reconciliation out of balance.');
  const multiline = A.extractFields('How would you best describe this query?:\nCannot reconcile bank.\nAfter importing OFX.\nSummary of the query: G/L error 900987');
  assert.equal(multiline.question, 'Cannot reconcile bank. After importing OFX.');
  assert.equal(multiline.summary, 'G/L error 900987');
});

test('an unrelated error code alone cannot trigger a diagnosis or historical resolution', () => {
  const data = { rawLoggedText: 'How would you best describe this query?: The application freezes when saving a new record.\nError message: 900987',
    subject: 'G/L control account 900987', product: 'Sage 300 Cloud' };
  const history = [{ summary: 'G/L control account 900987', terms: ['control', 'account'], errorCodes: ['900987'], topicId: 'gl-control-account', product: 'Sage 300 Cloud', resolution: 'Change A/P control account.' }];
  const result = A.analyseTicket(data, { knowledge: require('./load-analyzer').loadKnowledgeFile().entries });
  assert.equal(result.topic.id, 'generic');
  assert.equal(result.module.id, 'unknown');
  assert.equal(result.knowledge.length, 0);
  // Past tickets are still stored, but they are no longer part of the analysis.
  assert.equal(result.similarTickets, undefined);
  assert.equal(A.similarTickets(data, history).length, 0);
  assert.match(result.analysis.rootCause.content, /does not provide enough evidence|cannot identify/i);
  assert.match(result.reply, /application freezes/i);
});

test('missing webform answer falls back to ticket description, not a stale title', () => {
  const result = A.analyseTicket({ subject: 'G/L control account error 900987',
    description: 'The bank reconciliation is out of balance after statement import.', product: 'Sage 300 Cloud' });
  assert.equal(result.topic.id, 'bank-reconciliation');
  assert.equal(result.questionSource, 'Ticket description');
  assert.match(result.querySummary, /bank reconciliation/i);
});

test('conflicting product and vague control-account wording do not assert a module diagnosis', () => {
  const people = A.analyseTicket({ product: 'Sage 300 People',
    rawLoggedText: 'How would you best describe this query?: Bank reconciliation is out of balance after statement import.' });
  assert.equal(people.topic.id, 'generic');
  assert.equal(people.module.id, 'unknown');
  assert.match(people.analysis.rootCause.content, /may conflict/i);
  assert.doesNotMatch(people.analysis.solution.steps.join(' '), /bank services|G\/L control account/i);
  const vague = A.analyseTicket({ product: 'Sage 300 Cloud',
    rawLoggedText: 'How would you best describe this query?: G/L control account balance differs.' });
  assert.equal(vague.topic.id, 'generic');
  assert.doesNotMatch(vague.reply, /Post the transaction through the A\/P or A\/R/i);
});

test('missing summary is explicit', () => {
  assert.match(A.analyseTicket(TICKETS[7].data).summary, /No “Summary of the query”/);
});

test('site codes and greetings are removed from the search phrase', () => {
  assert.doesNotMatch(A.buildSearchPhrase('Good day please assist [U12345] day end error WF123456'), /U12345|good day|please assist|WF123456/i);
  assert.ok(A.buildSearchPhrase('x'.repeat(150)).length <= 70);
  assert.equal(A.stripSiteCodes('Site Code: ZA12345 bank reconciliation'), 'bank reconciliation');
  assert.match(A.buildSearchPhrase('Bank reconciliation is out of balance and cannot post'), /out of balance.*cannot post/i);
  assert.doesNotMatch(A.buildSearchPhrase('Bank reconciliation jane@example.com +27 82 123 4567 https://example.com/case'), /jane|example|123|case/i);
});

test('work already attempted is not proposed again', () => {
  const result = A.analyseTicket(TICKETS[1].data);
  assert.deepEqual(Array.from(result.topic.alreadyTriedLabels), ['tax tables imported', 'Company Rule recalculation']);
  assert.ok(result.analysis.solution.facts.some((fact) => /^Already reported as done/.test(fact)));
  assert.ok(!result.topic.steps.some((step) => /tax tables|Company Rule recalculation/i.test(step)));
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
  const matches = analyzer.similarTickets(TICKETS[4].data, records);
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].topicId, 'bank-reconciliation');
  assert.equal(matches[0].confidence, 'historical context only');
  assert.match(matches[0].resolution, /duplicated statement lines/i);
  assert.equal(analyzer.similarTickets(TICKETS[9].data, records).length, 0);
});

test('stored history never reaches the analysis, the reply or the panel payload', () => {
  const { history, analyzer } = loadExtension();
  const records = COMPLETED.map((item) => history.anonymizeCompletedTicket(item)).filter(Boolean);
  const withHistory = analyzer.analyseTicket(TICKETS[4].data, { history: records });
  const withoutHistory = analyzer.analyseTicket(TICKETS[4].data);
  assert.equal(withHistory.similarTickets, undefined);
  assert.equal(JSON.stringify(withHistory), JSON.stringify(withoutHistory));
  assert.doesNotMatch(withHistory.reply, /duplicated statement lines/i);
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

/* ------------------------------------------------------------------ *
 * v0.6.1 follow-up: ticket-specific steps and working Sage links
 * ------------------------------------------------------------------ */

function query(text, extra = {}) {
  return Object.assign({
    incidentReference: 'WF300001',
    customer: { contactName: 'Thandi' },
    rawLoggedText: `Product: ${extra.product || 'Sage 300 Cloud'}\nHow would you best describe this query?: ${text}`
  }, extra.ticket || {});
}

test('a Sage 300 Cloud French language installation query gets installation-specific checks', () => {
  const result = A.analyseTicket(query('The client wants to install the French language on Sage 300 Cloud.'));
  assert.equal(result.topic.id, 'language-installation');
  const steps = result.analysis.solution.steps.join(' ');
  assert.match(steps, /licen[cs]e/i);
  assert.match(steps, /language/i);
  assert.doesNotMatch(steps, /Reproduce the issue in a safe test environment|Collect screenshots or logs|Check the Sage documentation for the affected area/i);
});

test('a printing/posting error and a report that does not print get printing-specific checks', () => {
  const printing = A.analyseTicket(query('The A/R customer statement report does not print, nothing happens when clicking print.'));
  assert.equal(printing.topic.id, 'printing-output');
  assert.match(printing.analysis.solution.steps.join(' '), /Print Destination/i);
  assert.match(printing.analysis.solution.steps.join(' '), /different printer/i);

  const posting = A.analyseTicket(query('Cannot post the A/P invoice batch, posting error on the batch.'));
  assert.equal(posting.topic.id, 'posting-errors');
  assert.match(posting.analysis.solution.steps.join(' '), /posting journal|posting error report/i);
  assert.notDeepEqual(Array.from(printing.analysis.solution.steps), Array.from(posting.analysis.solution.steps));
});

test('ticket facts, rules-based hypotheses and questions are kept apart', () => {
  const result = A.analyseTicket(query('The A/R customer statement report does not print.'));
  const { facts, hypotheses, questions, sufficiency } = result.analysis.solution;
  assert.equal(sufficiency, 'rules');
  assert.ok(facts.some((fact) => /How would you best describe this query\?: The A\/R customer statement report does not print/.test(fact)));
  assert.ok(hypotheses.length);
  for (const item of hypotheses) assert.match(item.source, /^Local rule: /);
  assert.ok(questions.every((question) => /^(Ask|The ticket)/.test(question)));
});

test('an unclassified query asks precise questions instead of boilerplate', () => {
  const result = A.analyseTicket(query('The screen freezes after the weekend.'));
  assert.equal(result.topic.id, 'generic');
  assert.equal(result.analysis.solution.sufficiency, 'questions');
  assert.equal(result.analysis.solution.hypotheses.length, 0);
  assert.ok(result.analysis.solution.questions.some((question) => /screen freezes after the weekend/i.test(question)));
  assert.doesNotMatch(result.analysis.solution.steps.join(' '), /Reproduce the issue in a safe test environment|Collect screenshots or logs|Check the Sage documentation for the affected area/i);
  assert.match(result.reply, /we do not yet have a validated step/i);
  assert.match(result.reply, /Kind regards$/);
});

test('retrieved Sage results are cited, never turned into invented instructions', () => {
  const base = A.analyseTicket(query('The A/R customer statement report does not print.'));
  const sources = {
    enabled: true,
    results: [
      { title: 'Report does not print from Sage 300', url: 'https://za-kb.sage.com/article/12345', snippet: 'Check the print destination.', source: 'Sage Knowledgebase (ZA)', articleId: '12345', productVerified: true },
      { title: 'Statement printing tips', url: 'https://communityhub.sage.com/t/9', snippet: 'Printer settings.', source: 'Sage Community Hub' }
    ],
    unavailable: [{ name: 'Sage Community Hub', reason: 'the page returned HTTP 404' }]
  };
  const applied = A.applySources(base, sources);
  const cited = applied.sourcedGuidance.filter((item) => item.kind === 'retrieved');
  assert.equal(cited.length, 2);
  // a result whose product could not be validated is labelled and kept out of the reply
  assert.equal(cited[1].productVerified, false);
  assert.match(cited[1].detail, /Product not confirmed for Sage 300 Cloud/);
  assert.doesNotMatch(applied.reply, /Statement printing tips/);
  assert.equal(cited[0].url, 'https://za-kb.sage.com/article/12345');
  assert.equal(cited[0].steps.length, 0);
  assert.match(cited[0].detail, /confirm its instructions/i);
  assert.match(applied.reply, /Report does not print from Sage 300 \(Sage Knowledgebase \(ZA\)\): https:\/\/za-kb\.sage\.com\/article\/12345/);
  assert.match(applied.sourceState.unavailable[0].reason, /HTTP 404/);
  // idempotent, so a refresh cannot double up the reply
  assert.equal(A.applySources(applied, sources).reply, applied.reply);
});

test('irrelevant or missing source results never become guidance', () => {
  const base = A.analyseTicket(query('The A/R customer statement report does not print.'));
  const disabled = A.applySources(base, { enabled: false, results: [], unavailable: [] });
  assert.equal(disabled.sourcedGuidance.filter((item) => item.kind === 'retrieved').length, 0);
  assert.equal(disabled.reply, base.reply);
  assert.match(disabled.sourceState.message, /switched off/i);

  const unavailable = A.applySources(base, { enabled: true, results: [], unavailable: [{ name: 'Sage Knowledgebase (ZA)', reason: 'the Knowledgebase search endpoint was retired and returns HTTP 404' }] });
  assert.equal(unavailable.sourcedGuidance.filter((item) => item.kind === 'retrieved').length, 0);
  assert.match(unavailable.reply, /No official Sage article could be matched/i);
  assert.match(unavailable.sourceState.message, /HTTP 404/);

  // A result that only shares a product name is filtered out before it is offered.
  const irrelevant = S.rankResults([{ title: 'Sage 300 Cloud year end checklist', snippet: 'Year end steps', url: 'https://za-kb.sage.com/z' }],
    { terms: A.normalizeTerms('A/R customer statement report does not print'), errorCodes: [] });
  assert.equal(irrelevant.length, 0);
  assert.equal(A.applySources(base, { enabled: true, results: irrelevant, unavailable: [] }).sourcedGuidance.filter((item) => item.kind === 'retrieved').length, 0);
});

test('no Sage link uses the retired knowledgebase search endpoint', () => {
  const result = A.analyseTicket(query('The A/R customer statement report does not print.'), { knowledge: require('./load-analyzer').loadKnowledgeFile().entries });
  const urls = result.topic.links.map((link) => link.url);
  for (const url of urls) assert.doesNotMatch(url, /viewsearch\.jsp/);
  // Knowledgebase searches carry only the issue keywords; the Google
  // site: search (which returned no results) is no longer offered.
  assert.ok(urls.some((url) => /^https:\/\/za-kb\.sage\.com\/portal\/ss\/\?querytext=A%2FR\+statement/.test(url)));
  assert.ok(urls.every((url) => !/site%3A|Sage\+300/.test(url)));
  // the ZA search is filtered by the verified Sage 300 Cloud alias
  const kb = result.topic.links.find((link) => link.id === 'kb-za-search');
  assert.equal(kb.productScoped, true);
  assert.match(kb.url, /&searchaliases=custom_za_threehundred$/);
  assert.doesNotMatch(JSON.stringify(result), /viewsearch\.jsp/);
});
