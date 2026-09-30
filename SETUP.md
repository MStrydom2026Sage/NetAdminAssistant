# Setup and Install Guide

## Prerequisites

- **Chrome/Chromium:** v114+ (side panel support)
- **Node.js:** v18+ — only needed to run the regression tests
- **Git**

There is no backend server, no API key, no AI provider and no `npm install` step for normal use.

## 1. Clone the repository

```bash
git clone https://github.com/MStrydom2026Sage/NetAdminAssistant.git
cd NetAdminAssistant
```

## 2. Load the unpacked extension

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Confirm the extension loads with no errors (the service worker runs the local rules engine)

## 3. Use it

1. Open a NetAdmin ticket at `https://netadmin.sage.co.za/...`
2. Click the green 🔍 floating button, or open the side panel from the extension icon
3. Click **Analyze**

The side panel shows the suggested area, ticket-specific next steps (ticket facts, rules-based checks and any guidance from a matched Sage source), local knowledge-base matches, Sage search links and a draft customer reply.

## 4. Optional settings (side panel → Local data)

| Setting | Default | Effect |
|---|---|---|
| Retrieve live Sage Knowledgebase and Community Hub results | Off | Fetches and ranks results from the official Sage domains using your signed-in browser session |
| Learn from completed NetAdmin tickets on this device | On | Stores anonymised records of completed tickets already visible in NetAdmin. Stored records are not used to diagnose the current ticket |
| Reset stored ticket learning | — | Deletes every stored record immediately |

**Before enabling live retrieval, confirm with Sage IT / InfoSec that automated reading of the Knowledgebase and Community Hub is acceptable.** See [docs/SAGE-SOURCES.md](docs/SAGE-SOURCES.md) for how to disable it permanently.

## 5. Local storage and retention

Everything is stored in `chrome.storage.local`:

| Key | Contents | Retention |
|---|---|---|
| `analysisCache` | Cached analyses keyed by ticket reference | 24 hours, or **Clear Cache** |
| `settings` | The toggles above | Until changed |
| `completedTicketKnowledge` | Anonymised completed-ticket records | Max 200 records / 180 days, or **Reset stored ticket learning** |

Removing the extension removes all of it.

## 6. Run the tests

```bash
npm test         # node --test tests/*.test.js
npm run samples  # print the analysis for every sample ticket
```

No dependencies are installed and no network calls are made.

## 7. Upgrading from the AI/backend version

The `server/` backend, the OpenAI/Azure providers and the `http://localhost:3000` host permission have been removed. If you previously ran the helper server you can stop it; delete any `.env` file containing API keys. Reload the unpacked extension after pulling.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Refresh the NetAdmin page and try again." | The content script was injected before the extension reloaded — refresh the NetAdmin tab |
| The same analysis appears for two tickets | Click **Clear Cache**; if it persists the ticket page did not expose the Summary field — check the ticket detail is visible before analysing |
| No live Sage results | Retrieval is off by default, the session may not be signed in, or the source is unavailable — the panel names the source and the reason. The Sage Knowledgebase is always reported as unavailable because its search endpoint returns HTTP 404; use the Knowledgebase home page or the labelled site-restricted Google search link |
