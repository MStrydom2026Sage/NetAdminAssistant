const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadExtension, loadKnowledgeFile, EXTENSION_DIR } = require('./load-analyzer');

const { analyzer: A, knowledge: K, sources: S, context } = loadExtension();
const ENTRIES = K.normalizeKnowledge(loadKnowledgeFile());

function ticket(question, extra = {}) {
  return Object.assign({
    incidentReference: 'WF500001',
    customer: { contactName: 'Thandi' },
    rawLoggedText: `${extra.productLine ? `Product: ${extra.productLine}\n` : ''}How would you best describe this query?: ${question}`
  }, extra.ticket || {});
}

const urls = (result) => result.topic.links.map((link) => link.url);
const decoded = (result) => urls(result).map((url) => decodeURIComponent(url.replace(/\+/g, ' ')));
const peopleIds = new Set(ENTRIES.filter((entry) => entry.product === 'Sage 300 People').map((entry) => entry.id));
const cloudIds = new Set(ENTRIES.filter((entry) => entry.product === 'Sage 300 Cloud').map((entry) => entry.id));

test('Incident Type Group "Support-Sage 300 Cloud" scopes the whole analysis to Sage 300 Cloud', () => {
  const result = A.analyseTicket(ticket('Bank reconciliation is out of balance after the OFX statement import.', {
    ticket: { incidentTypeGroup: 'Support-Sage 300 Cloud' }
  }), { knowledge: ENTRIES });
  assert.equal(result.product, 'Sage 300 Cloud');
  assert.equal(result.productScope.source, 'incident-type-group');
  assert.equal(result.topic.id, 'bank-reconciliation');
  assert.ok(result.analysis.solution.facts.some((fact) => /Incident Type Group recorded on the ticket: Support-Sage 300 Cloud → Sage 300 Cloud/.test(fact)));
  assert.ok(result.knowledge.length);
  assert.ok(result.knowledge.every((entry) => !peopleIds.has(entry.id)));

  const kb = result.topic.links.find((link) => link.id === 'kb-us-search');
  assert.equal(kb.url, `https://us-kb.sage.com/portal/ss/?querytext=${result.query.replace(/ /g, '+')}&tabid=2&searchaliases=custom_us_threehundred;`);
  assert.equal(kb.productScoped, true);
  // People only ever appears as an exclusion, never as a search target.
  for (const url of decoded(result)) assert.doesNotMatch(url.replace(/-"Sage 300 People"/g, ''), /People/i);
  assert.match(result.reply, /in Sage 300 Cloud/);
});

test('Incident Type Group "Support-Sage 300 People" scopes the whole analysis to Sage 300 People', () => {
  const result = A.analyseTicket(ticket('Employee tax PAYE difference between March and April.', {
    ticket: { incidentTypeGroup: 'Support-Sage 300 People' }
  }), { knowledge: ENTRIES });
  assert.equal(result.product, 'Sage 300 People');
  assert.equal(result.topic.id, 'people-tax-paye');
  assert.ok(result.knowledge.length);
  assert.ok(result.knowledge.every((entry) => !cloudIds.has(entry.id)));
  // No Sage 300 People search alias is verified: nothing is pre-filled on the
  // Knowledgebase, and the Cloud alias and US Knowledgebase are never used.
  assert.ok(urls(result).every((url) => !/\/portal\/ss\/|custom_us_threehundred|us-kb\.sage\.com/.test(url)));
  const za = result.topic.links.find((link) => link.id === 'kb-za');
  assert.equal(za.url, 'https://za-kb.sage.com/');
  assert.equal(za.kind, 'home');
  assert.match(za.note, /No verified Sage 300 People search alias.*cannot be pre-filled/);
  for (const url of decoded(result).filter((value) => /google|communityhub/.test(value))) assert.match(url, /Sage 300 People/);
  for (const url of decoded(result)) assert.doesNotMatch(url, /Sage 300 Cloud|"Sage 300" -/);
});

