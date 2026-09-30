/**
 * NetAdmin Assistant - deterministic ticket analysis
 *
 * Browser-only module. No Node APIs, no network calls and no AI service.
 * Attaches itself to the global scope as `NetAdminAnalyzer` so that it can be
 * loaded with a plain <script> tag, with importScripts() in the service worker
 * and inside a vm context from the regression tests.
 */
(function (root) {
  'use strict';

  const MAX_QUERY_LENGTH = 70;

  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const lower = (value) => text(value).toLowerCase();

  /* ------------------------------------------------------------------ *
   * Webform field extraction
   * ------------------------------------------------------------------ */

  const FIELD_LABELS = [
    ['question', 'How would you best describe this query?'],
    ['question', 'How would you best describe this query'],
    ['summary', 'Summary of the query experienced and the outcome you are working towards'],
    ['summary', 'Summary of the query'],
    ['summary', 'Summary'],
    ['stepsToReplicate', 'Detail the steps to replicate the issue'],
    ['stepsToReplicate', 'Steps to replicate'],
    ['resolutionsAttempted', 'Describe the resolutions attempted'],
    ['resolutionsAttempted', 'Resolutions attempted'],
    ['product', 'Product'],
    ['module', 'Module'],
    ['version', 'Version'],
    ['siteCode', 'Site Code'],
    ['siteCode', 'Customer Code'],
    ['errorMessage', 'Error message'],
    ['outcome', 'Outcome you are working towards']
  ];

  const LABEL_BOUNDARY = FIELD_LABELS
    .map(([, label]) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  /**
   * Pull the NetAdmin webform fields out of the logged text.
   * Values stop at the next known label so multi-line answers survive intact.
   */
  function extractFields(raw) {
    const source = text(raw);
    const fields = {};
    if (!source) return fields;
    for (const [key, label] of FIELD_LABELS) {
      if (fields[key]) continue;
      const pattern = new RegExp(
        `(?:^|\\n)\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:[:\\-]\\s*|\\n\\s*${key === 'question' && !label.endsWith('?') ? '|\\?\\s+' : ''})([\\s\\S]*?)(?=\\n\\s*(?:${LABEL_BOUNDARY})\\s*(?:[:\\-]|\\n)|$)`,
        'i'
      );
      const match = source.match(pattern);
      if (match) {
        const value = match[1].replace(/\s+/g, ' ').trim();
        if (value) fields[key] = value;
      }
    }
    if (/Summary of the query/i.test(source) && !fields.summary) fields.summaryMissing = true;
    return fields;
  }

  /* ------------------------------------------------------------------ *
   * Sanitising helpers
   * ------------------------------------------------------------------ */

  const SITE_CODE_PATTERNS = [
    /https?:\/\/\S+/gi,
    /[\w.+-]+@[\w-]+\.[\w.-]+/gi,
    /\+?\d[\d\s()-]{7,}\d/g,
    /\bsite\s*code\s*[:\-]?\s*\S+/gi,
    /\bcustomer\s*code\s*[:\-]?\s*\S+/gi,
    /\[[A-Z]{1,4}\d{3,}\]/gi,
    /\b[A-Z]{1,4}\d{5,}\b/g,
    /\bWF\d{4,}\b/gi
  ];

  /** Remove customer site codes and ticket references from free text. */
  function stripSiteCodes(value) {
    let out = text(value);
    for (const pattern of SITE_CODE_PATTERNS) out = out.replace(pattern, ' ');
    return out.replace(/\s+/g, ' ').trim();
  }

  const NOISE_WORDS = /\b(?:good day|good morning|good afternoon|hi there|dear|hello|please assist|kindly assist|please advise|thank you|thanks|regards|urgent|asap|client|customer|user)\b/gi;
  const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'was', 'are', 'you', 'your',
    'our', 'but', 'can', 'when', 'what', 'how', 'why', 'they', 'their', 'there',
    'into', 'onto', 'get', 'got', 'any', 'all', 'will', 'would', 'should', 'could', 'been',
    'does', 'did', 'doing', 'also', 'please', 'assist', 'issue', 'query', 'ticket', 'client'
  ]);

  /** Build the ticket-specific search phrase used for links and retrieval. */
  function buildSearchPhrase(value) {
    const cleaned = stripSiteCodes(value)
      .replace(NOISE_WORDS, ' ')
      .replace(/[^\p{L}\p{N} /._-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = [];
    for (const word of cleaned.split(' ')) {
      if (!word) continue;
      if (STOP_WORDS.has(word.toLowerCase())) continue;
      const candidate = words.concat(word).join(' ');
      if (candidate.length > MAX_QUERY_LENGTH) break;
      words.push(word);
    }
    return words.join(' ').trim();
  }

  /** Normalised comparison terms used by the similarity and knowledge layers. */
  function normalizeTerms(value) {
    const cleaned = stripSiteCodes(value).toLowerCase().replace(/[^a-z0-9 /]+/g, ' ');
    const terms = [];
    for (const word of cleaned.split(/\s+/)) {
      if (word.length < 3 || /^\d+$/.test(word) || STOP_WORDS.has(word)) continue;
      if (!terms.includes(word)) terms.push(word);
    }
    return terms;
  }

  const ERROR_CODE_PATTERN = /\b(?:error|err|code|msg)?\s*[#:]?\s*((?:0x[0-9a-f]{3,})|(?:[A-Z]{2,5}\d{3,6})|(?:\d{4,6}))\b/gi;

  /** Extract distinctive error codes so they can be weighted during matching. */
  function extractErrorCodes(value) {
    const source = stripSiteCodes(value);
    const codes = [];
    let match;
    ERROR_CODE_PATTERN.lastIndex = 0;
    while ((match = ERROR_CODE_PATTERN.exec(source)) !== null) {
      const code = match[1].toUpperCase();
      if (!codes.includes(code)) codes.push(code);
    }
    return codes;
  }

  /* ------------------------------------------------------------------ *
   * Product, module and third-party detection
   * ------------------------------------------------------------------ */

  const PRODUCTS = [
    { id: 'sage300people', label: 'Sage 300 People', match: /sage\s*300\s*people|\b(?:paye|uif|sdl|ess|employee self service|payroll|employee tax|irp5|emp201|emp501)\b/i },
    { id: 'sage300cloud', label: 'Sage 300 Cloud', match: /sage\s*300\s*(?:cloud|erp|accpac)?|\baccpac\b|\b(?:g\/l|a\/p|a\/r|i\/c|o\/e|p\/o)\b/i }
  ];

  /** Detect the Sage product for the ticket. */
  function detectProduct(ticket = {}) {
    const fields = extractFields(ticket.rawLoggedText || ticket.description);
    const explicit = text(ticket.product) || text(fields.product);
    const source = explicit || text(ticket.question) || fields.question || fields.summary || text(ticket.summary) || text(ticket.outline) || text(ticket.subject);
    const found = PRODUCTS.find((product) => product.match.test(source));
    return found ? found.label : 'Sage product not specified';
  }

  const MODULES = [
    { id: 'gl', label: 'General Ledger', match: /\bg\/l\b|general ledger|journal entry|chart of accounts|control account/i },
    { id: 'ap', label: 'Accounts Payable', match: /\ba\/p\b|accounts payable|vendor (?:invoice|payment)|payment batch|supplier invoice/i },
    { id: 'ar', label: 'Accounts Receivable', match: /\ba\/r\b|accounts receivable|customer (?:invoice|receipt|statement)|ar history|aged receivable/i },
    { id: 'ic', label: 'Inventory Control', match: /\bi\/c\b|inventory control|stock item|bill of material|\bbom\b|assembl(?:y|ies)|day end/i },
    { id: 'oe', label: 'Order Entry', match: /\bo\/e\b|order entry|sales order|shipment|credit note/i },
    { id: 'po', label: 'Purchase Orders', match: /\bp\/o\b|purchase order|receipt of goods|requisition/i },
    { id: 'bank', label: 'Bank Services', match: /bank services|bank reconcil|reconcil\w* the bank|bank entry|\bofx\b|bank statement/i },
    { id: 'tax', label: 'Tax Services', match: /tax services|tax authorit|tax group|tax class|\bvat\b/i },
    { id: 'si', label: 'System Manager / Connector', match: /system manager|si connector|sage intelligence|\bbim\b|business insights|financial reporter|\bconnector\b/i },
    { id: 'people', label: 'Sage 300 People payroll', match: /\bpaye\b|payroll|employee tax|\bess\b|self service|\bmcs\b|leave|irp5|tax table|company rule/i }
  ];

  /** Detect the most likely Sage module referenced by the ticket. */
  function detectModule(value) {
    const source = text(value);
    const found = MODULES.find((module) => module.match.test(source));
    return found ? { id: found.id, label: found.label } : { id: 'unknown', label: 'Module not identified' };
  }

  const THIRD_PARTY = [
    { name: 'Peresoft Cashbook', match: /peresoft|cashbook/i },
    { name: 'Orchid', match: /\borchid\b|extender/i },
    { name: 'Pacific Technology', match: /pacific technology|norming/i },
    { name: 'Technisoft', match: /technisoft|service manager/i },
    { name: 'AutoSimply', match: /autosimply|manufacturing/i },
    { name: 'Third-party add-on', match: /third[- ]party|add[- ]?on|isv\b|plug[- ]?in/i }
  ];

  /** Identify named third-party products and compatibility questions. */
  function detectThirdParty(value) {
    const source = text(value);
    const products = THIRD_PARTY.filter((item) => item.match.test(source)).map((item) => item.name);
    const compatibility = /compatib(?:le|ility)|supported (?:with|version)|will .* work with|certif(?:ied|ication)|integrat(?:e|ion|es)/i.test(source);
    return { products, compatibility, detected: products.length > 0 || compatibility };
  }

  /* ------------------------------------------------------------------ *
   * Detailed topic rules
   * ------------------------------------------------------------------ */

  const RULES = [
    {
      id: 'third-party-compatibility',
      label: 'Third-party compatibility',
      module: 'si',
      mode: 'search',
      patterns: [{ re: /compatib(?:le|ility)|supported version|certif(?:ied|ication)/i, weight: 6 }, { re: /peresoft|orchid|technisoft|autosimply|third[- ]party|add[- ]?on/i, weight: 5 }],
      cause: 'The question is about compatibility between Sage and a third-party or add-on product, which is confirmed by the vendor compatibility matrix rather than by a Sage configuration change.',
      steps: [
        'Confirm the exact Sage product version, update level and the third-party product version in use.',
        'Check the vendor compatibility matrix and the Sage supported versions list for that combination.',
        'Ask the vendor to confirm support in writing before any upgrade is scheduled.',
        'Record the confirmed versions on the ticket so the customer has the compatibility answer in writing.'
      ]
    },
    {
      id: 'people-mcs-password',
      label: 'Sage 300 People MCS password',
      product: 'Sage 300 People',
      module: 'people',
      mode: 'guide',
      patterns: [{ re: /\bmcs\b/i, weight: 6 }, { re: /password|credential|expired|locked out/i, weight: 4 }],
      cause: 'The MCS (Microsoft Connection Service) account password used by Sage 300 People has changed, expired or is out of step with the stored credentials.',
      steps: [
        'Confirm whether the Windows or database account password behind MCS was recently changed or expired.',
        'Update the stored MCS credentials in the Sage 300 People configuration utility with the current password.',
        'Restart the MCS service and confirm it starts under the correct account.',
        'Ask the user to log in again and confirm the exact message if it persists.'
      ]
    },
    {
      id: 'people-ess-mobile',
      label: 'ESS mobile registration',
      product: 'Sage 300 People',
      module: 'people',
      mode: 'guide',
      patterns: [{ re: /\bess\b|employee self service|self[- ]service/i, weight: 5 }, { re: /mobile|app|qr code|registration|register/i, weight: 4 }],
      cause: 'Employee self-service mobile registration fails when the employee record, self-service access or registration code is not valid for the device being used.',
      steps: [
        'Confirm the employee is active and has an ESS user with the correct self-service role.',
        'Generate a fresh registration QR code and confirm the device date, time and time zone are correct.',
        'Confirm the ESS URL is reachable from the device network and that the certificate is valid.',
        'Retry the registration and capture the exact on-screen error if it still fails.'
      ]
    },
    {
      id: 'people-tax-paye',
      label: 'People tax / PAYE calculation',
      product: 'Sage 300 People',
      module: 'people',
      mode: 'guide',
      patterns: [{ re: /\bpaye\b|employee tax|tax difference|tax calculat|tax table/i, weight: 6 }, { re: /company rule|recalculat|tax year|irp5|emp201/i, weight: 3 }],
      cause: 'A PAYE difference usually comes from the tax tables in use, the tax status on the employee or a change in taxable earnings between the periods being compared.',
      steps: [
        'Confirm the tax tables for the affected tax year were imported for the payroll period.',
        'Run a Company Rule recalculation in a copy of the database and compare the tax result.',
        'Compare taxable earnings, deductions, tax status and year-to-date values for both periods.',
        'Check for once-off or backdated earnings that change the annual equivalent used for PAYE.'
      ]
    },
    {
      id: 'people-leave',
      label: 'People leave and accruals',
      product: 'Sage 300 People',
      module: 'people',
      mode: 'guide',
      patterns: [{ re: /leave (?:balance|accrual|cycle|bucket)|annual leave|sick leave/i, weight: 6 }],
      cause: 'Leave balances differ when the leave cycle, accrual rule or leave take transactions do not match the configured leave definition.',
      steps: [
        'Confirm the leave definition, cycle start date and accrual method on the affected employees.',
        'Review the leave transactions posted in the cycle, including adjustments and carry-over.',
        'Recalculate the leave cycle in a test copy and compare the resulting balance.'
      ]
    },
    {
      id: 'bim-reporting',
      label: 'Business Insights / BIM reporting',
      module: 'si',
      mode: 'guide',
      patterns: [{ re: /\bbim\b|business insights/i, weight: 6 }, { re: /report|dashboard|view|drill/i, weight: 2 }],
      cause: 'Business Insights views depend on the underlying data selection and security setup, so differences usually come from the view definition or user rights rather than from the data itself.',
      steps: [
        'Confirm which Business Insights view, filter and date range are being used.',
        'Check the user security rights for the view and the underlying modules.',
        'Compare the view output with the equivalent module report to see where the figures diverge.'
      ]
    },
    {
      id: 'bom-assembly',
      label: 'Bill of materials / assemblies',
      module: 'ic',
      mode: 'guide',
      patterns: [{ re: /bill of material|\bbom\b|assembl(?:y|ies|e)|batch production|kit/i, weight: 6 }],
      cause: 'Assembly quantities and costs follow the bill of materials definition, so an unexpected result normally traces back to the component quantities, units of measure or the build quantity used.',
      steps: [
        'Confirm the bill of materials units of measure and the component quantities for the required batch yield.',
        'Set up a test assembly for the batch quantity and verify component consumption and finished-goods quantity.',
        'Review the assembly cost and the resulting I/C transactions before posting in the live company.',
        'Post only after the test result matches the expected yield and cost.'
      ]
    },
    {
      id: 'tax-services',
      label: 'Tax Services setup',
      module: 'tax',
      mode: 'guide',
      patterns: [{ re: /tax services|tax authorit|tax group|tax class|tax rate|\bvat\b/i, weight: 6 }],
      cause: 'Incorrect tax amounts are normally caused by the tax authority, tax group, tax class or tax rate setup that applies to the transaction.',
      steps: [
        'Confirm the tax authority, tax group and tax classes used on the affected transaction.',
        'Check the tax rates and the effective dates in Tax Services.',
        'Re-enter the transaction in a test company and confirm the calculated tax before correcting live data.'
      ]
    },
    {
      id: 'bank-reconciliation',
      label: 'Bank reconciliation',
      module: 'bank',
      mode: 'guide',
      patterns: [{ re: /bank reconcil|reconcil\w+ (?:the )?bank|bank statement|\bofx\b|unreconciled/i, weight: 6 }, { re: /out of balance|difference|does not balance/i, weight: 3 }],
      cause: 'A bank reconciliation difference is normally caused by unmatched or duplicated statement entries, or by entries posted directly to the bank account outside Bank Services.',
      steps: [
        'Confirm the statement opening and closing balances against the bank statement itself.',
        'Compare the imported statement entries with the Bank Services transactions and list the unmatched items.',
        'Check for entries posted directly to the bank G/L account that never went through Bank Services.',
        'Investigate and document the difference before posting any adjustment.'
      ]
    },
    {
      id: 'gl-control-account',
      label: 'G/L control account posting',
      module: 'gl',
      mode: 'guide',
      patterns: [{ re: /control account/i, weight: 6 }, { re: /\bg\/l\b|general ledger|journal/i, weight: 3 }, { re: /vendor|customer|subledger/i, weight: 3 }],
      cause: 'Subledger control accounts are reserved for A/P and A/R postings, so vendors and customers cannot be selected on a direct G/L journal entry.',
      steps: [
        'Confirm the account is flagged as a subledger control account in the G/L account setup.',
        'Post the transaction through the A/P or A/R module instead of a direct G/L journal entry.',
        'Compare the G/L control account balance with the subledger aged report before correcting anything.'
      ]
    },
    {
      id: 'gl-consolidation',
      label: 'G/L consolidations',
      module: 'gl',
      mode: 'guide',
      patterns: [{ re: /consolidat/i, weight: 6 }, { re: /\bg\/l\b|general ledger|company|inter[- ]?company/i, weight: 2 }],
      cause: 'Consolidation differences normally come from the account mapping, the period selected or transactions posted after the last consolidation export.',
      steps: [
        'Confirm the consolidation account mapping between the source and destination companies.',
        'Check the fiscal period and year selected for the export and import.',
        'Re-run the export for the affected period and compare the totals before importing again.'
      ]
    },
    {
      id: 'ap-payments',
      label: 'A/P invoices and payments',
      module: 'ap',
      mode: 'guide',
      patterns: [{ re: /\ba\/p\b|accounts payable|vendor (?:invoice|payment|balance)|payment batch|remittance/i, weight: 5 }],
      cause: 'A/P differences are usually caused by the batch status, the payment selection criteria or documents that were posted in a different period.',
      steps: [
        'Confirm the batch status and whether the affected batch was posted or is still open.',
        'Review the payment selection criteria, bank code and payment date used.',
        'Compare the vendor aged payables report with the G/L control account for the same period.'
      ]
    },
    {
      id: 'ar-history',
      label: 'A/R history and statements',
      module: 'ar',
      mode: 'guide',
      patterns: [{ re: /ar history|a\/r history|customer (?:statement|history)|aged receivable/i, weight: 6 }, { re: /\ba\/r\b|accounts receivable|receipt/i, weight: 3 }],
      cause: 'A/R history differences normally follow from the period the documents were posted in, or from history that was cleared or never updated for the period being viewed.',
      steps: [
        'Confirm the year and period selected on the A/R history enquiry or statement.',
        'Check whether A/R period-end processing or clear history has been run for that period.',
        'Compare the customer transactions with the aged receivables report for the same cut-off date.'
      ]
    },
    {
      id: 'oe-orders',
      label: 'O/E orders and shipments',
      module: 'oe',
      mode: 'guide',
      patterns: [{ re: /\bo\/e\b|order entry|sales order|shipment|back ?order/i, weight: 5 }],
      cause: 'Order Entry problems usually trace back to the order status, the quantity available in I/C or the O/E options that control shipping and invoicing.',
      steps: [
        'Confirm the order status, the quantities ordered, shipped and back-ordered.',
        'Check the item quantity available in I/C for the location on the order.',
        'Review the O/E options controlling shipments, invoices and day-end processing.'
      ]
    },
    {
      id: 'po-receipts',
      label: 'P/O receipts and invoices',
      module: 'po',
      mode: 'guide',
      patterns: [{ re: /\bp\/o\b|purchase order|receipt of goods|goods received|requisition/i, weight: 5 }],
      cause: 'Purchase Order differences generally come from receipts that were not invoiced, or from cost adjustments posted between the receipt and the invoice.',
      steps: [
        'Confirm the purchase order status and which receipts have been invoiced.',
        'Review the received-not-invoiced report for the affected purchase orders.',
        'Compare the item cost on the receipt and on the vendor invoice.'
      ]
    },
    {
      id: 'ic-day-end',
      label: 'I/C Day End processing',
      module: 'ic',
      mode: 'guide',
      patterns: [{ re: /day ?end/i, weight: 6 }, { re: /inventory|costing|audit|i\/c/i, weight: 2 }],
      cause: 'Costing and audit information is only created once Day End Processing has run, so missing costs or transactions usually mean Day End is outstanding or failed part way.',
      steps: [
        'Confirm when Day End Processing last completed successfully.',
        'Run Day End Processing in a test copy of the database and capture any error reported.',
        'Review the I/C costing and audit reports after Day End completes and confirm the expected figures.'
      ]
    },
    {
      id: 'reporting-connector',
      label: 'Reporting / SI Connector',
      module: 'si',
      mode: 'guide',
      patterns: [{ re: /sage intelligence|si connector|financial reporter|crystal report|report designer/i, weight: 6 }, { re: /report (?:layout|template|not printing)|export to excel/i, weight: 3 }],
      cause: 'Reporting problems normally come from the report layout, the connector configuration or the rights of the account running the report rather than from the accounting data.',
      steps: [
        'Confirm which report or layout is used and whether a customised version is involved.',
        'Check the connector or report designer configuration and the database credentials it uses.',
        'Run the standard Sage layout for the same selection to confirm whether the customisation is the cause.'
      ]
    },
    {
      id: 'generic',
      label: 'General troubleshooting',
      module: 'unknown',
      mode: 'search',
      patterns: [],
      cause: 'There is not enough evidence in the ticket to classify the query, so the details need to be confirmed before any change is suggested.',
      steps: [
        'Confirm the product, version and the exact error message or expected result.',
        'Reproduce the issue in a safe test environment and record the steps followed.',
        'Collect screenshots or logs and confirm when the behaviour started.',
        'Check the Sage documentation for the affected area or escalate with the sanitised evidence.'
      ]
    }
  ];

  /** Module-level guidance used when no detailed rule matches. */
  const MODULE_GUIDES = {
    gl: ['Confirm the fiscal year, period and account range being reviewed.', 'Compare the G/L account balance with the source subledger for the same period.'],
    ap: ['Confirm the vendor, document number and batch involved.', 'Compare the A/P aged payables report with the G/L control account.'],
    ar: ['Confirm the customer, document number and period involved.', 'Compare the A/R aged receivables report with the G/L control account.'],
    ic: ['Confirm the item number, location and the transactions affecting the quantity.', 'Check whether Day End Processing has run since the transactions were posted.'],
    oe: ['Confirm the order number and its current status.', 'Check the item quantities available for the order location.'],
    po: ['Confirm the purchase order number and the receipt or invoice involved.', 'Review the received-not-invoiced report for that vendor.'],
    bank: ['Confirm the bank code, statement date and balances involved.', 'List the unmatched statement entries before making any adjustment.'],
    tax: ['Confirm the tax authority, group and class used on the transaction.', 'Check the tax rates and their effective dates.'],
    si: ['Confirm the report or view being used and whether it is customised.', 'Check the user rights and the connector configuration.'],
    people: ['Confirm the employee, payroll period and pay run affected.', 'Recalculate in a copy of the database before changing live payroll data.'],
    unknown: []
  };

  /* ------------------------------------------------------------------ *
   * Work already attempted
   * ------------------------------------------------------------------ */

  const ALREADY_DONE = [
    { label: 'tax tables imported', match: /\b(?:imported|updated|loaded|installed)\b[^.\n]{0,40}\btax table|\btax table[^.\n]{0,40}\b(?:imported|updated|loaded|installed)\b/i, prune: /tax tables? for the affected tax year were imported|tax tables/i },
    { label: 'Company Rule recalculation', match: /company rule recalculation|recalculat\w*[^.\n]{0,25}(?:company rule|tax)/i, prune: /Company Rule recalculation/i },
    { label: 'service restarted', match: /restart\w*[^.\n]{0,25}(?:service|server|application pool)/i, prune: /Restart the [\w ]*service/i },
    { label: 'workstation setup / reinstall', match: /(?:workstation setup|reinstall\w*|repair install)/i, prune: /workstation setup/i },
    { label: 'data integrity check', match: /data integrity|dbspy|integrity check/i, prune: /data integrity/i },
    { label: 'Day End Processing run', match: /(?:ran|run|completed)[^.\n]{0,20}day ?end/i, prune: /Run Day End Processing/i },
    { label: 'QR code regenerated', match: /(?:new|fresh|regenerat\w*|resent)[^.\n]{0,25}qr code/i, prune: /fresh registration QR code/i },
    { label: 'statement re-imported', match: /re[- ]?import\w*[^.\n]{0,25}(?:statement|ofx)/i, prune: /imported statement entries/i },
    { label: 'test company checked', match: /test (?:company|database|environment)[^.\n]{0,30}(?:tested|checked|reproduced|same)/i, prune: /test (?:copy|company)/i }
  ];

  /** Detect the work the customer or consultant has already reported doing. */
  function detectAlreadyAttempted(ticket = {}) {
    const fields = extractFields(ticket.rawLoggedText || ticket.description);
    const source = [
      fields.resolutionsAttempted,
      fields.stepsToReplicate,
      ticket.resolutionsAttempted,
      ticket.description,
      ticket.rawLoggedText,
      ...(ticket.actions || []).map((action) => (typeof action === 'string' ? action : action && (action.actionDescription || action.description)))
    ].map(text).join('\n');
    return ALREADY_DONE.filter((item) => item.match.test(source));
  }

  /** Remove steps that duplicate work already reported as done. */
  function pruneSteps(steps, attempted) {
    return steps.filter((step) => !attempted.some((item) => item.prune.test(step)));
  }

  /* ------------------------------------------------------------------ *
   * Resource links
   * ------------------------------------------------------------------ */

  const SOURCE_LINKS = [
    { id: 'kb-za', name: 'Sage Knowledgebase (ZA)', template: 'https://za-kb.sage.com/portal/app/portlets/results/viewsearch.jsp?q=' },
    { id: 'kb-us', name: 'Sage Knowledgebase (US)', template: 'https://us-kb.sage.com/portal/app/portlets/results/viewsearch.jsp?q=' },
    { id: 'community', name: 'Sage Community Hub', template: 'https://communityhub.sage.com/search?q=' },
    { id: 'google', name: 'Google (opens in a new tab)', template: 'https://www.google.com/search?q=' }
  ];

  /** Build the pre-filled search links for a query. */
  function buildResourceLinks(query, product) {
    const phrase = [product && product !== 'Sage product not specified' ? product : 'Sage', query].filter(Boolean).join(' ').trim();
    const encoded = encodeURIComponent(phrase);
    return SOURCE_LINKS.map((source) => ({ id: source.id, title: `${source.name}: ${phrase}`, name: source.name, url: `${source.template}${encoded}` }));
  }

  /* ------------------------------------------------------------------ *
   * Topic selection
   * ------------------------------------------------------------------ */

  function scoreRule(rule, haystack, product, moduleId) {
    if (!rule.patterns.length) return 0;
    if (rule.product && product !== 'Sage product not specified' && rule.product !== product) return 0;
    if (product === 'Sage 300 People' && rule.module && !['people', 'si'].includes(rule.module) && rule.id !== 'third-party-compatibility') return 0;
    if (rule.patterns.length > 1 && !rule.patterns[0].re.test(haystack)) return 0;
    if (rule.id === 'third-party-compatibility' && !rule.patterns[1].re.test(haystack)) return 0;
    if (rule.id === 'gl-control-account' && !/journal|direct (?:g\/l|general ledger)|pick (?:a )?(?:vendor|customer)/i.test(haystack)) return 0;
    let score = 0;
    let matched = 0;
    for (const pattern of rule.patterns) {
      if (pattern.re.test(haystack)) {
        score += pattern.weight;
        matched += 1;
      }
    }
    if (!matched) return 0;
    if (rule.product && rule.product === product) score += 2;
    if (rule.module && rule.module === moduleId) score += 1;
    return score;
  }

  /* ------------------------------------------------------------------ *
   * Customer-safe reply
   * ------------------------------------------------------------------ */

  function safeName(ticket) {
    const name = text(ticket.customer && ticket.customer.contactName) || text(ticket.contactName) || text(ticket.customerName);
    return name.replace(/[\r\n<>]/g, '').split(' ')[0] || 'there';
  }

  function buildReply(context) {
    const { ticket, topic, product, attempted, summary } = context;
    const reference = text(ticket.incidentReference) || text(ticket.ticketId) || 'your ticket';
    const lines = [];
    lines.push(`Good day ${safeName(ticket)}`);
    lines.push('');
    lines.push(`Thank you for logging ${reference}.`);
    if (summary && !/^No “Summary/.test(summary)) lines.push(`Our understanding of your query: ${stripSiteCodes(summary)}`);
    lines.push(topic.id === 'generic'
      ? 'We cannot yet identify a specific cause or module from the recorded query.'
      : `A possible area to check is ${topic.label.toLowerCase()}${product === 'Sage product not specified' ? '' : ` in ${product}`}; this is not a confirmed diagnosis.`);
    if (attempted.length) lines.push(`We can see the following has already been done, so we will not ask you to repeat it: ${attempted.map((item) => item.label).join('; ')}.`);
    if (topic.steps.length) {
      lines.push('');
      lines.push('Our suggested next steps are:');
      topic.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    }
    lines.push('');
    lines.push(topic.resourceMode === 'search'
      ? 'These are suggested checks based on the information logged. We will confirm the documented answer before advising a change.'
      : 'These are suggested checks based on the information logged, and we will confirm the outcome with you before any change is made in your live data.');
    lines.push('');
    lines.push('Kind regards');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Main analysis
   * ------------------------------------------------------------------ */

  /**
   * Analyse a single ticket.
   * @param {object} ticket scraped ticket data
   * @param {object} [options] optional knowledge entries and completed history
   */
  function analyseTicket(ticket = {}, options = {}) {
    const fields = extractFields(ticket.rawLoggedText || ticket.description);
    const question = text(ticket.question) || fields.question;
    const description = text(ticket.description);
    const summaryText = question || fields.summary || text(ticket.summary) || description || text(ticket.outline) || text(ticket.subject);
    const questionSource = question ? (text(ticket.questionSource) || 'How would you best describe this query?')
      : fields.summary ? 'Summary of the query' : description && summaryText === description ? 'Ticket description' : summaryText ? 'Ticket summary/title' : 'Not provided';
    const summary = summaryText || 'No “Summary of the query” provided.';
    const cleanedSummary = stripSiteCodes(summary).replace(/\s+/g, ' ');
    const querySummary = cleanedSummary.length > 280 ? `${cleanedSummary.slice(0, 280)}…` : cleanedSummary;
    const product = detectProduct(ticket);
    const intent = summaryText;
    let moduleInfo = detectModule(intent);
    const productConflict = product === 'Sage 300 People' && !['unknown', 'people', 'si'].includes(moduleInfo.id);
    const thirdParty = detectThirdParty(intent);

    let best = RULES[RULES.length - 1];
    let bestScore = 0;
    RULES.forEach((rule) => {
      const score = scoreRule(rule, intent, product, moduleInfo.id);
      if (score > bestScore) {
        best = rule;
        bestScore = score;
      }
    });
    if (best.id === 'generic') moduleInfo = { id: 'unknown', label: 'Module not identified' };
    else if (best.module && best.module !== 'unknown' && best.module !== 'si') {
      moduleInfo = MODULES.find((module) => module.id === best.module) || moduleInfo;
      moduleInfo = { id: moduleInfo.id, label: moduleInfo.label };
    }

    const attempted = detectAlreadyAttempted(ticket);
    let steps = pruneSteps(best.steps, attempted);
    if (thirdParty.products.length && best.id !== 'third-party-compatibility') {
      steps = steps.concat(`Confirm the supported version of ${thirdParty.products[0]} for this Sage release with the vendor before changing anything.`);
    }
    const stepList = attempted.length
      ? [`Already reported as done, do not repeat: ${attempted.map((item) => item.label).join('; ')}.`].concat(steps)
      : steps.slice();

    const query = buildSearchPhrase(intent) || 'Sage support';
    const links = buildResourceLinks(query, product);

    const knowledge = matchKnowledge(options.knowledge || [], { haystack: intent, product, moduleId: moduleInfo.id, topicId: best.id });
    const similar = rankSimilarTickets({ haystack: intent, product, moduleId: moduleInfo.id, topicId: best.id }, options.history || []);

    const evidence = [];
    if (question) evidence.push(`${questionSource}: ${stripSiteCodes(question)}`);
    else if (fields.summary) evidence.push(`Summary field: ${stripSiteCodes(fields.summary)}`);
    if (fields.stepsToReplicate) evidence.push(`Steps to replicate: ${stripSiteCodes(fields.stepsToReplicate)}`);
    if (fields.resolutionsAttempted) evidence.push(`Resolutions attempted: ${stripSiteCodes(fields.resolutionsAttempted)}`);
    if (thirdParty.products.length) evidence.push(`Third-party product mentioned: ${thirdParty.products.join(', ')}`);
    const errorCodes = extractErrorCodes(intent);
    if (errorCodes.length) evidence.push(`Error code in query: ${errorCodes.join(', ')}`);
    (ticket.attachments || []).forEach((attachment) => {
      const name = text(typeof attachment === 'string' ? attachment : attachment && attachment.name);
      if (name) evidence.push(`Attachment listed: ${name}`);
    });

    const topic = {
      id: best.id,
      label: best.label,
      resourceMode: best.mode,
      module: moduleInfo,
      steps: stepList,
      links,
      alreadyTriedLabels: attempted.map((item) => item.label)
    };

    const confidence = best.id === 'generic' ? 0.3 : Math.min(0.85, 0.45 + bestScore * 0.04);

    return {
      ticketId: text(ticket.incidentReference) || text(ticket.ticketId) || 'Unknown ticket',
      product,
      module: moduleInfo,
      summary,
      querySummary,
      questionSource,
      fields,
      query,
      errorCodes,
      thirdParty,
      topic,
      knowledge,
      similarTickets: similar,
      reply: buildReply({ ticket, topic, product, attempted, summary }),
      analysis: {
        rootCause: {
          content: best.id === 'generic'
            ? `${productConflict ? 'The selected product and described workflow may conflict. ' : ''}The recorded query does not provide enough evidence to identify a specific cause or module. Confirm the affected workflow before applying any module-specific guidance.`
            : `Suggested area: ${best.label}. ${best.cause} This is a rules-based suggestion, not a confirmed root cause.`,
          confidence,
          evidence
        },
        solution: {
          content: `Suggested checks for ${product}${best.id === 'generic' || moduleInfo.id === 'unknown' ? '' : ` · ${moduleInfo.label}`}:`,
          steps: stepList
        },
        searchResults: [{ query, results: { guides: { source: 'Pre-filled Sage searches (click to open)', results: links } } }]
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Curated knowledge matching
   * ------------------------------------------------------------------ */

  /**
   * Rank curated knowledge entries against the ticket evidence.
   * Entries never override the rules engine, they are additive context.
   */
  function matchKnowledge(entries, context) {
    if (!Array.isArray(entries) || !entries.length) return [];
    const haystack = lower(context.haystack);
    const terms = normalizeTerms(context.haystack);
    const scored = [];
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      if (entry.product && context.product !== 'Sage product not specified' && entry.product !== context.product) return;
      let score = 0;
      const matchedOn = [];
      (entry.keywords || []).forEach((keyword) => {
        const value = lower(keyword);
        if (value && keywordMatch(haystack, value)) {
          score += 3;
          matchedOn.push(keyword);
        }
      });
      (entry.errorPatterns || []).forEach((pattern) => {
        const value = lower(pattern);
        if (value && keywordMatch(haystack, value)) {
          score += 5;
          matchedOn.push(pattern);
        }
      });
      if (entry.topicId && entry.topicId === context.topicId) score += 4;
      if (entry.module && entry.module === context.moduleId) score += 2;
      if (entry.product && entry.product === context.product) score += 2;
      const overlap = (entry.phrases || []).filter((phrase) => terms.includes(lower(phrase))).length;
      score += overlap;
      // Product or module alone is never enough: an entry must match the topic
      // or some wording from the ticket before it is offered.
      if (!matchedOn.length || (entry.topicId !== context.topicId && matchedOn.length < 2)) return;
      if (score <= 3) return;
      scored.push({
        id: text(entry.id) || `entry-${index}`,
        title: text(entry.title),
        product: text(entry.product),
        module: text(entry.module),
        likelyCause: text(entry.likelyCause),
        steps: (entry.steps || []).map(text).filter(Boolean),
        alreadyDonePatterns: (entry.alreadyDonePatterns || []).map(text).filter(Boolean),
        links: (entry.links || []).filter((link) => link && /^https:\/\//i.test(text(link.url))).map((link) => ({ title: text(link.title) || text(link.url), url: text(link.url) })),
        source: text(entry.source) || 'Local knowledge base',
        score,
        matchedOn,
        index
      });
    });
    return scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3).map((item) => {
      const copy = Object.assign({}, item);
      delete copy.index;
      return copy;
    });
  }

  function keywordMatch(haystack, keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(haystack);
  }

  /* ------------------------------------------------------------------ *
   * Completed-ticket similarity
   * ------------------------------------------------------------------ */

  /**
   * Rank previously completed tickets against the current ticket context.
   * Records are the anonymised summaries stored locally by the history layer.
   */
  function rankSimilarTickets(context, records) {
    if (!Array.isArray(records) || !records.length) return [];
    const terms = normalizeTerms(context.haystack);
    const scored = [];
    records.forEach((record, index) => {
      if (!record || typeof record !== 'object') return;
      let score = 0;
      const recordTerms = normalizeTerms(record.summary);
      const overlap = recordTerms.filter((term) => terms.includes(term));
      score += overlap.length;
      const codeOverlap = [];
      // A prior ticket's topic, module or error code is never sufficient
      // without meaningful overlap with the current question.
      if (overlap.length < (record.topicId === context.topicId ? 2 : 3)) return;
      if (record.topicId && record.topicId === context.topicId) score += 6;
      if (record.module && record.module === context.moduleId) score += 2;
      if (record.product && record.product === context.product) score += 2;
      if (score < 4) return;
      scored.push({
        reference: text(record.reference) || `history-${index}`,
        topicId: text(record.topicId),
        product: text(record.product),
        module: text(record.module),
        summary: stripSiteCodes(record.summary),
        resolution: stripSiteCodes(record.resolution),
        closedPeriod: text(record.closedPeriod),
        score,
        matchedTerms: overlap.slice(0, 8),
        matchedCodes: codeOverlap,
        confidence: 'historical context only',
        index
      });
    });
    return scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3).map((item) => {
      const copy = Object.assign({}, item);
      delete copy.index;
      return copy;
    });
  }

  /** Convenience wrapper used by the side panel and the tests. */
  function similarTickets(ticket, records) {
    const analysis = analyseTicket(ticket);
    return rankSimilarTickets(
      {
        haystack: [analysis.summary, ticket.description, ticket.rawLoggedText].map(text).join(' '),
        product: analysis.product,
        moduleId: analysis.module.id,
        topicId: analysis.topic.id
      },
      records
    );
  }

  /* ------------------------------------------------------------------ *
   * Queue ranking
   * ------------------------------------------------------------------ */

  /** Rank the open queue so the most urgent logged tickets appear first. */
  function rankQueue(tickets = []) {
    const score = (ticket) => {
      const stage = lower(ticket.stage || ticket.status);
      const priority = lower(ticket.priority);
      const outline = text(ticket.outline || ticket.subject || ticket.summary);
      let value = 0;
      if (/logged|new|open|unassigned/.test(stage)) value += 100;
      else if (/progress/.test(stage)) value += 40;
      else if (/feedback|hold|pending/.test(stage)) value += 10;
      if (/critical|severity 1|\bp1\b/.test(priority)) value += 40;
      else if (/high|severity 2/.test(priority)) value += 20;
      else if (/medium/.test(priority)) value += 8;
      if (/error|cannot|can't|outage|down|unable|fail/i.test(outline)) value += 10;
      if (/how to|query|question|request/i.test(outline)) value -= 4;
      return value;
    };
    return tickets
      .map((ticket, index) => ({ ticket, index, value: score(ticket) }))
      .sort((a, b) => b.value - a.value || a.index - b.index)
      .map((item) => item.ticket);
  }

  /* ------------------------------------------------------------------ *
   * Scoped offline chat
   * ------------------------------------------------------------------ */

  const IN_SCOPE = /\b(sage|people|paye|payroll|tax|bom|bill of material|assembly|bank|reconcil|ledger|g\/l|a\/p|a\/r|o\/e|p\/o|inventory|ess|mcs|mobile|qr|ticket|attachment|error|install|upgrade|permission|network|printer|backup|support|step|solution|reply|customer|vendor|peresoft|compatib|report|connector|consolidat|day end)\b/i;
  const OUT_OF_SCOPE = /\b(poem|recipe|weather|sport|movie|joke|politic|gardening|lyrics|story|novel|song)\b/i;

  /** Answer a scoped support question using the same offline rules. */
  function chat(message, ticket = {}, options = {}) {
    const question = text(message);
    if (!question) return 'Ask a Sage or IT support question about this ticket.';
    if (OUT_OF_SCOPE.test(question) || !IN_SCOPE.test(question)) {
      return 'I can only help with Sage and IT support tickets using the offline rules engine.';
    }
    const current = analyseTicket(ticket, options);
    if (/\b(reply|respond|response|customer)\b/i.test(question)) return current.reply;
    if (/\b(attachment|evidence)\b/i.test(question)) {
      return current.analysis.rootCause.evidence.join('; ') || 'No local evidence was captured for this ticket.';
    }
    const prompted = analyseTicket({ subject: question, description: question }, options);
    const context = prompted.topic.id === 'generic' ? current : prompted;
    return `${context.topic.label}: ${context.topic.steps.join(' ')} These are suggested checks from the offline rules, not a confirmed diagnosis.`;
  }

  root.NetAdminAnalyzer = Object.freeze({
    analyseTicket,
    extractFields,
    stripSiteCodes,
    buildSearchPhrase,
    normalizeTerms,
    extractErrorCodes,
    detectProduct,
    detectModule,
    detectThirdParty,
    detectAlreadyAttempted,
    buildResourceLinks,
    matchKnowledge,
    rankSimilarTickets,
    similarTickets,
    rankQueue,
    chat,
    RULES,
    MODULE_GUIDES
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
