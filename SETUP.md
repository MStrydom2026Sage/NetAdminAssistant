# Setup and Install Guide

## Prerequisites

- **Chrome/Chromium:** v114+ (side panel support)
- **Node.js:** v18+ for tests; v22+ for the optional live AI helper
- **Git**

Offline use needs no server, key or dependency installation. Live AI is optional and requires a separately started helper and an OpenAI API key.

## 1. Clone the repository

```bash
git clone --branch copilot/copilotcopilotimprove-ticket-query-diagnosis https://github.com/MStrydom2026Sage/NetAdminAssistant.git
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

No dependencies are installed and no external network calls are made. Helper integration tests use temporary loopback ports and mocked provider responses.

## Live AI helper (optional)

1. Obtain Sage IT / InfoSec approval for sending ticket evidence to OpenAI and technical search queries to web search. Remove secrets and personal/customer data from the query, troubleshooting fields, action history and selected files.
2. Install Node.js 22+ from https://nodejs.org/en.
3. Copy `server/.env.example` to `server/.env`, set `OPENAI_API_KEY` locally, and optionally set `OPENAI_MODEL` to a model available to your account that supports Responses structured output and web search. The default comes from the supplied previous helper: `gpt-5.4-mini`. Never commit the `.env` file.
4. From the repository root, run `npm run ai-helper`. No dependencies need installing. The server binds only to `127.0.0.1:3000`; do not expose it through a network proxy or public tunnel.
5. Reload the unpacked extension to grant the loopback host permission. Open the ticket, optionally select up to three original `.txt`, `.log` or `.csv` evidence files (20 KB each), confirm approval in **Live AI evidence review**, then click **Review with live AI**.

The button freshly scrapes the active ticket, recomputes local context and explicitly requests a review. Normal **Analyze** and the **Offline support assistant** remain offline; there is no automatic cloud analysis or cloud chat. Evidence files are not downloaded from ticket links. Signature images, screenshots, PDFs and Office documents are not parsed. The approval checkbox is not persisted.

Research uses short technical queries, official Sage domains first, and Community Hub only when primary evidence is weak or absent. People and Cloud remain separate, and missing/conflicting product metadata blocks live diagnosis. Only evidence URLs present in the search tool's returned sources are accepted; unmatched findings are discarded. No usable citations forces low confidence. Citation provenance is not proof of correctness: review the source's product, version and instructions yourself.

The analysis separates already-attempted work, remaining actions, missing information and an AI reply draft. It asks the model not to duplicate sent agent requests, but semantic duplicate detection is not guaranteed. The AI draft is separate from the editable offline reply, so source refreshes cannot overwrite it. There is no automatic sending or modification of tickets.

The helper has a 150-second deadline, payload limits, a two-starts-per-minute limit and a maximum of two in-flight requests. It accepts extension origins only (or non-browser local requests with the explicit JSON/custom-header contract); this is not authentication against other local processes or extensions. Use only on a trusted workstation. `GET http://127.0.0.1:3000/` reports whether a key is configured, not whether the provider key/model is valid. Provider errors are shown without returning raw provider data. No ticket data or AI results are written to disk by the helper. OpenAI calls use `store: false`; consult your provider agreement for retention and regional processing requirements.

Long-running responses send JSON whitespace heartbeats to keep the Manifest V3 worker's fetch alive. Once response headers are sent, errors are indicated by `success: false` in the final JSON body rather than the HTTP status; clients must check both.

Stop the helper with Ctrl+C when finished. Offline functionality does not depend on it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Refresh the NetAdmin page and try again." | The content script was injected before the extension reloaded — refresh the NetAdmin tab |
| The same analysis appears for two tickets | Click **Clear Cache**; if it persists the ticket page did not expose the Summary field — check the ticket detail is visible before analysing |
| No live Sage results | Retrieval is off by default, the session may not be signed in, or the source is unavailable — the panel names the source and the reason. The Sage Knowledgebase is always reported as unavailable because its search endpoint returns HTTP 404; use the Knowledgebase home page or the labelled site-restricted Google search link |
| Cannot reach the AI helper | Run `npm run ai-helper`, check port 3000 is free and reload the extension after granting its new loopback permission |
| Live AI reports HTTP 401/403/429 or model errors | Check the local key, account model/web-search access, quota and billing; no paid live provider call is made by the automated tests |
