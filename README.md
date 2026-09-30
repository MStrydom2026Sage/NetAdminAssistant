# NetAdmin Assistant

Offline rules engine for Sage support tickets. Load the `extension` directory using Chrome's **Load unpacked** at `chrome://extensions/`, then open a NetAdmin ticket and click the green floating button or extension icon. The dark side panel and popup classify ticket topics and suggest checks and a customer-safe reply. The support question field answers scoped Sage/IT questions with local rules.

No server, AI provider, API key, npm install or network access is required to analyze a ticket. The extension uses only ticket fields and attachment names already present in the page; it does not download attachments, send ticket text to a service, or perform web research. Sage Help and Community links are optional external destinations opened only if you choose to follow them. Do not paste confidential details into external sites. Rules provide suggestions, not a confirmed diagnosis; review guidance and drafts before use.

The floating button is shown on matching NetAdmin/Sage pages. If scraping fails, refresh the ticket page; selectors in `extension/content.js` may need adjustment for the actual NetAdmin page. The previous server-based backend has been retired.

## Local regression suite

Node 18+ is needed only for tests. `npm test` runs the offline rules regression suite, and `npm run samples` prints sample classifications and replies. No npm dependencies or network access are needed.
