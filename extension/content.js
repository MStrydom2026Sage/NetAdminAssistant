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
});

/**
 * Scrape ticket information from NetAdmin page
 * Adjust selectors based on actual NetAdmin DOM structure
 */
function scrapeCurrentTicket() {
  const ticketData = {
    ticketId: '',
    subject: '',
    description: '',
    customerName: '',
    customerEmail: '',
    status: '',
    priority: '',
    attachments: [],
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

  } catch (error) {
    console.error('[NetAdmin Assistant] Scraping error:', error);
  }

  return ticketData;
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
  button.textContent = '🔍';
  button.setAttribute('aria-label', 'Open NetAdmin analysis');
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
