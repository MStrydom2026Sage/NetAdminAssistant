# NetAdmin Assistant Chrome Extension

Offline, rules-based analysis of Sage 300 support tickets in NetAdmin. No AI service, API key or helper server is used. Optional Sage retrieval sends a sanitised search phrase to official Sage sites after opt-in.

## Installation

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this `extension/` folder
4. Open a NetAdmin ticket and click the green 🔍 floating button, or open the side panel from the extension icon

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3 definition and permissions |
| `analyze.js` | Deterministic rules engine: webform extraction, product/module detection, topic rules, step pruning, ticket facts, missing-context questions, sourced guidance, replies and queue ranking |
| `knowledge.js` / `knowledge/knowledge-base.json` | Curated local knowledge base loader and data |
| `history.js` | Anonymised past-ticket learning with retention and reset |
| `sage-sources.js` | Optional Sage Knowledgebase / Community Hub retrieval, parsing and ranking |
| `background.js` | Service worker: local analysis, caching, settings, message routing |
| `content.js` | NetAdmin scraping (ticket, webform fields, actions, queues) and the floating button |
| `sidepanel.js` / `html/sidepanel.html` | Side panel UI |
| `styles/` | Dark theme with the green Sage accent |

## Behaviour

- Analysis runs entirely in the service worker using `analyze.js`.
- The toolbar icon and floating button open the side panel directly. The question field is shown there before suggestions, with its source; when evidence is weak, use the clarifying checks rather than a module diagnosis.
- Suggested areas and steps are labelled as suggestions; only ticket-derived facts appear under **Confirmed evidence from the ticket** and **Confirmed from this ticket**.
- Next steps separate ticket facts, rules-based checks (each labelled with the rule) and guidance from a matched source (cited with its link). When no rule matches, precise questions derived from the recorded query are shown instead of generic boilerplate.
- Past-ticket learning is still stored and can be reset, but it is not part of the analysis and there is no similar-tickets section.
- The product comes from the NetAdmin Incident Type Group (`content.js` → `incidentTypeGroup`). Every confirmed product gets a pre-filled `/portal/ss/` Knowledgebase search (`NetAdminSources.KB_SEARCH_ROUTES`): filtered by a fully known product alias where there is one, otherwise with the product name added to the search text and labelled as not product-filtered. The retired `viewsearch.jsp` endpoint is never used.
- Live Sage retrieval is optional, off by default, limited to the official Sage domains, time-limited and size-capped. Google stays a click-through link.
- All rendered ticket and fetched text is HTML-escaped, and only `https://` links are rendered.

## Development

```bash
npm test         # regression suite (Node built-in runner, no dependencies, no network)
npm run samples  # print the analysis for every sample ticket
```