test('Cloud-only guidance is never offered for a People group, and vice versa', () => {
  const people = A.analyseTicket(ticket('Bank reconciliation is out of balance after the OFX statement import.', {
    ticket: { incidentTypeGroup: 'Support-Sage 300 People' }
  }), { knowledge: ENTRIES });
  assert.notEqual(people.topic.id, 'bank-reconciliation');
  assert.equal(people.knowledge.length, 0);
  assert.doesNotMatch(people.analysis.solution.steps.join(' '), /Bank Services/);

  const cloud = A.analyseTicket(ticket('The MCS service will not start after the password was changed.', {
    ticket: { incidentTypeGroup: 'Support-Sage 300 Cloud' }
  }), { knowledge: ENTRIES });
  assert.notEqual(cloud.topic.id, 'people-mcs-password');
  assert.equal(cloud.knowledge.length, 0);
  assert.doesNotMatch(cloud.analysis.solution.steps.join(' ') + cloud.reply, /MCS credentials|Sage 300 People configuration/);
});

test('every rule is scoped to a product and product-neutral rules apply to both', () => {
  for (const rule of A.RULES) {
    assert.ok(Array.isArray(rule.products) && rule.products.length, `${rule.id} has no product scope`);
    for (const product of rule.products) assert.ok(A.PRODUCT_LABELS.includes(product));
  }
  for (const entry of ENTRIES) assert.ok(entry.product || entry.products.length, `${entry.id} has no product scope`);
});

test('a conflicting product mention keeps the group product, is flagged and gets no diagnosis', () => {
  const result = A.analyseTicket(ticket('Sage 300 People payslips report does not print.', {
    productLine: 'Sage 300 People',
    ticket: { incidentTypeGroup: 'Support-Sage 300 Cloud' }
  }), { knowledge: ENTRIES });
  assert.equal(result.product, 'Sage 300 Cloud');
  assert.deepEqual(Array.from(result.productScope.conflicts), ['Sage 300 People']);
  assert.equal(result.topic.id, 'generic');
  assert.equal(result.analysis.solution.hypotheses.length, 0);
  assert.equal(result.knowledge.length, 0);
  assert.ok(result.analysis.solution.facts.some((fact) => /Product contradiction: the ticket text mentions Sage 300 People, but the Incident Type Group is Sage 300 Cloud/.test(fact)));
  assert.match(result.analysis.solution.questions[0], /confirm whether .* is about Sage 300 Cloud or Sage 300 People/);
  assert.match(result.analysis.rootCause.content, /must be confirmed/);
  assert.match(result.reply, /Please confirm whether .* is about Sage 300 Cloud or Sage 300 People/);
  // searches stay on the group product; the keyword phrase carries no product
  assert.doesNotMatch(result.query, /Sage|People|Cloud/i);
  assert.ok(result.topic.links.some((link) => link.id === 'kb-us-search'));
  for (const url of decoded(result)) assert.doesNotMatch(url.replace(/-"Sage 300 People"/g, ''), /People/i);
});

