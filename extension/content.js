/**
 * Content Script
 * Runs on NetAdmin pages, scrapes ticket data
 */

console.log('[NetAdmin Assistant] Content script loaded');

// Listen for messages from popup/sidepanel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeTicket') {
    const ticketData = scrapeCurrentTicket();
    sendResponse({ success: true, data: ticketData });
  }
  if (request.action === 'scrapeQueue') {
    sendResponse({ success: true, data: scrapeQueues() });
  }
});

/**
 * Scrape ticket information from NetAdmin page
 * Adjust selectors based on actual NetAdmin DOM structure
 */
function scrapeCurrentTicket() {
  const ticketData = {
    ticketId: '',
    incidentReference: '',
    subject: '',
    outline: '',
    description: '',
    rawLoggedText: '',
    question: '',
    questionSource: '',
    product: '',
    incidentTypeGroup: '',
    module: '',
    customerName: '',
    customerEmail: '',
    status: '',
    priority: '',
    attachments: [],
    actions: [],
    metadata: {}
  };

  try {
    // Try multiple selectors for ticket ID
    ticketData.ticketId =
      document.querySelector('[data-ticket-id]')?.textContent ||
      document.querySelector('.ticket-id')?.textContent ||
      document.querySelector('h1')?.textContent?.match(/\d+/)?.[0] ||
      '';

    // Subject/Title
    ticketData.subject =
      document.querySelector('[data-ticket-subject]')?.textContent ||
      document.querySelector('.ticket-subject')?.textContent ||
      document.querySelector('h1')?.textContent ||
      'Untitled';

    // Description/Body
    ticketData.description =
      document.querySelector('[data-ticket-description]')?.textContent ||
      document.querySelector('.ticket-description')?.textContent ||
      document.querySelector('.ticket-body')?.textContent ||
      '';

    // Customer info
    ticketData.customerName =
      document.querySelector('[data-customer-name]')?.textContent ||
      document.querySelector('.customer-name')?.textContent ||
      '';

    ticketData.customerEmail =
      document.querySelector('[data-customer-email]')?.textContent ||
      document.querySelector('.customer-email')?.textContent ||
      '';

    // Status and Priority
    ticketData.status =
      document.querySelector('[data-ticket-status]')?.textContent ||
      document.querySelector('.ticket-status')?.textContent ||
      'open';

    ticketData.priority =
      document.querySelector('[data-ticket-priority]')?.textContent ||
      document.querySelector('.ticket-priority')?.textContent ||
      'medium';

    // Attachments
    const attachmentElements = document.querySelectorAll('[data-attachment], .attachment');
    attachmentElements.forEach((el) => {
      const name = el.querySelector('[data-filename], .filename')?.textContent || 'unknown';
      const type = el.getAttribute('data-type') || 'application/octet-stream';
      ticketData.attachments.push({
        name,
        type,
        url: el.href || el.getAttribute('data-url')
      });
    });

    // Additional metadata
    ticketData.metadata.currentUrl = window.location.href;
    ticketData.metadata.scrapedAt = new Date().toISOString();
    ticketData.metadata.pageTitle = document.title;

    // Incident reference (WF number) used on the reply and for caching
    ticketData.incidentReference =
      document.querySelector('[data-incident-reference]')?.textContent?.trim() ||
      document.body.textContent?.match(/\bWF\d{4,}\b/)?.[0] ||
      ticketData.ticketId;

    // Full logged text so the analyzer can read the NetAdmin webform fields
    ticketData.rawLoggedText = readLoggedText();
    ticketData.question = readQuestionAnswer();
    if (ticketData.question) ticketData.questionSource = 'How would you best describe this query?';
    ticketData.outline =
      document.querySelector('[data-ticket-outline], .ticket-outline')?.textContent?.trim() ||
      ticketData.subject;
    ticketData.product = readLabelledValue(/^product$/i);
    ticketData.incidentTypeGroup = readIncidentTypeGroup();
    ticketData.module = readLabelledValue(/^(module|area|category)$/i);
    ticketData.actions = readActionHistory();

    console.log('[NetAdmin Assistant] Ticket scraped:', ticketData);
  } catch (error) {
    console.error('[NetAdmin Assistant] Scraping error:', error);
  }

  return ticketData;
}

