const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, loadKnowledgeFile } = require('./load-analyzer');
const { TICKETS } = require('./fixtures/tickets');

const { analyzer: A, knowledge: K } = loadExtension();
const ENTRIES = K.normalizeKnowledge(loadKnowledgeFile());

test('the curated knowledge file loads and normalises', () => {
  assert.ok(ENTRIES.length >= 5);
  for (const entry of ENTRIES) {
    assert.ok(entry.id && entry.title && entry.likelyCause);
    assert.ok(entry.steps.length);
    for (const link of entry.links) assert.match(link.url, /^https:\/\/(?:za-kb|us-kb)\.sage\.com\/|^https:\/\/communityhub\.sage\.com\//);
  }
});

test('invalid entries and unsafe links are dropped', () => {
  const normalized = K.normalizeKnowledge({
    entries: [
      null,
      { id: 'dup', title: 'A' },
      { id: 'dup', title: 'B' },
      { id: 'unsafe', links: [{ url: 'javascript:alert(1)' }, { url: 'http://insecure.example' }] }
    ]
  });
  assert.deepEqual(Array.from(normalized).map((entry) => entry.id), ['dup', 'unsafe']);
  assert.equal(normalized[1].links.length, 0);
});

test('knowledge entries are matched to the right ticket', () => {
  const bank = A.analyseTicket(TICKETS[4].data, { knowledge: ENTRIES });
  assert.equal(bank.knowledge[0].id, 'kb-bank-reconciliation-difference');
  const paye = A.analyseTicket(TICKETS[1].data, { knowledge: ENTRIES });
  assert.equal(paye.knowledge[0].id, 'kb-people-paye-difference');
});

test('knowledge from the wrong product is not promoted', () => {
  const generic = A.analyseTicket(TICKETS[6].data, { knowledge: ENTRIES });
  assert.equal(generic.knowledge.length, 0);
});

test('knowledge never replaces the rules engine result', () => {
  const withKnowledge = A.analyseTicket(TICKETS[4].data, { knowledge: ENTRIES });
  const withoutKnowledge = A.analyseTicket(TICKETS[4].data);
  assert.equal(withKnowledge.topic.id, withoutKnowledge.topic.id);
  assert.deepEqual(Array.from(withKnowledge.topic.steps), Array.from(withoutKnowledge.topic.steps));
  assert.equal(withKnowledge.reply, withoutKnowledge.reply);
});