test('a missing or unrecognised Incident Type Group is treated conservatively', () => {
  const missing = A.analyseTicket(ticket('Sage 300 bank reconciliation is out of balance after the statement import.'), { knowledge: ENTRIES });
  assert.equal(missing.product, 'Sage product not specified');
  assert.equal(missing.productScope.source, 'none');
  assert.equal(missing.topic.id, 'generic');
  assert.equal(missing.knowledge.length, 0);
  assert.ok(missing.analysis.solution.questions.some((question) => /Sage 300 Cloud or Sage 300 People/.test(question)));
  assert.ok(urls(missing).every((url) => !/\/portal\/ss\/|custom_/.test(url)));
  assert.ok(missing.topic.links.every((link) => link.productScoped === false));
  assert.ok(missing.topic.links.filter((link) => link.kind === 'home').every((link) => /Product not confirmed/.test(link.note)));

  const unrecognised = A.analyseTicket(ticket('Bank reconciliation is out of balance.', {
    productLine: 'Sage 300 Cloud',
    ticket: { incidentTypeGroup: 'Support-Sage Evolution' }
  }), { knowledge: ENTRIES });
  assert.equal(unrecognised.product, 'Sage product not specified');
  assert.equal(unrecognised.productScope.source, 'unrecognised-group');
  assert.ok(unrecognised.analysis.solution.facts.some((fact) => /“Support-Sage Evolution” is not recognised/.test(fact)));
  assert.ok(urls(unrecognised).every((url) => !/\/portal\/ss\//.test(url)));

  // Generic "Sage 300" wording and module names never imply Sage 300 Cloud.
  assert.equal(A.classifyProduct('Support-Sage 300'), '');
  assert.equal(A.classifyProduct('A/P invoice batch in Sage 300'), '');
  assert.equal(A.classifyProduct('Support-Sage 300 Cloud'), 'Sage 300 Cloud');
  assert.equal(A.classifyProduct('SUPPORT - SAGE 300 PEOPLE'), 'Sage 300 People');

  // With no group at all, the explicit Product field is the fallback.
  const fallback = A.analyseTicket(ticket('Bank reconciliation is out of balance.', { productLine: 'Sage 300 Cloud' }));
  assert.equal(fallback.product, 'Sage 300 Cloud');
  assert.equal(fallback.productScope.source, 'product-field');
});

test('the Incident Type Group is read from the logged webform text as well', () => {
  const result = A.analyseTicket({
    rawLoggedText: 'Incident Type Group: Support-Sage 300 People\nHow would you best describe this query?: ESS mobile app registration QR code is invalid.'
  });
  assert.equal(result.fields.incidentTypeGroup, 'Support-Sage 300 People');
  assert.equal(result.fields.question, 'ESS mobile app registration QR code is invalid.');
  assert.equal(result.product, 'Sage 300 People');
  assert.equal(result.topic.id, 'people-ess-mobile');
});

test('the search phrase is a sanitised issue-keyword phrase from the recorded question only', () => {
  const result = A.analyseTicket({
    incidentReference: 'WF500002',
    incidentTypeGroup: 'Support-Sage 300 Cloud',
    customer: { contactName: 'Thandi Mokoena' },
    subject: 'Queue · Home · Reports 2026',
    description: 'Navigation Home My queue Completed tickets',
    question: 'Thandi says 25 users get "Database error" (error 49153) when logging on to Sage 300 Cloud at site code ZA12345, see WF123456 or thandi@example.com'
  });
  assert.equal(result.query, 'Database error 49153');
  assert.ok(result.topic.links.some((link) => link.url.includes('querytext=Database+error+49153&tabid=2&searchaliases=custom_us_threehundred;')));

  const plain = A.buildSearchPhrase('The client gets an error when the user logs on to Sage 300 Cloud', { exclude: ['Thandi'] });
  assert.equal(plain, 'error when user logs on');
  assert.equal(A.buildSearchPhrase('Error code 0x80004005 when printing 12 invoices for 2026'), 'Error code 0x80004005 when printing invoices');
  assert.doesNotMatch(A.buildSearchPhrase('Bill of material for batch production of 93 loaves is wrong'), /93/);
  assert.equal(A.buildSearchPhrase('Good day, please assist. Sage 300 People: leave balance incorrect. Thanks, Thandi', { exclude: ['Thandi'] }), 'leave balance incorrect');
  assert.deepEqual(Array.from(A.extractIssueCodes('25 users on 2026-04-01 get error 49153 and 0x80004005')), ['49153', '0x80004005']);
});

test('no link uses the retired endpoint or a constructed article URL, for any product', () => {
  for (const group of ['Support-Sage 300 Cloud', 'Support-Sage 300 People', '']) {
    const result = A.analyseTicket(ticket('Error when user logs on', { ticket: { incidentTypeGroup: group } }));
    for (const url of urls(result)) {
      assert.doesNotMatch(url, /viewsearch\.jsp|viewsolution\.jsp|solutionid/);
      const host = new URL(url).hostname;
      assert.ok(['za-kb.sage.com', 'us-kb.sage.com', 'communityhub.sage.com', 'www.google.com'].includes(host), host);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(S.KB_SEARCH_ROUTES)), [{
    sourceId: 'kb-us', name: 'Sage Knowledgebase (US)', host: 'us-kb.sage.com', product: 'Sage 300 Cloud', alias: 'custom_us_threehundred;'
  }]);
  assert.equal(S.kbSearchRoutes('Sage 300 People').length, 0);
  assert.equal(S.buildKbSearchUrl(S.KB_SEARCH_ROUTES[0], 'Access Violation'),
    'https://us-kb.sage.com/portal/ss/?querytext=Access+Violation&tabid=2&searchaliases=custom_us_threehundred;');
});

test('live results naming another product are dropped and unvalidated ones are not product advice', () => {
  const results = [
    { title: 'Database error when logging on to Sage 300 People', snippet: 'Payroll login database error', url: 'https://za-kb.sage.com/a' },
    { title: 'Database error when logging on', snippet: 'Check the database login', url: 'https://communityhub.sage.com/za/sage-300-people/f/1' },
    { title: 'Database error when logging on to Sage 300 Cloud', snippet: 'Check the database login', url: 'https://za-kb.sage.com/b' },
    { title: 'Database error at logon', snippet: 'Check the database login', url: 'https://communityhub.sage.com/t/2' }
  ];
  const terms = A.normalizeTerms('Database error logging');
  const cloud = S.rankResults(results, { terms, product: 'Sage 300 Cloud' });
  assert.deepEqual(cloud.map((item) => item.url), ['https://za-kb.sage.com/b', 'https://communityhub.sage.com/t/2']);
  assert.deepEqual(cloud.map((item) => item.productVerified), [true, false]);
  const people = S.rankResults(results, { terms, product: 'Sage 300 People' });
  assert.deepEqual(people.map((item) => item.url), ['https://za-kb.sage.com/a', 'https://communityhub.sage.com/za/sage-300-people/f/1', 'https://communityhub.sage.com/t/2']);
  assert.ok(S.rankResults(results, { terms, product: 'Sage product not specified' }).every((item) => !item.productVerified));

  // The analysis applies the same filter, so a mis-flagged result never reaches the reply.
  const base = A.analyseTicket(ticket('Database error when logging on.', { ticket: { incidentTypeGroup: 'Support-Sage 300 Cloud' } }));
  const applied = A.applySources(base, { enabled: true, unavailable: [], results: [
    Object.assign({}, results[0], { productVerified: true, source: 'Sage Knowledgebase (ZA)' }),
    Object.assign({}, results[3], { productVerified: false, source: 'Sage Community Hub' })
  ] });
  const retrieved = applied.sourcedGuidance.filter((item) => item.kind === 'retrieved');
  assert.deepEqual(Array.from(retrieved, (item) => item.url), ['https://communityhub.sage.com/t/2']);
  assert.doesNotMatch(applied.reply, /Sage 300 People|communityhub\.sage\.com\/t\/2/);
  assert.match(applied.reply, /No official Sage article could be matched/);
});

test('retrieval uses only verified product routes and rejects 404, sign-in and non-article pages', async () => {
  const calls = [];
  const pages = {
    'us-kb.sage.com': '<html><body><a href="/portal/ss/?querytext=x">Database error search page</a>'
      + '<a href="/portal/app/portlets/results/viewsolution.jsp?solutionid=260422192647140&amp;page=1&amp;position=0&amp;q=Database%20error">Database error when logging on</a><p>Check the database login.</p>'
      + '<a href="/portal/app/portlets/results/viewsolution.jsp?solutionid=241118113535307">Database error logging on to Sage 300 People</a></body></html>',
    'communityhub.sage.com': '<html><head><title>Sign in</title></head><body><form><input type="password"></form></body></html>'
  };
  const originalFetch = context.fetch;
  context.fetch = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => pages[new URL(url).hostname] || 'HTTP Status 404 - Not Found' };
  };
  try {
    const cloud = await S.fetchSageSources({ query: 'Database error', terms: A.normalizeTerms('Database error logging'), product: 'Sage 300 Cloud' });
    assert.deepEqual(calls, [
      'https://us-kb.sage.com/portal/ss/?querytext=Database+error&tabid=2&searchaliases=custom_us_threehundred;',
      'https://communityhub.sage.com/search?q=Sage%20300%20Cloud%20Database%20error'
    ]);
    assert.equal(cloud.results.length, 1);
    assert.equal(cloud.results[0].articleId, '260422192647140');
    assert.equal(cloud.results[0].productVerified, true);
    const reasons = Object.fromEntries(cloud.unavailable.map((item) => [item.name, item.reason]));
    assert.match(reasons['Sage Knowledgebase (ZA)'], /no verified Sage 300 Cloud search alias/);
    assert.match(reasons['Sage Community Hub'], /sign-in/);

    calls.length = 0;
    const people = await S.fetchSageSources({ query: 'Database error', terms: ['database', 'error'], product: 'Sage 300 People' });
    assert.deepEqual(calls, ['https://communityhub.sage.com/search?q=Sage%20300%20People%20Database%20error']);
    assert.equal(people.results.length, 0);
    assert.ok(people.unavailable.filter((item) => /Knowledgebase/.test(item.name)).every((item) => /no verified Sage 300 People search alias/.test(item.reason)));
  } finally {
    context.fetch = originalFetch;
  }
  assert.equal(S.classifyPage('<html><head><title>Sage ID - Sign in</title></head></html>'), 'sign-in');
  assert.equal(S.classifyPage('<html><body>HTTP Status 404 – Not Found</body></html>'), 'error');
  assert.equal(S.isKbArticleUrl('https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=241118113535307&page=1'), true);
  assert.equal(S.isKbArticleUrl('https://za-kb.sage.com/portal/ss/?querytext=x'), false);
});