const QUESTION_LABEL = /^how would you best describe this query\s*\??\s*[:*]?\s*$/i;

// The query answer ends where the next webform question, page section or
// the Ticket Survey starts; none of that is part of the query.
const ANSWER_END_ANYWHERE = /\bticket\s+survey\b/i;
const ANSWER_END_LINE = /\n\s*(?:(?:summary of the query|summary|describe the resolutions attempted|resolutions attempted|detail the steps to replicate|steps to replicate|incident\s*type\s*group|product|module|version|site code|customer code|error message|outcome you are working towards)\s*(?:[:?*\-]|\n|$)|(?:customer\s+survey|survey\s+(?:questions?|responses?|results?)|how\s+satisfied\b[^\n]*|how\s+would\s+you\s+rate\b[^\n]*|how\s+likely\s+are\s+you\b[^\n]*|overall\s+satisfaction|net\s+promoter(?:\s+score)?|survey|outline|attachments?|actions?|action history|notes?|history|resolution|rating|comments?|feedback)\s*:?\s*(?:\n|$))/i;

function cutAnswer(value) {
  let out = String(value || '').replace(/^\s*how would you best describe this query\s*\??\s*[:*]?\s*/i, '');
  const anywhere = ANSWER_END_ANYWHERE.exec(out);
  if (anywhere) out = out.slice(0, anywhere.index);
  const line = ANSWER_END_LINE.exec(`${out}\n`);
  if (line) out = out.slice(0, line.index);
  return out.trim();
}

const SECTION_HEADINGS = 'h1, h2, h3, h4, h5, legend, .panel-heading, .card-header, .section-title';
const SURVEY_CONTAINER = '[id*="survey" i], [class*="survey" i], [data-section*="survey" i], [aria-label*="survey" i]';

/** True when the element sits in the Ticket Survey part of the page. */
function inSurvey(element) {
  try {
    if (element?.closest?.(SURVEY_CONTAINER)) return true;
  } catch (error) {
    // Older engines without the case-insensitive selector flag.
    if (element?.closest?.('[id*="survey"], [class*="survey"], [id*="Survey"], [class*="Survey"]')) return true;
  }
  // A section headed "Ticket Survey" without a survey id or class: the
  // nearest ancestor with headings decides, so a page-wide container that
  // also holds the Outline section never counts as the survey.
  for (let node = element?.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth += 1) {
    const headings = Array.from(node.querySelectorAll?.(SECTION_HEADINGS) || []).map((item) => item.textContent || '');
    if (!headings.length) continue;
    if (headings.some((heading) => /^\s*outline\b|how would you best describe this query/i.test(heading))) return false;
    if (headings.some((heading) => /^\s*(?:ticket\s+)?survey\b/i.test(heading))) return true;
  }
  return false;
}

/** True when the element sits in the Outline section of the ticket. */
function inOutline(element) {
  for (let node = element?.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth += 1) {
    if (/outline/i.test(`${node.id || ''} ${typeof node.className === 'string' ? node.className : ''}`)) return true;
    const heading = node.querySelector?.(SECTION_HEADINGS);
    if (heading && /^\s*outline\b/i.test(heading.textContent || '')) return true;
  }
  return false;
}

/**
 * Read the answer to "How would you best describe this query?" from the
 * Outline section, without pulling in adjacent labels, page chrome or the
 * Ticket Survey. Labels inside the Outline section are preferred; labels in
 * a survey are never used.
 */
