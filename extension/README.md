# NetAdmin Assistant Chrome Extension

Offline, rules-based analysis of Sage 300 support tickets in NetAdmin. No AI service, API key or helper server is used, and ticket content never leaves the browser.

## Installation

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this `extension/` folder
4. Open a NetAdmin ticket and click the green 🔍 floating button, or open the side panel from the extension icon

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3 definition and permissions |
| `analyze.js` | Deterministic rules engine: webform extraction, product/module detection, topic rules, step pruning, replies, queue ranking, similarity |
| `knowledge.js` / `knowledge/knowledge-base.json` | Curated local knowledge base loader and data |
| `history.js` | Anonymised past-ticket learning with retention and reset |
| `sage-sources.js` | Optional Sage Knowledgebase / Community Hub retrieval, parsing and ranking |
| `background.js` | Service worker: local analysis, caching, settings, message routing |
| `content.js` | NetAdmin scraping (ticket, webform fields, actions, queues) and the floating button |
| `sidepanel.js` / `html/sidepanel.html` | Side panel UI |
| `popup.js` / `html/popup.html` | Quick popup |
| `styles/` | Dark theme with the green Sage accent |

## Behaviour

- Analysis runs entirely in the service worker using `analyze.js`.
- Suggested areas and steps are labelled as suggestions; only ticket-derived facts appear under **Confirmed evidence from the ticket**.
- Similar completed tickets are labelled historical context and are never authoritative.
- Live Sage retrieval is optional, off by default, limited to the official Sage domains, time-limited and size-capped. Google stays a click-through link.
- All rendered ticket and fetched text is HTML-escaped, and only `https://` links are rendered.

## Development

```bash
npm test         # regression suite (Node built-in runner, no dependencies, no network)
npm run samples  # print the analysis for every sample ticket
```