const FRENCH_QUESTION = "Have language French installed but when printing posting errors report it doesn't print the posting errors if the user is linked to the language french. if the user is linked to the language English then it prints. these are standard reports. Tried AR Invoices, Receipts, AP Invoices, Payments GL - all posting journal error reports are all printing";

test('French-language report ticket: Cloud group pre-fills the Cloud Knowledgebase search with a concise issue summary', () => {
  // Group and question as they appear in the page text of a NetAdmin ticket.
  const result = A.analyseTicket({
    incidentReference: 'WF600001',
    rawLoggedText: `Incident type group\tSupport-Sage 300 Cloud\nHow would you best describe this query?: ${FRENCH_QUESTION}`
  });
  assert.equal(result.product, 'Sage 300 Cloud');
  assert.equal(result.productScope.source, 'incident-type-group');
  assert.equal(result.topic.id, 'report-language');
  assert.equal(result.query, 'language French installed printing posting errors report');
  assert.ok(result.query.split(' ').length <= 7);
  const urls = Array.from(result.topic.links, (link) => link.url);
  assert.equal(urls[0], 'https://us-kb.sage.com/portal/ss/?querytext=language+French+installed+printing+posting+errors+report&tabid=2&searchaliases=custom_us_threehundred;');
  assert.ok(urls.includes('https://us-kb.sage.com/portal/ss/?tabid=3&searchaliases=custom_us_threehundred'));
  assert.ok(!urls.includes('https://us-kb.sage.com/'));
  assert.match(result.analysis.solution.steps.join('\n'), /FRA folder|French reports/);
});