function readQuestionAnswer() {
  const labels = Array.from(document.querySelectorAll('label, th, dt, strong, b, span, td, div, p'))
    .filter((label) => QUESTION_LABEL.test((label.textContent || '').trim()) && !inSurvey(label));
  labels.sort((a, b) => Number(inOutline(b)) - Number(inOutline(a)));
  for (const label of labels) {
    const target = label.getAttribute('for') && document.getElementById(label.getAttribute('for'));
    const candidates = [target, label.nextElementSibling, label.parentElement?.nextElementSibling];
    if (label.parentElement && label.parentElement.textContent !== label.textContent) {
      candidates.push(label.parentElement);
    }
    for (const candidate of candidates) {
      if (!candidate || inSurvey(candidate)) continue;
      const control = candidate.matches?.('input, textarea, select') ? candidate
        : candidate.querySelector?.('input, textarea, select');
      const answer = cutAnswer(control?.value || candidate.value || candidate.innerText || candidate.textContent || '');
      if (answer && !QUESTION_LABEL.test(answer)) return answer.slice(0, 4000);
    }
  }
  for (const control of document.querySelectorAll('textarea[aria-label], input[aria-label], textarea[name], input[name]')) {
    if (inSurvey(control)) continue;
    if (/how would you best describe this query|describe.?this.?query/i.test(
      `${control.getAttribute('aria-label') || ''} ${control.getAttribute('name') || ''}`
    )) return cutAnswer(control.value || '').slice(0, 4000);
  }
  return '';
}

const GROUP_LABEL = /^incident\s*type\s*group\s*[:*]?\s*[:*]?$/i;
const GROUP_INLINE = /^incident\s*type\s*group\s*[:*]?\s*[:\-]\s*(.+)$/i;
const GROUP_PLACEHOLDER = /^(?:-+\s*)?(?:please\s+)?(?:select|choose|none|n\/a)\b/i;

function isFormControl(element) {
  if (!element) return false;
  if (typeof element.matches === 'function') return element.matches('select, input, textarea');
  return /^(?:select|input|textarea)$/i.test(element.tagName || '');
}

/** Text shown for a control: the selected option's label, not its id value. */
function controlText(control) {
  if (!control) return '';
  if ((control.tagName && /^select$/i.test(control.tagName)) || control.selectedOptions) {
    const option = control.selectedOptions?.[0] || control.options?.[control.selectedIndex];
    if (option) return (option.text || option.textContent || option.label || '').trim();
  }
  return (control.value || '').trim();
}

// Stops an inline "label: value" read from running into the next field.
const NEXT_FIELD = /\s+(?:product|module|incident\s*type|priority|status|stage|category|sub[- ]?category|assigned\s*to|logged\s*by|site\s*code|customer)\s*[:\-]/i;

// A product group value as NetAdmin shows it, e.g. "Support-Sage 300 Cloud".
const GROUP_VALUE = /\bsage\s*300\s*(?:cloud|people)\b/i;
// Visible text of common dropdown widgets that hide the real <select>/<input>.
const WIDGET_TEXT = '.k-input-value-text, .k-input, .k-dropdown-wrap .k-input, .select2-selection__rendered, .chosen-single span, [role="combobox"], .dropdown-toggle, .selected-text';

function cleanGroupValue(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim().split(NEXT_FIELD)[0].trim();
  if (!cleaned || cleaned.length > 120 || GROUP_LABEL.test(cleaned) || GROUP_PLACEHOLDER.test(cleaned)) return '';
  // Hidden inputs often hold the group's numeric/GUID id, which is not the group.
  if (/^[\d\s-]+$/.test(cleaned) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(cleaned)) return '';
  return cleaned;
}

/** Values a label's neighbour can show: widget text, select option, then plain text. */
function candidateValues(candidate) {
  if (!candidate) return [];
  const values = [];
  if (isFormControl(candidate)) {
    values.push(controlText(candidate));
    return values;
  }
  const widget = candidate.querySelector?.(WIDGET_TEXT);
  if (widget) values.push(widget.innerText || widget.textContent || widget.value || '');
  const select = candidate.querySelector?.('select');
  if (select) values.push(controlText(select));
  const control = candidate.querySelector?.('input:not([type="hidden"]), textarea');
  if (control) values.push(controlText(control));
  const hidden = candidate.querySelector?.('input[type="hidden"]');
  if (hidden) values.push(controlText(hidden));
  // Plain text is only safe when it is not the full option list of a <select>.
  if (!select) values.push(candidate.innerText || candidate.textContent || '');
  return values;
}

