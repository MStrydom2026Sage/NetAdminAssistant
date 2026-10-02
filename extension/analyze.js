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
    ['incidentTypeGroup', 'Incident Type Group'],
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
        `(?:^|\\n)\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*(?:[:\\-]\\s*|\\t\\s*|\\n\\s*${key === 'question' && !label.endsWith('?') ? '|\\?\\s+' : ''})([\\s\\S]*?)(?=\\n\\s*(?:${LABEL_BOUNDARY})\\s*(?:[:\\-]|\\n)|$)`,
        'i'
      );
      const match = source.match(pattern);
      if (match) {
        // The Incident Type Group is a single value; never let it run on into
        // the next table cell or line.
        const raw = key === 'incidentTypeGroup' ? match[1].trim().split(/[\t\n]/)[0] : match[1];
        const value = raw.replace(/\s+/g, ' ').trim();
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

  const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'was', 'are', 'you', 'your',
    'our', 'but', 'can', 'when', 'what', 'how', 'why', 'they', 'their', 'there',
    'into', 'onto', 'get', 'got', 'any', 'all', 'will', 'would', 'should', 'could', 'been',
    'does', 'did', 'doing', 'also', 'please', 'assist', 'issue', 'query', 'ticket', 'client'
  ]);

  // Greetings and courtesy phrases are never part of the issue.
  const GREETINGS = /\b(?:good day|good morning|good afternoon|hi there|dear|hello|please assist|kindly assist|please advise|please help|thank you|thanks|regards|urgent|asap)\b/gi;
  // The product is applied separately to every search, so it is never part of
  // the keyword phrase.
  const PRODUCT_WORDS = /\bsage\s*300\s*(?:cloud|people|erp)?\b|\baccpac\b|\bsage\b/gi;
  const PHRASE_DROP = new Set([
    'the', 'a', 'an', 'and', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'does', 'did', 'do',
    'please', 'kindly', 'assist', 'advise', 'client', 'clients', 'customer', 'customers', 'wants', 'want', 'needs',
    'need', 'would', 'could', 'should', 'like', 'also', 'very', 'just', 'currently', 'still', 'our', 'their', 'your',
    'my', 'we', 'they', 'he', 'she', 'i', 'you', 'it', 'its', 'this', 'that', 'these', 'those', 'issue', 'query',
    'ticket', 'gets', 'getting', 'receives', 'receiving', 'keeps', 'trying', 'tried', 'there', 'says', 'said',
    'reports', 'reported', 'asks', 'asked'
  ]);
  const EDGE_WORDS = new Set(['to', 'of', 'in', 'at', 'by', 'for', 'with', 'and', 'or', 'from', 'after', 'before', 'when', 'while', 'but', 'so', 'then', 'because']);
  const QUOTED_MESSAGE = /["\u201C]([^"\u201C\u201D]{6,120})["\u201D]/;
  const LABELLED_MESSAGE = /\b(?:error message|message|error)\s*[:\-]\s*([^.\n;]{6,100})/i;
  const ISSUE_CODE = /\b(?:error|err|code|msg|message|exception)\s*(?:number|no\.?)?\s*[:#]?\s*(0x[0-9a-f]{3,}|[a-z]{0,5}-?\d{2,6})\b|\b(0x[0-9a-f]{4,})\b/gi;

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Privacy-sanitised words, in their original order. */
  function phraseWords(value, exclude, codes = []) {
    let cleaned = stripSiteCodes(value).replace(GREETINGS, ' ').replace(PRODUCT_WORDS, ' ');
    for (const word of exclude) cleaned = cleaned.replace(new RegExp(`(?:^|(?<=[^\\p{L}\\p{N}]))${escapeRegExp(word)}(?=$|[^\\p{L}\\p{N}])`, 'giu'), ' ');
    return cleaned
      .replace(/[^\p{L}\p{N} /._-]+/gu, ' ')
      .split(/\s+/)
      .map((word) => word.replace(/^[._/-]+|[._/-]+$/g, ''))
      .filter((word) => word && !PHRASE_DROP.has(word.toLowerCase())
        && (/\p{L}/u.test(word) || codes.some((code) => code.toLowerCase() === word.toLowerCase())));
  }

  /** Error codes quoted in the question itself; incidental numbers are ignored. */
  function extractIssueCodes(value) {
    const source = stripSiteCodes(value);
    const codes = [];
    let match;
    ISSUE_CODE.lastIndex = 0;
    while ((match = ISSUE_CODE.exec(source)) !== null) {
      const code = match[1] || match[2];
      if (!/\d/.test(code)) continue;
      if (!codes.some((item) => item.toLowerCase() === code.toLowerCase())) codes.push(code);
    }
    return codes;
  }

  // A question this long is a description, not a search: it is reduced to
  // its issue keywords, as an agent would type them into the Knowledgebase.
  const MAX_NATURAL_WORDS = 8;
  const MAX_SUMMARY_WORDS = 7;
  const FILLER_WORDS = new Set([
    'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'or', 'and', 'but', 'when', 'whenever', 'if', 'then',
    'so', 'because', 'while', 'which', 'where', 'who', 'what', 'how', 'why', 'all', 'any', 'some', 'only', 'same',
    'other', 'into', 'than', 'as', 'not', 'no', 'can', 'cannot', 'doesn', 'don', 'isn', 'aren', 'wasn', 'won',
    'didn', 'couldn', 'linked', 'using', 'used', 'use', 'user', 'users', 'standard', 'normal', 'normally', 'works',
    'working', 'worked', 'them', 'him', 'her', 'his', 'us', 'me', 'one', 'two', 'now', 'again', 'yet', 'get', 'got',
    'go', 'goes', 'went', 'make', 'makes', 'made', 'see', 'seen', 'shows', 'showing', 'show', 'happens', 'happen'
  ]);

  /** Crude stem so "print", "prints" and "printing" count as one keyword. */
  function keywordStem(word) {
    return word.toLowerCase().replace(/(?:ing|ed|es|s)$/, '');
  }

  /**
   * Issue keywords of a long description: the first sentence that carries
   * the issue, without filler words or repeats, then codes.
   */
  function summariseKeywords(source, exclude, codes) {
    const sentences = text(source).split(/(?<=[.!?;])\s+|\n+/).filter((item) => item.trim());
    const picked = [];
    const stems = new Set();
    for (const sentence of sentences) {
      for (const word of phraseWords(sentence, exclude, codes)) {
        if (word.length < 2 && !codes.some((code) => code.toLowerCase() === word.toLowerCase())) continue;
        if (FILLER_WORDS.has(word.toLowerCase())) continue;
        const stem = keywordStem(word);
        if (stems.has(stem)) continue;
        stems.add(stem);
        picked.push(word);
        if (picked.length >= MAX_SUMMARY_WORDS) return picked;
      }
      if (picked.length >= 3) break;
    }
    return picked;
  }

  function trimEdges(words) {
    const out = words.slice();
    while (out.length && EDGE_WORDS.has(out[0].toLowerCase())) out.shift();
    while (out.length && EDGE_WORDS.has(out[out.length - 1].toLowerCase())) out.pop();
    return out;
  }

  /**
   * Build the concise issue-keyword phrase used for every search link and for
   * optional retrieval. It comes from the recorded question only: a quoted
   * error message is preferred, then error codes actually quoted in the
   * question, then the remaining issue words. Site codes, ticket references,
   * contact details, greetings, the customer's name and the product name are
   * removed; the product is applied to each search separately.
   * @param {string} value the recorded question
   * @param {{exclude?: string[]}} [options] words to remove (customer names)
   */
  function buildSearchPhrase(value, options = {}) {
    const exclude = (options.exclude || []).map(text).filter((word) => word.length > 1);
    const source = text(value);
    const words = [];
    const add = (list, unique) => {
      for (const word of list) {
        if (unique && words.some((item) => item.toLowerCase() === word.toLowerCase())) continue;
        const candidate = words.concat(word).join(' ');
        if (candidate.length > MAX_QUERY_LENGTH) return false;
        words.push(word);
      }
      return true;
    };
    const message = QUOTED_MESSAGE.exec(source) || LABELLED_MESSAGE.exec(source);
    const messageWords = message ? trimEdges(phraseWords(message[1], exclude)) : [];
    const codes = extractIssueCodes(source).filter((code) => !exclude.some((word) => word.toLowerCase() === code.toLowerCase()));
    if (messageWords.length >= 2) {
      add(messageWords);
      add(codes, true);
      return words.join(' ').trim();
    }
    let keywords = trimEdges(phraseWords(source, exclude, codes));
    if (keywords.length > MAX_NATURAL_WORDS) keywords = summariseKeywords(source, exclude, codes);
    // Natural order when everything fits; otherwise the codes go first so
    // they are never cut off.
    if (keywords.join(' ').length > MAX_QUERY_LENGTH) add(codes, true);
    add(keywords.filter((word) => !words.includes(word)));
    add(codes, true);
    return trimEdges(words).join(' ').trim();
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

  const PRODUCT_UNKNOWN = 'Sage product not specified';
  const CLOUD = 'Sage 300 Cloud';
  const PEOPLE = 'Sage 300 People';
  const BOTH = [CLOUD, PEOPLE];

  // Only an explicit product name classifies a group or product field. A bare
  // "Sage 300", a module name or payroll wording never implies a product.
  const PRODUCTS = [
    { id: 'sage300people', label: PEOPLE, match: /sage\s*300\s*people/i },
    { id: 'sage300cloud', label: CLOUD, match: /sage\s*300\s*cloud/i }
  ];

  // Product names that can appear in the ticket text and contradict the group.
  const PRODUCT_MENTIONS = [
    { label: PEOPLE, match: /sage\s*300\s*people/i },
    { label: CLOUD, match: /sage\s*300\s*(?:cloud|erp)|\baccpac\b/i },
    { label: 'Sage 300 Construction and Real Estate', match: /sage\s*300\s*(?:cre\b|construction)/i },
    { label: 'Sage Evolution', match: /sage\s*evolution/i },
    { label: 'Sage Pastel', match: /sage\s*pastel|\bpastel\s*(?:partner|xpress|evolution)/i },
    { label: 'Sage X3', match: /sage\s*x3/i },
    { label: 'Sage Intacct', match: /sage\s*intacct/i },
    { label: 'Sage VIP', match: /sage\s*vip\b/i }
  ];

  /** Map an Incident Type Group or Product value to Sage 300 Cloud / People. */
  function classifyProduct(value) {
    const source = text(value);
    const found = PRODUCTS.filter((product) => product.match.test(source));
    return found.length === 1 ? found[0].label : '';
  }

  /**
   * Resolve the ticket's product.
   * The NetAdmin "Incident Type Group" is authoritative. The Product field is
   * only used when no group is recorded at all. A group that is present but not
   * recognised leaves the product unconfirmed, and product names in the ticket
   * text never change the product: they are reported as a contradiction.
   */
  function resolveProduct(ticket = {}, fieldsIn) {
    const fields = fieldsIn || extractFields(ticket.rawLoggedText || ticket.description);
    // Prefer whichever reading of the group names a product: the page control
    // can expose an id while the logged text shows the readable group.
    const groups = [ticket.incidentTypeGroup, fields.incidentTypeGroup].map((value) => stripSiteCodes(text(value)).slice(0, 120)).filter(Boolean);
    const group = groups.find((value) => classifyProduct(value)) || groups[0] || '';
    const productField = stripSiteCodes(text(ticket.product) || text(fields.product)).slice(0, 120);
    let product = PRODUCT_UNKNOWN;
    let source = 'none';
    if (group) {
      product = classifyProduct(group) || PRODUCT_UNKNOWN;
      source = product === PRODUCT_UNKNOWN ? 'unrecognised-group' : 'incident-type-group';
    } else if (productField) {
      product = classifyProduct(productField) || PRODUCT_UNKNOWN;
      source = product === PRODUCT_UNKNOWN ? 'none' : 'product-field';
    }
    const mentionText = [ticket.question, fields.question, fields.summary, ticket.summary, ticket.subject, ticket.outline,
      fields.stepsToReplicate, fields.errorMessage, group ? productField : ''].map(text).join('\n');
    const mentioned = PRODUCT_MENTIONS.filter((item) => item.match.test(mentionText)).map((item) => item.label);
    const conflicts = product === PRODUCT_UNKNOWN ? [] : mentioned.filter((label) => label !== product);
    return {
      product,
      source,
      incidentTypeGroup: group,
      productField,
      confirmed: source === 'incident-type-group',
      mentioned,
      conflicts
    };
  }

  /** Detect the Sage product for the ticket. */
  function detectProduct(ticket = {}) {
    return resolveProduct(ticket).product;
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
      products: BOTH,
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
      products: [PEOPLE],
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
      products: [PEOPLE],
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
      products: [PEOPLE],
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
      products: [PEOPLE],
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
      products: [CLOUD],
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
      products: [CLOUD],
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
      products: [CLOUD],
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
      products: [CLOUD],
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
      products: [CLOUD],
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
      products: [CLOUD],
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
      products: [CLOUD],
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
      products: [CLOUD],
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
      products: [CLOUD],
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
      products: [CLOUD],
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
      products: [CLOUD],
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
      products: BOTH,
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
      id: 'report-language',
      label: 'Report printing depends on the user language',
      products: [CLOUD],
      mode: 'guide',
      patterns: [
        { re: /(?:french|fran[cç]ais|spanish|espa[nñ]ol|chinese|language)[\s\S]{0,200}(?:print\w*|report\w*)|(?:print\w*|report\w*)[\s\S]{0,200}(?:french|fran[cç]ais|spanish|espa[nñ]ol|chinese|language)/i, weight: 10 },
        { re: /user|linked|english|posting|journal|error report|standard report/i, weight: 3 }
      ],
      cause: 'When a report prints for users set to one language but not another, the report files used for the other language (each language has its own copy of the standard reports) or that user’s language setup differ, rather than the accounting data.',
      steps: [
        'Confirm the exact report(s) that fail, the module they are printed from and the batch, and print the same batch as an English-linked user for comparison.',
        'Check the language set for the affected users in Administrative Services > Users, and test with one user switched to English and back.',
        'Compare the report files in the module’s French language folder of the Sage 300 programs directory (for example the FRA folder next to ENG) with the English ones, and confirm the French reports exist and are at the same product update (PU) level.',
        'Check whether a Custom Report Profile or customised report location applies to the French users, and print the standard Sage layout to Preview to see whether a message is shown.',
        'If the French report files are missing or older, reapply the product update with the French language component in a test environment first, and note the result on the ticket.'
      ]
    },
    {
      id: 'printing-output',
      label: 'Report printing and print destination',
      products: [CLOUD],
      mode: 'guide',
      patterns: [
        { re: /(?:does\s*n(?:o|')t|will not|won'?t|cannot|can'?t|unable to|fails? to|not)\s+print|no(?:t)? printing|print(?:ing)?\s+(?:error|fail\w*|problem|issue)|nothing prints|blank (?:print|page)/i, weight: 8 },
        { re: /report|invoice|statement|remittance|payslip|cheque|document|printer|spool/i, weight: 3 }
      ],
      cause: 'A document that will not print usually fails at the print destination, the printer or the report layout rather than in the accounting data, so the failure point has to be isolated first.',
      steps: [
        'Confirm the exact report or document name, the company and the selection criteria used when it does not print.',
        'Check the Print Destination in Sage (Printer, Preview, File, E-mail or Schedule) and confirm Preview shows the document.',
        'Print the same selection to a different printer and to PDF, so a printer or driver fault is separated from a Sage layout fault.',
        'Confirm whether the report is a standard Sage layout or a customised one, and whether another workstation or Windows user can print it.',
        'Capture the exact on-screen message, or note that it fails silently, together with a screenshot of the print destination settings.'
      ]
    },
    {
      id: 'posting-errors',
      label: 'Batch posting error',
      products: [CLOUD],
      mode: 'guide',
      patterns: [
        { re: /(?:cannot|can'?t|unable to|will not|won'?t|fails? to|error (?:when|while|on))\s*post\w*|post(?:ing)?\s+(?:error|fail\w*|problem|rejected)|batch (?:is )?(?:stuck|in error)/i, weight: 7 },
        { re: /batch|journal|invoice|entry|transaction|period/i, weight: 2 }
      ],
      cause: 'Posting failures are reported on the posting journal or error report for the batch, and usually trace back to the batch status, the fiscal period or a setup value on one of the entries.',
      steps: [
        'Capture the exact posting error message and the batch number, batch date and module it was posted from.',
        'Print or view the posting journal / posting error report for that batch and note the entries listed on it.',
        'Confirm the fiscal year and period for the batch date are open in Common Services, and that the batch is Open rather than Ready to Post or already posted.',
        'Correct only the entries named on the posting error report in a copy of the data first, then re-post and compare the result.'
      ]
    },
    {
      id: 'language-installation',
      label: 'Language / localisation installation',
      products: [CLOUD],
      mode: 'search',
      patterns: [
        { re: /french|fran[cç]ais|spanish|language pack|multi[- ]?language|langue|localis(?:ation|ed)|localiz(?:ation|ed)/i, weight: 6 },
        { re: /install\w*|setup|activat\w*|licen[cs]\w*|switch|change|display|version|upgrade/i, weight: 3 }
      ],
      cause: 'Which languages can be installed and displayed is determined by the Sage release, the installed language components and the licence, so the entitlement and the installed version have to be confirmed before anything is installed.',
      steps: [
        'Confirm the exact Sage product, version and update (PU) level currently installed, and whether the request is for the program interface language or for regional/localisation settings.',
        'Confirm on the customer licence which languages are included, because the language selection only offers what the installation and licence allow.',
        'Check the installed language components in the Sage installation (add or remove program features) before downloading anything new.',
        'Confirm on the official Sage download/installation material for that exact version that the language is supported, and quote the source on the ticket.',
        'Test the language change on one workstation or in a test company before rolling it out.'
      ]
    },
    {
      id: 'generic',
      label: 'General troubleshooting',
      products: BOTH,
      module: 'unknown',
      mode: 'search',
      patterns: [],
      cause: 'There is not enough evidence in the ticket to classify the query, so the details need to be confirmed before any change is suggested.',
      steps: []
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
   * Ticket facts, missing-context questions and sourced guidance
   * ------------------------------------------------------------------ */

  /** Short, sanitised quote of the recorded query, used inside questions. */
  function shortQuote(value, words) {
    const cleaned = stripSiteCodes(value).replace(/\s+/g, ' ').replace(/^[\s"“”']+|[\s"“”']+$/g, '');
    if (!cleaned) return '';
    const parts = cleaned.split(' ');
    const limit = words || 14;
    return parts.length <= limit ? cleaned : `${parts.slice(0, limit).join(' ')}…`;
  }

  /**
   * Facts taken verbatim from the ticket. Nothing here is inferred, so the
   * reader can tell ticket evidence apart from a rules-based hypothesis.
   */
  function buildTicketFacts(context) {
    const { fields, question, questionSource, errorCodes, attempted, thirdParty } = context;
    const facts = [];
    const recorded = question || fields.summary || context.summaryText;
    facts.push(recorded
      ? `${questionSource}: ${stripSiteCodes(recorded)}`
      : 'No answer to “How would you best describe this query?” is recorded on the ticket.');
    facts.push(...describeProductScope(context.productScope));
    if (fields.version) facts.push(`Version recorded on the ticket: ${stripSiteCodes(fields.version)}`);
    if (fields.errorMessage) facts.push(`Error message recorded on the ticket: ${stripSiteCodes(fields.errorMessage)}`);
    if (errorCodes.length) facts.push(`Error code quoted in the query: ${errorCodes.join(', ')}`);
    if (fields.stepsToReplicate) facts.push(`Steps to replicate recorded: ${stripSiteCodes(fields.stepsToReplicate)}`);
    if (attempted.length) facts.push(`Already reported as done, do not repeat: ${attempted.map((item) => item.label).join('; ')}.`);
    if (thirdParty.products.length) facts.push(`Third-party product named in the query: ${thirdParty.products.join(', ')}.`);
    return facts;
  }

  /** Ticket facts that explain where the product classification came from. */
  function describeProductScope(scope) {
    const facts = [];
    if (scope.source === 'incident-type-group') {
      facts.push(`Incident Type Group recorded on the ticket: ${scope.incidentTypeGroup} → ${scope.product}. Suggestions and resources are limited to ${scope.product}.`);
    } else if (scope.source === 'unrecognised-group') {
      facts.push(`Incident Type Group “${scope.incidentTypeGroup}” is not recognised as Sage 300 Cloud or Sage 300 People, so no product-specific guidance or search is offered.`);
    } else if (scope.source === 'product-field') {
      facts.push(`No Incident Type Group was read from the ticket; product taken from the Product field: ${scope.product}.`);
    } else {
      facts.push('No Incident Type Group or Sage product is recorded on the ticket, so no product-specific guidance or search is offered.');
    }
    if (scope.conflicts.length) {
      const recordedAs = scope.source === 'incident-type-group' ? 'the Incident Type Group is' : 'the product is recorded as';
      facts.push(`Product contradiction: the ticket text mentions ${scope.conflicts.join(', ')}, but ${recordedAs} ${scope.product}. Resources stay limited to ${scope.product}, and no diagnosis is suggested until the product is confirmed.`);
    }
    return facts;
  }

  /**
   * Precise questions built from what this specific query does not say.
   * They replace the old generic "confirm the product, reproduce, collect logs"
   * boilerplate, which was offered even when it answered nothing.
   */
  function buildQuestions(context) {
    const { fields, question, product, errorCodes, attempted, productScope } = context;
    const recorded = question || fields.summary || context.summaryText;
    const quote = shortQuote(recorded);
    const questions = [];
    if (!quote) {
      questions.push('The ticket records no answer to “How would you best describe this query?”. Ask the customer what they were doing, what happened and what they expected to happen.');
      questions.push('Ask which Sage product, version and update level is affected, and which screen or report the query is about.');
      return questions;
    }
    if (productScope && productScope.conflicts.length) {
      questions.push(`Ask the customer to confirm whether “${quote}” is about ${product} or ${productScope.conflicts[0]}; the query text and the product logged on the ticket differ.`);
    }
    if (product === PRODUCT_UNKNOWN) {
      questions.push(`Ask which Sage product (Sage 300 Cloud or Sage 300 People), version and update level applies to “${quote}”; the ticket does not confirm it.`);
    }
    if (/error|fail|cannot|can'?t|unable|does ?n(?:o|')t|not work|problem|issue|reject/i.test(recorded) && !fields.errorMessage && !errorCodes.length) {
      questions.push(`Ask for the exact on-screen message, or a screenshot, shown when “${quote}”.`);
    }
    if (!fields.stepsToReplicate) {
      questions.push(`Ask for the screen, menu path and steps followed when “${quote}”.`);
    }
    if (!fields.resolutionsAttempted && !attempted.length) {
      questions.push('Ask what has already been tried for this query and what the result of each attempt was.');
    }
    questions.push(`Ask whether “${quote}” affects one user, one workstation or everyone, and when it last worked.`);
    return questions.slice(0, 5);
  }

  /**
   * Guidance that can be attributed to a source: curated local entries and,
   * when live retrieval is enabled, the official Sage results that actually
   * matched. Retrieved results contribute a cited title and extract only —
   * article steps are never invented from a title.
   */
  // URLs and slugs write product names with hyphens (sage-300-people).
  const productText = (value) => text(value).replace(/[-_/+]+/g, ' ');

  /** Products other than the ticket's product that a text names. */
  function otherProductsIn(value, product) {
    const source = productText(value);
    return PRODUCT_MENTIONS.filter((item) => item.label !== product && item.match.test(source)).map((item) => item.label);
  }

  /** True when a text names the given product. */
  function mentionsProduct(value, product) {
    const entry = PRODUCT_MENTIONS.find((item) => item.label === product);
    return Boolean(entry) && entry.match.test(productText(value));
  }

  function buildSourcedGuidance(knowledge, sources, product) {
    const items = [];
    (knowledge || []).forEach((entry) => {
      items.push({
        kind: 'local',
        title: text(entry.title),
        source: text(entry.source) || 'Local knowledge base',
        url: entry.links && entry.links.length ? text(entry.links[0].url) : '',
        steps: (entry.steps || []).slice(),
        detail: 'Curated local entry. Confirm it against the official Sage material before advising a change.'
      });
    });
    if (sources && sources.enabled !== false && Array.isArray(sources.results)) {
      const known = Boolean(product) && product !== PRODUCT_UNKNOWN;
      // A result naming another product is never offered, even when the same
      // keywords appear in it.
      const crossProduct = (result) => known
        && otherProductsIn(`${text(result.title)} ${text(result.snippet)} ${text(result.url)}`, product).length > 0;
      sources.results.filter((result) => result && !crossProduct(result)).slice(0, 3).forEach((result) => {
        const title = text(result.title);
        const url = text(result.url);
        if (!title || !/^https:\/\//i.test(url)) return;
        const snippet = text(result.snippet);
        const productVerified = known && result.productVerified === true;
        const caveat = productVerified ? '' : `Product not confirmed${known ? ` for ${product}` : ''}, so this is not product-specific advice. `;
        items.push({
          kind: 'retrieved',
          title,
          source: text(result.source) || 'Official Sage source',
          url,
          snippet,
          articleId: text(result.articleId),
          productVerified,
          steps: [],
          detail: caveat + (snippet
            ? 'Retrieved title and extract only. Open the article and confirm its instructions before advising the customer.'
            : 'Retrieved title only. Open the article and confirm its content before advising the customer.')
        });
      });
    }
    return items;
  }

  /** Describe whether official Sage retrieval produced anything usable. */
  function describeSourceState(sources) {
    if (!sources || sources.enabled === false) {
      return {
        enabled: false,
        available: false,
        unavailable: [],
        message: 'Live Sage retrieval is switched off, so no official Sage article has been read for this ticket.'
      };
    }
    const unavailable = (sources.unavailable || [])
      .map((item) => (typeof item === 'string'
        ? { name: item, reason: '' }
        : { name: text(item && item.name), reason: text(item && item.reason) }))
      .filter((item) => item.name);
    const matched = Array.isArray(sources.results) ? sources.results.length : 0;
    const listed = unavailable.map((item) => (item.reason ? `${item.name} — ${item.reason}` : item.name)).join('; ');
    return {
      enabled: true,
      available: matched > 0,
      unavailable,
      message: matched
        ? `${matched} official Sage result${matched === 1 ? '' : 's'} matched this query${listed ? `; unavailable: ${listed}` : ''}.`
        : `No official Sage result matched this query${listed ? `; unavailable: ${listed}` : ''}.`
    };
  }

  /* ------------------------------------------------------------------ *
   * Resource links
   * ------------------------------------------------------------------ */

  // Knowledgebase routes:
  //  - /portal/app/portlets/results/viewsearch.jsp is retired (HTTP 404) and is
  //    never used.
  //  - /portal/app/portlets/results/viewsolution.jsp opens one article and needs
  //    a real solutionid, so it is never constructed; it is only shown when a
  //    retrieved result or a curated entry links to it.
  //  - /portal/ss/?querytext=… is the search route, pre-filled for every confirmed
  //    product (NetAdminSources.KB_SEARCH_ROUTES): filtered by a fully known
  //    product alias, or with the product name added to the search text.
  // Google is always a manual click-through and is never read automatically.
  const GOOGLE = 'https://www.google.com/search?q=';
  const COMMUNITY = 'https://communityhub.sage.com/search?q=';

  // Search operators that keep each product's searches on that product,
  // independent of the keyword phrase.
  const PRODUCT_SEARCH = {
    [CLOUD]: { kbSites: 'site:za-kb.sage.com OR site:us-kb.sage.com', constraint: '"Sage 300" -"Sage 300 People"', keyword: 'Sage 300 Cloud' },
    [PEOPLE]: { kbSites: 'site:za-kb.sage.com', constraint: '"Sage 300 People"', keyword: 'Sage 300 People' }
  };

  function kbRoutesFor(product) {
    const sources = root.NetAdminSources;
    return sources && typeof sources.kbSearchRoutes === 'function' ? sources.kbSearchRoutes(product) : [];
  }

  /**
   * Build the search links for the keyword phrase. The product constraint is
   * added to each link separately; with no confirmed product nothing is
   * presented as product-specific.
   */
  function buildResourceLinks(query, product) {
    const phrase = text(query);
    const scope = PRODUCT_SEARCH[product];
    const links = [];
    const quoted = `“${phrase}”`;
    if (scope) {
      const routes = kbRoutesFor(product);
      routes.forEach((route) => links.push({
        id: `${route.sourceId}-search`,
        name: `${route.name} — ${product} search`,
        title: `${route.name} · ${product} search: ${phrase}`,
        url: root.NetAdminSources.buildKbSearchUrl(route, phrase),
        kind: 'search',
        productScoped: Boolean(route.alias),
        note: route.alias
          ? `Pre-filled Knowledgebase search limited to the ${product} search alias (${route.alias}). Open each article and confirm it applies to ${product}.`
          : `Pre-filled Knowledgebase search with “${route.keyword || product}” added to the search text (no confirmed ${product} search alias for this Knowledgebase, so results are not filtered by product). Open each article and confirm it applies to ${product}.`
      }));
      routes.filter((route) => route.alias).forEach((route) => links.push({
        id: `${route.sourceId}-browse`,
        name: `${route.name} — ${product} articles`,
        title: `${route.name} · ${product} articles (no search text)`,
        url: root.NetAdminSources.buildKbBrowseUrl(route),
        kind: 'home',
        productScoped: true,
        note: `The Knowledgebase with only ${product} selected, to refine the search by hand.`
      }));
      const prefilled = routes.map((route) => route.sourceId);
      [['kb-za', 'Sage Knowledgebase (ZA)', 'https://za-kb.sage.com/'], ['kb-us', 'Sage Knowledgebase (US)', 'https://us-kb.sage.com/']]
        .filter(([id]) => !prefilled.includes(id) && (id === 'kb-za' || product === CLOUD))
        .forEach(([id, name, url]) => links.push({
          id,
          name: `${name} home`,
          title: `${name} — select ${product} and search for ${quoted}`,
          url,
          kind: 'home',
          productScoped: false,
          note: `No verified ${product} search alias is configured for this Knowledgebase, so the search cannot be pre-filled. Open it, filter on ${product} and search for the phrase above.`
        }));
      links.push({
        id: 'kb-site-search',
        name: `Sage Knowledgebase via Google site search — ${product} (manual click-through)`,
        title: `Sage Knowledgebase via Google site search — ${product}: ${phrase}`,
        url: `${GOOGLE}${encodeURIComponent(`${scope.kbSites} ${scope.constraint} ${phrase}`)}`,
        kind: 'manual',
        productScoped: false,
        note: `Google restricted to the Sage Knowledgebase and to ${product} wording. Nothing is retrieved automatically; confirm the product on each article.`
      });
      links.push({
        id: 'community',
        name: 'Sage Community Hub',
        title: `Sage Community Hub · ${product}: ${phrase}`,
        url: `${COMMUNITY}${encodeURIComponent(`${scope.keyword} ${phrase}`)}`,
        kind: 'search',
        productScoped: false,
        note: `Keyword search including the product name; Community Hub results are not filtered by product, so confirm each thread is about ${product}.`
      });
      links.push({
        id: 'google',
        name: 'Google (opens in a new tab)',
        title: `Google · ${product}: ${phrase}`,
        url: `${GOOGLE}${encodeURIComponent(`${scope.constraint} ${phrase}`)}`,
        kind: 'manual',
        productScoped: false,
        note: 'Manual click-through only; Google is never read automatically.'
      });
      return links;
    }
    const unconfirmed = 'Product not confirmed (Incident Type Group missing or not recognised), so no product-filtered search is offered';
    [['kb-za', 'Sage Knowledgebase (ZA)', 'https://za-kb.sage.com/'], ['kb-us', 'Sage Knowledgebase (US)', 'https://us-kb.sage.com/']]
      .forEach(([id, name, url]) => links.push({
        id,
        name: `${name} home`,
        title: `${name} — search for ${quoted} on the site`,
        url,
        kind: 'home',
        productScoped: false,
        note: `${unconfirmed}. The Knowledgebase search cannot be pre-filled; confirm the product first.`
      }));
    links.push({
      id: 'kb-site-search',
      name: 'Sage Knowledgebase via Google site search (manual click-through)',
      title: `Sage Knowledgebase via Google site search: ${phrase}`,
      url: `${GOOGLE}${encodeURIComponent(`site:za-kb.sage.com OR site:us-kb.sage.com ${phrase}`)}`,
      kind: 'manual',
      productScoped: false,
      note: `${unconfirmed}. Nothing is retrieved automatically.`
    });
    links.push({
      id: 'community',
      name: 'Sage Community Hub',
      title: `Sage Community Hub: ${phrase}`,
      url: `${COMMUNITY}${encodeURIComponent(phrase)}`,
      kind: 'search',
      productScoped: false,
      note: `${unconfirmed}.`
    });
    links.push({
      id: 'google',
      name: 'Google (opens in a new tab)',
      title: `Google: Sage ${phrase}`,
      url: `${GOOGLE}${encodeURIComponent(`Sage ${phrase}`)}`,
      kind: 'manual',
      productScoped: false,
      note: 'Manual click-through only; Google is never read automatically.'
    });
    return links;
  }

  /* ------------------------------------------------------------------ *
   * Topic selection
   * ------------------------------------------------------------------ */

  /**
   * Every rule is scoped to the products its steps were written for. With an
   * unconfirmed product only rules written for both products can apply, so
   * product-specific guidance is never offered on a guess.
   */
  function ruleAppliesTo(rule, product) {
    const products = rule.products || [];
    return product === PRODUCT_UNKNOWN ? BOTH.every((item) => products.includes(item)) : products.includes(product);
  }

  function scoreRule(rule, haystack, product, moduleId) {
    if (!rule.patterns.length) return 0;
    if (!ruleAppliesTo(rule, product)) return 0;
    if (product === PEOPLE && rule.module && !['people', 'si'].includes(rule.module) && rule.id !== 'third-party-compatibility') return 0;
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
    if (rule.products.length === 1 && rule.products[0] === product) score += 2;
    if (rule.module && rule.module === moduleId) score += 1;
    return score;
  }

  /* ------------------------------------------------------------------ *
   * Customer-safe reply
   * ------------------------------------------------------------------ */

  /** Customer and contact name words, removed from every search phrase. */
  function customerWords(ticket) {
    return [ticket.customer && ticket.customer.contactName, ticket.customer && ticket.customer.companyName, ticket.contactName, ticket.customerName]
      .map(text).join(' ').split(/\s+/).filter((word) => word.length > 1);
  }

  function safeName(ticket) {
    const name = text(ticket.customer && ticket.customer.contactName) || text(ticket.contactName) || text(ticket.customerName);
    return name.replace(/[\r\n<>]/g, '').split(' ')[0] || 'there';
  }

  // The panel lists the questions for the consultant ("Ask ..."); the draft
  // reply has to put the same question to the customer.
  const CUSTOMER_PHRASING = [
    [/^The ticket records no answer[\s\S]*$/i, 'Please describe what you were doing, what happened and what you expected to happen.'],
    [/^Ask the customer to /i, 'Please '],
    [/^Ask for /i, 'Please send us '],
    [/^Ask what /i, 'Please tell us what '],
    [/^Ask whether /i, 'Please confirm whether '],
    [/^Ask which /i, 'Please confirm which ']
  ];

  function customerPhrasing(question) {
    const value = text(question);
    for (const [pattern, replacement] of CUSTOMER_PHRASING) {
      if (pattern.test(value)) return value.replace(pattern, replacement);
    }
    return value;
  }

  function buildReply(context, guidance, sourceState) {
    const { name, reference, summaryLine, areaLine, attemptedLine, steps, questions, mode } = context;
    // Only results confirmed for the ticket's product are put to the customer.
    const items = Array.isArray(guidance) ? guidance.filter((item) => item.kind === 'retrieved' && item.productVerified) : [];
    const lines = [];
    lines.push(`Good day ${name}`);
    lines.push('');
    lines.push(`Thank you for logging ${reference}.`);
    if (summaryLine) lines.push(`Our understanding of your query: ${summaryLine}`);
    lines.push(areaLine);
    if (attemptedLine) lines.push(attemptedLine);
    if (steps.length) {
      lines.push('');
      lines.push('Based on the query as recorded, the checks we suggest are:');
      steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    }
    if (questions.length) {
      lines.push('');
      lines.push(steps.length
        ? 'To confirm this we still need the following from you:'
        : 'We do not yet have a validated step for this query, so we first need the following from you:');
      questions.forEach((question) => lines.push(`- ${customerPhrasing(question)}`));
    }
    if (items.length) {
      lines.push('');
      lines.push('Official Sage material that matches your query (we will confirm the detail in the article before advising a change):');
      items.forEach((item) => lines.push(`- ${item.title} (${item.source}): ${item.url}`));
    } else if (sourceState && sourceState.enabled) {
      lines.push('');
      lines.push('No official Sage article could be matched to this query at the moment, so the checks above come from the recorded query and our local support rules only.');
    }
    lines.push('');
    lines.push(mode === 'search'
      ? 'These are suggested checks based on the information logged. We will confirm the documented answer before advising a change.'
      : 'These are suggested checks based on the information logged, and we will confirm the outcome with you before any change is made in your live data.');
    lines.push('');
    lines.push('Kind regards');
    return lines.join('\n');
  }

  /**
   * Re-apply live Sage retrieval to a completed analysis.
   * Pure and idempotent, so the side panel can call it again after every
   * refresh and the panel and the draft reply always agree, including when
   * retrieval is switched off or unavailable.
   */
  function applySources(result, sources) {
    if (!result || typeof result !== 'object' || !result.replyContext) return result;
    const guidance = buildSourcedGuidance(result.knowledge, sources, result.product);
    const state = describeSourceState(sources);
    return Object.assign({}, result, {
      sourcedGuidance: guidance,
      sourceState: state,
      reply: buildReply(result.replyContext, guidance, state),
      analysis: Object.assign({}, result.analysis, {
        solution: Object.assign({}, result.analysis.solution, { sourcedGuidance: guidance, sourceState: state })
      })
    });
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
    const productScope = resolveProduct(ticket, fields);
    const product = productScope.product;
    const contradiction = productScope.conflicts.length > 0;
    const intent = summaryText;
    let moduleInfo = detectModule(intent);
    const productConflict = contradiction || (product === PEOPLE && !['unknown', 'people', 'si'].includes(moduleInfo.id));
    const thirdParty = detectThirdParty(intent);

    let best = RULES[RULES.length - 1];
    let bestScore = 0;
    // A query that names a different product than the one logged gets no
    // rules-based diagnosis until the product is confirmed.
    if (!contradiction) RULES.forEach((rule) => {
      const score = scoreRule(rule, intent, product, moduleInfo.id);
      if (score > bestScore) {
        best = rule;
        bestScore = score;
      }
    });
    // Without a product, product-specific rules are withheld; say which one
    // would apply so the agent knows the Incident Type Group is the blocker.
    let withheld = null;
    if (best.id === 'generic' && product === PRODUCT_UNKNOWN && !contradiction) {
      let withheldScore = 0;
      RULES.forEach((rule) => {
        const candidates = rule.products.map((item) => scoreRule(rule, intent, item, moduleInfo.id));
        const score = Math.max(0, ...candidates);
        if (score > withheldScore) {
          withheld = rule;
          withheldScore = score;
        }
      });
    }
    if (best.id === 'generic') moduleInfo = { id: 'unknown', label: 'Module not identified' };
    else if (best.module && best.module !== 'unknown' && best.module !== 'si') {
      moduleInfo = MODULES.find((module) => module.id === best.module) || moduleInfo;
      moduleInfo = { id: moduleInfo.id, label: moduleInfo.label };
    }

    const attempted = detectAlreadyAttempted(ticket);
    let ruleSteps = pruneSteps(best.steps, attempted);
    if (thirdParty.products.length && best.id !== 'third-party-compatibility') {
      ruleSteps = ruleSteps.concat(`Confirm the supported version of ${thirdParty.products[0]} for this Sage release with the vendor before changing anything.`);
    }

    const errorCodes = extractErrorCodes(intent);
    const factContext = { fields, question, questionSource, summaryText, product, productScope, errorCodes, attempted, thirdParty };
    const facts = buildTicketFacts(factContext);
    const questions = buildQuestions(factContext);
    const hypotheses = ruleSteps.map((step) => ({ text: step, source: `Local rule: ${best.label}` }));
    // Without a matched rule there is no validated step, so the panel and the
    // reply ask for the missing context instead of repeating boilerplate.
    const stepList = hypotheses.length ? hypotheses.map((item) => item.text) : questions.slice();

    const query = buildSearchPhrase(intent, { exclude: customerWords(ticket) }) || 'support';
    const links = buildResourceLinks(query, product);

    const knowledge = contradiction ? [] : matchKnowledge(options.knowledge || [], { haystack: intent, product, moduleId: moduleInfo.id, topicId: best.id });
    const guidance = buildSourcedGuidance(knowledge, options.sources, product);
    const sourceState = describeSourceState(options.sources);

    const evidence = [];
    if (productScope.incidentTypeGroup) evidence.push(`Incident Type Group: ${productScope.incidentTypeGroup}`);
    if (question) evidence.push(`${questionSource}: ${stripSiteCodes(question)}`);
    else if (fields.summary) evidence.push(`Summary field: ${stripSiteCodes(fields.summary)}`);
    if (fields.stepsToReplicate) evidence.push(`Steps to replicate: ${stripSiteCodes(fields.stepsToReplicate)}`);
    if (fields.resolutionsAttempted) evidence.push(`Resolutions attempted: ${stripSiteCodes(fields.resolutionsAttempted)}`);
    if (thirdParty.products.length) evidence.push(`Third-party product mentioned: ${thirdParty.products.join(', ')}`);
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

    const replyContext = {
      name: safeName(ticket),
      reference: text(ticket.incidentReference) || text(ticket.ticketId) || 'your ticket',
      summaryLine: summary && !/^No \u201CSummary/.test(summary) ? stripSiteCodes(summary) : '',
      areaLine: best.id === 'generic'
        ? 'We cannot yet identify a specific cause or module from the recorded query.'
        : `A possible area to check is ${best.label.toLowerCase()}${product === 'Sage product not specified' ? '' : ` in ${product}`}; this is not a confirmed diagnosis.`,
      attemptedLine: attempted.length
        ? `We can see the following has already been done, so we will not ask you to repeat it: ${attempted.map((item) => item.label).join('; ')}.`
        : '',
      steps: hypotheses.map((item) => item.text),
      questions: hypotheses.length ? questions.slice(0, 3) : questions.slice(),
      mode: best.mode
    };

    return {
      ticketId: text(ticket.incidentReference) || text(ticket.ticketId) || 'Unknown ticket',
      product,
      productScope,
      module: moduleInfo,
      summary,
      querySummary,
      questionSource,
      fields,
      query,
      searchTerms: normalizeTerms(query),
      errorCodes,
      thirdParty,
      topic,
      knowledge,
      sourcedGuidance: guidance,
      sourceState,
      replyContext,
      reply: buildReply(replyContext, guidance, sourceState),
      analysis: {
        rootCause: {
          content: best.id === 'generic'
            ? (withheld
              ? `The query matches the ${withheld.label.toLowerCase()} checks for ${withheld.products.join(' / ')}, but ${productScope.source === 'unrecognised-group' ? `the Incident Type Group “${productScope.incidentTypeGroup}” is not recognised as Sage 300 Cloud or Sage 300 People` : 'no Incident Type Group was read from the ticket'}, so product-specific checks and Knowledgebase searches are withheld. Make sure the correct Incident Type Group is shown on the ticket page and analyse again, or confirm the product with the customer.`
              : `${contradiction ? `The query mentions ${productScope.conflicts.join(', ')} but the ticket is logged for ${product}; the product must be confirmed before any guidance is applied. ` : productConflict ? 'The selected product and described workflow may conflict. ' : ''}The recorded query does not provide enough evidence to identify a specific cause or module. Confirm the affected workflow before applying any module-specific guidance.`)
            : `Suggested area: ${best.label}. ${best.cause} This is a rules-based suggestion, not a confirmed root cause.`,
          confidence,
          evidence
        },
        solution: {
          content: hypotheses.length
            ? `Suggested checks for ${product}${moduleInfo.id === 'unknown' ? '' : ` \u00B7 ${moduleInfo.label}`}, derived from the recorded query:`
            : 'No validated step can be derived from the recorded query yet. Confirm the following before suggesting any change:',
          steps: stepList,
          facts,
          hypotheses,
          questions,
          sourcedGuidance: guidance,
          sourceState,
          sufficiency: hypotheses.length ? 'rules' : 'questions'
        },
        searchResults: [{ query, results: { guides: { source: 'Sage searches (click to open)', results: links } } }]
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
      // Entries must be scoped to the ticket's confirmed product. Unscoped
      // entries, and every entry when the product is not confirmed, are skipped.
      const products = entryProducts(entry);
      if (context.product === PRODUCT_UNKNOWN || !products.includes(context.product)) return;
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
      if (products.length === 1) score += 2;
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
        products,
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

  function entryProducts(entry) {
    const listed = Array.isArray(entry.products) ? entry.products.map(text).filter(Boolean) : [];
    if (listed.length) return listed;
    return text(entry.product) ? [text(entry.product)] : [];
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
    const prompted = analyseTicket({
      subject: question,
      description: question,
      incidentTypeGroup: current.productScope.incidentTypeGroup,
      product: current.productScope.productField
    }, options);
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
    resolveProduct,
    classifyProduct,
    extractIssueCodes,
    otherProductsIn,
    mentionsProduct,
    detectModule,
    detectThirdParty,
    detectAlreadyAttempted,
    buildResourceLinks,
    applySources,
    matchKnowledge,
    rankSimilarTickets,
    similarTickets,
    rankQueue,
    chat,
    RULES,
    MODULE_GUIDES,
    PRODUCT_UNKNOWN,
    PRODUCT_LABELS: Object.freeze(BOTH.slice())
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