test('a readable group in the page text wins over an id read from a hidden control', () => {
  const scope = A.resolveProduct({ incidentTypeGroup: '12', rawLoggedText: 'Incident Type Group\nSupport-Sage 300 People\nPriority\nHigh' });
  assert.equal(scope.product, 'Sage 300 People');
  assert.equal(scope.incidentTypeGroup, 'Support-Sage 300 People');
});

test('without an Incident Type Group the panel says which product checks are withheld and offers no Cloud search', () => {
  const result = A.analyseTicket({ incidentReference: 'WF600002', question: FRENCH_QUESTION });
  assert.equal(result.topic.id, 'generic');
  assert.match(result.analysis.rootCause.content, /no Incident Type Group was read/);
  assert.ok(result.topic.links.every((link) => !/searchaliases=/.test(link.url)));
});

test('long descriptions are reduced to issue keywords; short ones keep their wording', () => {
  assert.equal(A.buildSearchPhrase(FRENCH_QUESTION), 'language French installed printing posting errors report');
  assert.equal(A.buildSearchPhrase('Error when user logs on'), 'Error when user logs on');
});

test('the side panel loads the Knowledgebase routes before the analyzer', () => {
  const html = fs.readFileSync(path.join(EXTENSION_DIR, 'html', 'sidepanel.html'), 'utf8');
  assert.ok(html.indexOf('../sage-sources.js') > -1 && html.indexOf('../sage-sources.js') < html.indexOf('../analyze.js'));
});
