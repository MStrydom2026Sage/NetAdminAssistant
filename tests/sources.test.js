const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./load-analyzer');
const { KB_HTML, COMMUNITY_HTML } = require('./fixtures/source-pages');

const { sources: S, analyzer: A } = loadExtension();

test('knowledgebase results are parsed from a static page', () => {
  const results = S.parseResults(KB_HTML, 'kb-za');
  assert.ok(results.length >= 2);
  assert.equal(results[0].title, 'Bank reconciliation out of balance after statement import');
  assert.equal(results[0].url, 'https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=221045');
  assert.equal(results[0].articleId, '221045');
  assert.match(results[0].snippet, /Duplicated statement entries/);
});

test('results from other domains are discarded', () => {
  const results = S.parseResults(KB_HTML, 'kb-za');
  assert.ok(!results.some((result) => /untrusted\.example\.com/.test(result.url)));
  assert.equal(S.safeUrl('javascript:alert(1)', 'za-kb.sage.com'), '');
  assert.equal(S.safeUrl('http://za-kb.sage.com/x', 'za-kb.sage.com'), '');
});

test('community threads are parsed', () => {
  const results = S.parseResults(COMMUNITY_HTML, 'community');
  assert.equal(results.length, 2);
  assert.match(results[0].url, /^https:\/\/communityhub\.sage\.com\//);
  assert.equal(results[0].source, 'Sage Community Hub');
});

test('results are ranked by term and error-code overlap', () => {
  const parsed = S.parseResults(KB_HTML, 'kb-za').concat(S.parseResults(COMMUNITY_HTML, 'community'));
  const ranked = S.rankResults(parsed, {
    terms: A.normalizeTerms('bank reconciliation out of balance after ofx statement import'),
    errorCodes: [],
    moduleLabel: 'Bank Services',
    product: 'Sage 300 Cloud'
  });
  assert.ok(ranked.length >= 2);
  assert.match(ranked[0].title, /Bank reconciliation/i);
  assert.ok(ranked.length <= S.MAX_RESULTS);
  assert.deepEqual(JSON.parse(JSON.stringify(ranked)), JSON.parse(JSON.stringify(S.rankResults(parsed, {
    terms: A.normalizeTerms('bank reconciliation out of balance after ofx statement import'),
    errorCodes: [],
    moduleLabel: 'Bank Services',
    product: 'Sage 300 Cloud'
  }))));
});

test('unrelated pages produce no ranked results rather than invented ones', () => {
  const ranked = S.rankResults(S.parseResults(KB_HTML, 'kb-za'), { terms: ['zzzzz'], errorCodes: [] });
  assert.equal(ranked.length, 0);
});

test('an incidental error code or product name cannot promote an unrelated Sage result', () => {
  const ranked = S.rankResults([
    { title: 'G/L control account 900987 2026 for Sage 300 Cloud', snippet: 'A/P A/R vendor posting', url: 'https://za-kb.sage.com/x' },
    { title: 'Bank reconciliation out of balance after statement import', snippet: 'Compare unmatched lines', url: 'https://za-kb.sage.com/y' }
  ], {
    terms: A.normalizeTerms('Bank reconciliation out of balance after statement import'),
    errorCodes: ['900987', '2026'],
    product: 'Sage 300 Cloud',
    moduleLabel: 'General Ledger'
  });
  assert.equal(ranked.length, 1);
  assert.match(ranked[0].title, /Bank reconciliation/);
});

test('only official Sage hosts are configured for retrieval', () => {
  assert.deepEqual(Array.from(S.ALLOWED_HOSTS), ['za-kb.sage.com', 'us-kb.sage.com', 'communityhub.sage.com']);
  assert.ok(S.SOURCES.every((source) => source.search.startsWith('https://')));
  assert.ok(!S.SOURCES.some((source) => /google/i.test(source.host)));
});

test('HTML entities are decoded once, never twice', () => {
  const html = '<a href="/portal/x?a=1&amp;b=2">Bank reconciliation &amp;lt;tag&amp;gt; report</a>';
  const results = S.parseResults(html, 'kb-za');
  assert.equal(results[0].url, 'https://za-kb.sage.com/portal/x?a=1&b=2');
  assert.equal(results[0].title, 'Bank reconciliation &lt;tag&gt; report');
});
