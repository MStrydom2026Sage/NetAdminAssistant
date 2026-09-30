(function (root) {
  'use strict';

  const RULES = [
    { id: 'external-third-party', label: 'Third-party compatibility', match: /\b(peresoft|third.party|compatib(?:le|ility)|integration)\b/i, mode: 'search',
      steps: ['Confirm the exact Sage and third-party product versions.', 'Check the vendor compatibility matrix and ask the vendor to confirm support before making changes.'] },
    { id: 'gl-vendor-customer-control', label: 'G/L control account', match: /\b(control account|general ledger|g\/l)\b.*\b(vendor|customer)\b|\b(vendor|customer)\b.*\b(control account|general ledger|g\/l)\b/i, mode: 'guide',
      steps: ['Confirm the account is configured as a subledger control account.', 'Use the appropriate A/P or A/R transaction rather than posting a vendor or customer directly in G/L.', 'Review the G/L and subledger balances before making corrections.'] },
    { id: 'bom-batch', label: 'Bill of materials / batch production', match: /\b(bill of material|bom|batch production)\b/i, mode: 'guide',
      steps: ['Confirm the bill of materials units and component quantities for the desired batch yield.', 'Set up a test assembly and verify component consumption and finished-goods quantity.', 'Review costing and post only after validating the test results.'] },
    { id: 'tax-tables', label: 'People tax / PAYE', match: /\b(paye|employee tax|tax table|tax difference|company rule)\b/i, mode: 'guide',
      steps: ['Confirm the applicable tax tables were imported for the payroll period.', 'Run Company Rule recalculation in a test environment and compare the tax result.', 'Compare taxable earnings, deductions and year-to-date values for both periods.'] },
    { id: 'bank-reconcile', label: 'Bank reconciliation', match: /\b(bank reconcil|reconcil\w* bank|ofx|bank statement.*out of balance)\b/i, mode: 'guide',
      steps: ['Confirm the bank statement opening and closing balances.', 'Compare imported transactions and unmatched items with the ledger.', 'Investigate the difference before posting any adjustment.'] },
    { id: 'ess-mobile', label: 'ESS mobile registration', match: /\b(ess|self service|mobile app|qr code)\b/i, mode: 'guide',
      steps: ['Confirm the employee is active and has the correct self-service access.', 'Generate a fresh registration QR code and check device date and time.', 'Retry registration and capture the exact error if it persists.'] },
    { id: 'generic', label: 'General troubleshooting', match: /[\s\S]*/, mode: 'search',
      steps: ['Confirm the product version and exact error or expected result.', 'Reproduce the issue in a safe test environment and record the steps.', 'Check the relevant Sage documentation or escalate with sanitized evidence.'] }
  ];
  const TRIED = [
    { label: 'tax tables imported', match: /\b(imported|updated|loaded)\b.{0,35}\b(tax table|generic tax)|\b(tax table|generic tax)\b.{0,35}\b(imported|updated|loaded)\b/i, prune: /tax tables were imported/i },
    { label: 'company rule / tax recalculation', match: /\b(company rule recalculation|recalculat(?:ed|ion|e).{0,25}(?:company rule|tax))\b/i, prune: /Company Rule recalculation/i }
  ];
  const HELP = 'https://help.sage.com/';
  const COMMUNITY = 'https://community.sage.com/';
  const text = value => typeof value === 'string' ? value.trim() : '';

  function detectProduct(ticket) {
    const source = [ticket.product, ticket.description, ticket.rawLoggedText, ticket.subject, ticket.outline].map(text).join(' ');
    if (/sage\s*300\s*people|\b(paye|ess|payroll|employee tax)\b/i.test(source)) return 'Sage 300 People';
    if (/sage\s*300\s*(cloud|erp)?/i.test(source)) return 'Sage 300 Cloud';
    return 'Sage product not specified';
  }

  function summaryOf(ticket) {
    const raw = text(ticket.rawLoggedText) || text(ticket.description);
    const match = raw.match(/Summary of the query experienced and the outcome you are working towards:\s*([^\n]*)/i);
    if (match) return match[1].trim() || 'No “Summary of the query” provided.';
    if (ticket.rawLoggedText && !ticket.subject) return 'No “Summary of the query” provided.';
    return text(ticket.subject) || raw || 'No “Summary of the query” provided.';
  }

  function searchPhrase(value) {
    return text(value).replace(/\[?[A-Z]{1,4}\d{4,}\]?/gi, '')
      .replace(/\b(?:good day|please assist|site code|customer)\b/gi, '')
      .replace(/[^a-z0-9 /-]/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 70).trim();
  }

  function analyseTicket(ticket = {}) {
    const summary = summaryOf(ticket);
    const product = detectProduct(ticket);
    const raw = [summary, ticket.subject, ticket.outline, ticket.description, ticket.rawLoggedText].map(text).join(' ');
    const rule = RULES.find(item => item.match.test(raw)) || RULES[RULES.length - 1];
    const attempts = [ticket.rawLoggedText, ticket.description, ...(ticket.actions || []).map(a => a.actionDescription || a.description)].map(text).join(' ');
    const alreadyTried = TRIED.filter(item => item.match.test(attempts));
    const remaining = rule.steps.filter(step => !alreadyTried.some(item => item.prune.test(step)));
    const steps = [
      ...(alreadyTried.length ? ['Do not repeat these checks: ' + alreadyTried.map(item => item.label).join('; ') + '.'] : []),
      ...remaining
    ];
    const ref = text(ticket.incidentReference || ticket.ticketId) || 'your ticket';
    const contact = text(ticket.customer?.contactName || ticket.customerName).replace(/[\r\n<>]/g, '') || 'there';
    const query = `${product === 'Sage product not specified' ? 'Sage support' : product} ${rule.label}`;
    const links = [
      { title: 'Sage Help (browse for this topic)', url: HELP },
      { title: 'Sage Community (browse for this topic)', url: COMMUNITY }
    ];
    const evidence = (ticket.attachments || []).map(a => text(typeof a === 'string' ? a : a.name)).filter(Boolean).map(name => `Attachment listed: ${name}`);
    const reply = `Good day ${contact}\n\nThank you for contacting us about ${ref}. We understand your query concerns ${rule.label.toLowerCase()}. ${alreadyTried.length ? 'We will not repeat those checks. ' : ''}We will review the details and verify the next steps before making any changes. ${rule.mode === 'search' ? 'We will confirm the relevant documentation or compatibility guidance rather than assume a resolution.' : 'We will use the Sage guidance and validate the outcome with you.'}\n\nKind regards`;
    return {
      ticketId: ref, product, summary, query, reply,
      topic: { id: rule.id, label: rule.label, resourceMode: rule.mode, steps, links, alreadyTriedLabels: alreadyTried.map(item => item.label) },
      analysis: {
        rootCause: { content: `Possible area: ${rule.label}. This is a rules-based classification, not a confirmed root cause.`, confidence: rule.id === 'generic' ? 0.3 : 0.65, evidence },
        solution: { content: `Suggested checks for ${product}:`, steps },
        searchResults: [{ query, results: { guides: { source: 'Sage resources (not searched)', results: links } } }]
      }
    };
  }

  function rankQueue(tickets = []) {
    const score = t => (/logged|new|open/i.test(text(t.stage || t.status)) ? 100 : 0)
      + (/critical/i.test(text(t.priority)) ? 40 : /high/i.test(text(t.priority)) ? 20 : 0)
      + (/error|cannot|outage/i.test(text(t.outline || t.subject)) ? 10 : 0);
    return [...tickets].sort((a, b) => score(b) - score(a));
  }

  function similarTickets(ticket, others = []) {
    const current = analyseTicket(ticket);
    return others.filter(other => other !== ticket && analyseTicket(other).topic.id === current.topic.id && current.topic.id !== 'generic');
  }

  function chat(message, ticket = {}) {
    const question = text(message);
    if (!question) return 'Ask a Sage or IT support question about this ticket.';
    if (/\b(poem|recipe|weather|sports|movie|joke|politic|plant|gardening)\b/i.test(question)
      || !/\b(sage|people|paye|tax|payroll|bom|bill of material|bank|reconcil|ledger|g\/l|ess|mobile|qr|ticket|attachment|error|install|permission|network|printer|backup|support|steps|solution|reply|customer|peresoft|compatib)/i.test(question)) {
      return 'I can only help with Sage and IT support tickets using offline rules.';
    }
    const current = analyseTicket(ticket);
    if (/\b(reply|respond|customer)\b/i.test(question)) return current.reply;
    if (/\b(attachment|evidence)\b/i.test(question)) return current.analysis.rootCause.evidence.join('; ') || 'No attachment names were captured for this ticket.';
    const prompted = analyseTicket({ ...ticket, rawLoggedText: '', actions: [], subject: question, description: question });
    const context = prompted.topic.id === 'generic' ? current : prompted;
    return `${context.topic.label}: ${context.topic.steps.join(' ')} These are suggested checks, not a confirmed diagnosis.`;
  }

  root.NetAdminEngine = Object.freeze({ analyseTicket, detectProduct, rankQueue, similarTickets, searchPhrase, chat });
})(globalThis);
