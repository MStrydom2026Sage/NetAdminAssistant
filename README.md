# NetAdmin Assistant v0.6.0

**Offline Sage 300 support ticket analyser for NetAdmin**

NetAdmin Assistant is a Chrome (Manifest V3) extension that reads the NetAdmin ticket you are working on and produces a deterministic, rules-based analysis: a suggested problem area, suggested next steps, pre-filled Sage searches and a draft customer reply.

There is **no AI service, no API key, no OpenAI, no localhost helper server, no Express, no CORS layer and no dotenv**. Ticket content and attachments are never sent to a third party.

## 🚀 Quick start

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder of this repository
4. Open a NetAdmin ticket and click the green 🔍 floating button, or open the side panel from the extension icon
5. Click **Analyze**

No `npm install` is required to use the extension. Node is only used to run the regression tests.

## 🧠 How the analysis works

| Layer | What it does | Requires network |
|---|---|---|
| Local rules engine (`extension/analyze.js`) | Webform field extraction, product/module detection, third-party detection, detailed topic rules, module guide fallbacks, already-attempted detection and step pruning, search-phrase generation, customer-safe reply, queue ranking | No |
| Curated knowledge base (`extension/knowledge/knowledge-base.json`) | Editable local entries merged and ranked alongside the rules | No |
| Past-ticket learning (`extension/history.js`) | Anonymised local records of completed NetAdmin tickets, ranked as historical context | No |
| Live Sage sources (`extension/sage-sources.js`) | Optional ranking of Sage Knowledgebase and Sage Community Hub search results | Yes (optional) |

The local rules engine is always the guaranteed fallback. Everything except the last row works with no network access at all.

### Rules coverage

Sage 300 People: MCS password, ESS mobile registration, tax/PAYE, leave and accruals.
Sage 300 Cloud: BOM/assemblies, Tax Services, bank reconciliation, G/L control accounts, G/L consolidations, A/P, A/R history, O/E, P/O, I/C Day End, Business Insights (BIM), reporting / SI Connector, third-party compatibility, plus a module-level fallback for G/L, A/P, A/R, I/C, O/E, P/O, Bank, Tax, SI and People.

## 🔎 Sage Knowledgebase and Community Hub (optional)

Live retrieval is **off by default** and is enabled from the **Local data** section of the side panel.

- Only `za-kb.sage.com`, `us-kb.sage.com` and `communityhub.sage.com` are requested, using the search phrase the rules engine generates from the ticket.
- The agent's existing authenticated browser session is used; no credentials are stored.
- A short timeout, a capped response size and a fixed result limit apply. There is no crawling.
- Google is a normal click-through link only. **Google results are never retrieved automatically.**
- If a source cannot be read, the side panel says so and the pre-filled search links remain available.
- Automated reading of Knowledgebase and Community pages must be approved by Sage IT / InfoSec. See [docs/SAGE-SOURCES.md](docs/SAGE-SOURCES.md).

## 🗂️ Past-ticket learning

While you are signed in to NetAdmin, completed tickets that are already on screen are reduced to an anonymised local record (topic, module, product, normalised terms, error codes, sanitised summary and recorded action). Site codes, email addresses and phone numbers are stripped, and the ticket reference is replaced with a short non-identifying local label.

Records are stored in `chrome.storage.local`, capped at 200 entries, kept for a maximum of 180 days, and can be deleted at any time with **Reset stored ticket learning**. Similar completed tickets are shown as historical context only and are never treated as authoritative.

## 📘 Local knowledge base

`extension/knowledge/knowledge-base.json` is a plain JSON file that support staff can edit. See [docs/KNOWLEDGE-BASE.md](docs/KNOWLEDGE-BASE.md) for the format and the rules that keep entries from contradicting the rules engine.

## 🔐 Permissions and privacy

| Permission | Why |
|---|---|
| `storage` | Cached analyses, settings and the anonymised completed-ticket records |
| `tabs` | Read the active NetAdmin tab to request the ticket |
| `sidePanel` | Open the analysis side panel |
| `https://netadmin.sage.co.za/*`, `https://*.sage.co.za/*` | Read the ticket you are working on |
| `https://za-kb.sage.com/*`, `https://us-kb.sage.com/*`, `https://communityhub.sage.com/*` | Optional Knowledgebase and Community Hub retrieval |

Ticket content, attachments and customer details never leave the browser.

## ✅ Tests

```bash
npm test        # node --test tests/*.test.js
npm run samples # print the analysis for every sample ticket
```

The suite uses Node's built-in test runner with no runtime dependencies, loads the extension modules in a bare VM context (so any Node-only API in extension code fails the tests) and makes **no network calls** — live-source parsing and ranking are covered with static fixtures.

## 📁 Layout

```
extension/
  manifest.json
  analyze.js            # deterministic rules engine
  knowledge.js          # curated knowledge loader
  knowledge/knowledge-base.json
  history.js            # anonymised past-ticket learning
  sage-sources.js       # optional KB / Community retrieval and ranking
  background.js         # service worker, local analysis and caching
  content.js            # NetAdmin scraping and floating button
  popup.js, sidepanel.js
  html/popup.html, html/sidepanel.html
  styles/common.css, styles/popup.css, styles/sidepanel.css
tests/
docs/
```

## ⚠️ Limitations

- Suggested areas and steps are rules-based guidance, not a confirmed Sage answer.
- Historical ticket matches are context, not instructions.
- Live Sage retrieval depends on the signed-in session and the current page markup; it fails gracefully.
