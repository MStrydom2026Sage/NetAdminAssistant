# NetAdmin Assistant v0.6.1

**Offline Sage 300 support ticket analyser for NetAdmin**

NetAdmin Assistant is a Chrome (Manifest V3) extension that reads the NetAdmin ticket you are working on and produces a deterministic, rules-based analysis: a suggested problem area, ticket-specific next steps, Sage search links and a draft customer reply.

There is **no AI service, no API key, no OpenAI, no localhost helper server, no Express, no CORS layer and no dotenv**. Ticket content and attachments stay local by default; enabling optional Sage retrieval sends only a sanitised search phrase to the official Sage sites.

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
| Local rules engine (`extension/analyze.js`) | Prioritises “How would you best describe this query?”, labels its source, gates product/module suggestions and knowledge against that question, prunes already-attempted steps, generates search phrases and replies | No |
| Curated knowledge base (`extension/knowledge/knowledge-base.json`) | Editable local entries merged and ranked alongside the rules | No |
| Past-ticket learning (`extension/history.js`) | Anonymised local records of completed NetAdmin tickets, stored on this device only | No |
| Live Sage sources (`extension/sage-sources.js`) | Optional ranking of Sage Knowledgebase and Sage Community Hub search results | Yes (optional) |

The local rules engine is always the guaranteed fallback. Everything except the last row works with no network access at all.

### Rules coverage

Sage 300 People: MCS password, ESS mobile registration, tax/PAYE, leave and accruals.
Sage 300 Cloud: BOM/assemblies, Tax Services, bank reconciliation, G/L control accounts, G/L consolidations, A/P, A/R history, O/E, P/O, I/C Day End, Business Insights (BIM), reporting / SI Connector, report printing and print destination, batch posting errors, language/localisation installation and third-party compatibility. Unclassified queries receive precise questions derived from the recorded query, not module-specific instructions and not generic boilerplate.

### How the next steps are built

The **Suggested next steps** card keeps three kinds of information apart, so a hypothesis is never presented as a verified instruction:

1. **Confirmed from this ticket** — facts quoted from the webform (recorded query, product, version, error message, steps to replicate, work already done).
2. **Rules-based checks** — steps from the local rule that actually matched, each labelled with the rule it came from. They are explicitly not verified against a Sage article.
3. **Guidance from matched Sage sources** — the curated local entries and, when live retrieval is on, the official Sage results that matched. Retrieved results contribute a cited title, extract and link only; article steps are never inferred from a title.

When no rule matches, no steps are invented. The panel and the draft reply instead ask precise questions built from the recorded query (exact message, menu path, scope, what was already tried) and state that there is no validated step yet.

## 🔎 Sage Knowledgebase and Community Hub (optional)

Live retrieval is **off by default** and is enabled from the **Local data** section of the side panel.

- The Sage Knowledgebase search endpoint that was used here (`/portal/app/portlets/results/viewsearch.jsp`) now returns **HTTP Status 404 – Not Found**, and no replacement query endpoint could be verified. The Knowledgebase is therefore **not** retrieved automatically: it is reported as unavailable, and its home page plus a clearly labelled site-restricted Google search are offered as manual click-throughs.
- Only `communityhub.sage.com` is requested automatically, using the search phrase the rules engine generates from the ticket. `za-kb.sage.com` and `us-kb.sage.com` stay on the allowlist so their links remain renderable.
- HTTP errors and branded 404 / unsupported pages are detected, so a broken source is reported as unavailable instead of being parsed.
- The agent's existing authenticated browser session is used; no credentials are stored.
- A short timeout, a capped response size and a fixed result limit apply. There is no crawling.
- Google is a normal click-through link only. **Google results are never retrieved automatically.**
- If a source cannot be read, the side panel says so and the pre-filled search links remain available.
- Automated reading of Knowledgebase and Community pages must be approved by Sage IT / InfoSec. See [docs/SAGE-SOURCES.md](docs/SAGE-SOURCES.md).

## 🗂️ Past-ticket learning

While you are signed in to NetAdmin, completed tickets that are already on screen are reduced to an anonymised local record (topic, module, product, normalised terms, error codes, sanitised summary and recorded action). Site codes, email addresses and phone numbers are stripped, and the ticket reference is replaced with a short non-identifying local label.

Records are stored in `chrome.storage.local`, capped at 200 entries, kept for a maximum of 180 days, and can be deleted at any time with **Reset stored ticket learning**. Since v0.6.1 the stored records are **not** part of the analysis: there is no “Similar completed tickets” section, and a historical match can no longer influence the current query's suggested area, steps or reply.

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

Full ticket content, attachments and customer details stay in the browser. Optional Sage retrieval sends a sanitised search phrase to the three official Sage sites only after opt-in; clicking a search link also sends its search phrase to that site.

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
  sidepanel.js
  html/sidepanel.html
  styles/common.css, styles/sidepanel.css
tests/
docs/
```

## ⚠️ Limitations

- Suggested areas and steps are rules-based guidance, not a confirmed Sage answer.
- If the question field is absent or ambiguous, the displayed source and clarifying checks make this visible; no diagnosis of the unseen ticket can be inferred from screenshots alone.
- Past-ticket learning is stored locally but is not used to diagnose the current ticket.
- Live Sage retrieval depends on the signed-in session and the current page markup; it fails gracefully.
- Sage Knowledgebase retrieval is reported as unavailable: the old search endpoint returns HTTP 404 and no replacement endpoint could be verified from this environment. The Knowledgebase links in the panel are manual click-throughs and are labelled as such.