function isVisible(element) {
  if (!element) return false;
  if (typeof element.getClientRects === 'function') return element.getClientRects().length > 0;
  return true;
}

/**
 * Read the NetAdmin "Incident Type Group" (for example
 * "Support-Sage 300 Cloud"). It is rendered as a label next to a value, a
 * label bound to a select/input or dropdown widget, a single "label: value"
 * element or a named control, so each variation is tried. A value naming a
 * Sage 300 product is preferred over anything else that was found (such as
 * a hidden id), so a widget's hidden input can never hide the visible group.
 */
function readIncidentTypeGroup() {
  const found = [];
  const consider = (value) => {
    const cleaned = cleanGroupValue(value);
    if (cleaned && !found.includes(cleaned)) found.push(cleaned);
  };
  const elements = document.querySelectorAll('label, th, dt, dd, td, span, strong, b, div, p');
  for (const element of elements) {
    const own = (element.textContent || '').replace(/\s+/g, ' ').trim();
    if (own.length < 200 && /incident\s*type\s*group/i.test(own) && inSurvey(element)) continue;
    if (own.length < 200) {
      const inline = GROUP_INLINE.exec(own);
      if (inline) consider(inline[1]);
      if (inline && GROUP_VALUE.test(inline[1])) break;
    }
    if (!GROUP_LABEL.test(own)) continue;
    const forId = element.getAttribute?.('for');
    const target = forId ? document.getElementById(forId) : null;
    const row = element.parentElement;
    const candidates = [
      target,
      target?.parentElement,
      element.nextElementSibling,
      row?.nextElementSibling,
      row?.parentElement?.nextElementSibling
    ];
    for (const candidate of candidates) candidateValues(candidate).forEach(consider);
    if (found.some((value) => GROUP_VALUE.test(value))) break;
    // Label and value in one row with no separator: "Incident type group Support-Sage 300 Cloud".
    if (row && !row.querySelector?.('select')) {
      const rowText = (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim();
      const rest = rowText.replace(/^.*?incident\s*type\s*group\s*[:*]?\s*[:\-]?\s*/i, '');
      if (rest !== rowText && rest.length < 120) consider(rest);
    }
  }
  for (const control of document.querySelectorAll('select[name], select[id], select[aria-label], input[name], input[id], input[aria-label]')) {
    const name = `${control.getAttribute('aria-label') || ''} ${control.getAttribute('name') || ''} ${control.getAttribute('id') || ''}`;
    if (!/incident.?type.?group|type.?group/i.test(name)) continue;
    consider(controlText(control));
    candidateValues(control.parentElement).forEach(consider);
  }
  const product = found.find((value) => GROUP_VALUE.test(value));
  if (product) return product;
  // Last resort: a visible, stand-alone "Support-Sage 300 Cloud" style value
  // (or the selected option of any select) somewhere on the ticket.
  for (const select of document.querySelectorAll('select')) {
    const value = cleanGroupValue(controlText(select));
    if (/^support\s*[-\u2013:]\s*sage\s*300\s*(?:cloud|people)\b/i.test(value)) return value;
  }
  for (const element of document.querySelectorAll('td, dd, span, div, p, a, strong, b, input')) {
    if (/^option$/i.test(element.tagName || '') || (element.childElementCount || 0) > 2) continue;
    const raw = (element.tagName && /^input$/i.test(element.tagName) ? element.value : element.textContent) || '';
    if (raw.length > 80 || !GROUP_VALUE.test(raw) || !isVisible(element)) continue;
    const value = cleanGroupValue(raw);
    if (/^support\s*[-\u2013:]\s*sage\s*300\s*(?:cloud|people)$/i.test(value)) return value;
  }
  return found[0] || '';
}

/**
 * Read the visible ticket detail text, which contains the NetAdmin webform
 * questions and answers the analyzer relies on.
 */
function readLoggedText() {
  const containers = document.querySelectorAll(
    '[data-ticket-description], .ticket-description, .ticket-body, .incident-detail, .webform, form'
  );
  const parts = [];
  containers.forEach((element) => {
    if (inSurvey(element) || element.matches?.(SURVEY_CONTAINER)) return;
    const value = element.innerText || element.textContent || '';
    if (value.trim()) parts.push(value.trim());
  });
  if (!parts.length) {
    const main = document.querySelector('main') || document.body;
    parts.push((main.innerText || main.textContent || '').trim());
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 20000);
}

/**
 * Find a value rendered next to a label, which is how NetAdmin shows
 * product, module and similar fields.
 */
function readLabelledValue(labelPattern) {
  const cells = document.querySelectorAll('th, td, dt, dd, label, span');
  for (let index = 0; index < cells.length; index += 1) {
    const label = (cells[index].textContent || '').trim().replace(/[:*]$/, '');
    if (!labelPattern.test(label)) continue;
    const next = cells[index].nextElementSibling;
    const value = (next && (next.textContent || '').trim()) || '';
    if (value) return value.slice(0, 200);
  }
  return '';
}

/** Read the action / note history already displayed on the ticket. */
function readActionHistory() {
  const rows = document.querySelectorAll('[data-action-row], .action-row, .ticket-action, .note');
  const actions = [];
  rows.forEach((row) => {
    const description = (row.innerText || row.textContent || '').trim();
    if (!description) return;
    actions.push({
      actionType: row.getAttribute('data-action-type') || '',
      actionDescription: description.slice(0, 4000),
      date: row.getAttribute('data-action-date') || ''
    });
  });
  return actions.slice(0, 50);
}

/**
 * Read the open and completed queues that the signed-in agent can already see.
 * Completed tickets feed the local, anonymised past-ticket learning.
 */
function scrapeQueues() {
  const readRows = (selector) => {
    const rows = Array.from(document.querySelectorAll(selector));
    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('td')).map((cell) => (cell.textContent || '').trim());
      const rowText = (row.innerText || row.textContent || '').trim();
      return {
        incidentReference: rowText.match(/\bWF\d{4,}\b/)?.[0] || cells[0] || '',
        outline: cells[1] || rowText.slice(0, 200),
        summary: cells[1] || rowText.slice(0, 200),
        stage: row.getAttribute('data-stage') || cells[2] || '',
        priority: row.getAttribute('data-priority') || cells[3] || '',
        closedDate: row.getAttribute('data-closed-date') || '',
        resolution: row.getAttribute('data-resolution') || '',
        actions: []
      };
    }).filter((item) => item.incidentReference || item.outline);
  };

  return {
    open: readRows('[data-queue="open"] tr, .queue-open tr, table.queue tbody tr').slice(0, 100),
    completed: readRows('[data-queue="completed"] tr, .queue-completed tr').slice(0, 100),
    scrapedAt: new Date().toISOString()
  };
}

/**
 * Inject floating button on page load
 */
function injectFloatingButton() {
  // Check if button already exists
  if (document.querySelector('#netadmin-assistant-button')) {
    return;
  }

  const button = document.createElement('button');
  button.id = 'netadmin-assistant-button';
  button.innerHTML = '🔍';
  button.title = 'Analyze with NetAdmin Assistant';
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #00a651;
    color: white;
    border: none;
    cursor: pointer;
    font-size: 24px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    z-index: 9999;
    transition: all 0.3s ease;
  `;

  button.onmouseover = () => {
    button.style.transform = 'scale(1.1)';
    button.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.3)';
  };

  button.onmouseout = () => {
    button.style.transform = 'scale(1)';
    button.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
  };

  button.onclick = () => {
    chrome.runtime.sendMessage(
      { action: 'openSidePanel' },
      () => {
        if (chrome.runtime.lastError) {
          console.error('Error opening side panel:', chrome.runtime.lastError);
        }
      }
    );
  };

  document.body.appendChild(button);
  console.log('[NetAdmin Assistant] Floating button injected');
}

// Inject button when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFloatingButton);
} else {
  injectFloatingButton();
}
