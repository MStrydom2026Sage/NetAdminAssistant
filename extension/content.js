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
    product: '',
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
    ticketData.outline =
      document.querySelector('[data-ticket-outline], .ticket-outline')?.textContent?.trim() ||
      ticketData.subject;
    ticketData.product = readLabelledValue(/^product$/i);
    ticketData.module = readLabelledValue(/^(module|area|category)$/i);
    ticketData.actions = readActionHistory();

    console.log('[NetAdmin Assistant] Ticket scraped:', ticketData);
  } catch (error) {
    console.error('[NetAdmin Assistant] Scraping error:', error);
  }

  return ticketData;
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
