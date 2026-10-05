# Optional live Sage Knowledgebase and Community Hub retrieval

The extension can rank live results from the official Sage sources. This is an **optional enhancement**: the rules engine, the local knowledge base and the past-ticket matching are fully functional without it.

## Product scope: the Incident Type Group

The NetAdmin **Incident Type Group** (for example `Support-Sage 300 Cloud`) is read from the ticket page — from a label and value, a bound select, a dropdown widget's visible text (a hidden input that only holds the group's id is ignored), a table row, or the page text — and is the authoritative product for the analysis:

| Incident Type Group | Product used | Resources offered |
|---|---|---|
| contains `Sage 300 Cloud` | Sage 300 Cloud | Sage 300 Cloud rules, knowledge entries, KB search and live results only |
| contains `Sage 300 People` | Sage 300 People | Sage 300 People rules, knowledge entries and resources only |
| missing or not recognised | *Sage product not specified* | Only product-neutral rules; no product-specific knowledge; KB links labelled “Product not confirmed” |

- Product names mentioned in the ticket text never switch the product away from the group. A mention of another product is flagged as a contradiction: product-specific diagnosis and knowledge are withheld and the first question asks the customer to confirm the product.
- Generic “Sage 300” wording is **not** treated as Sage 300 Cloud. The *Product* webform field is only used when no Incident Type Group was read.
- Live results that name another product are dropped, even when they match the search terms. A result is only presented as product-specific advice when it came from a product-scoped search route or names the ticket's product; otherwise it is labelled “Product not confirmed” and left out of the customer reply.
- The cached analysis signature includes the Incident Type Group, the Product field, the module, the question fields and an analysis version, so switching groups can never reuse a stale result.

## The search phrase

The rules engine builds one concise phrase from the recorded question only (the Outline answer to “How would you best describe this query?”, cut at the next section and never including the Ticket Survey): greetings, ticket references, site codes, email addresses, phone numbers, the customer's name and the product prefix are removed. Descriptions longer than eight keywords are reduced to the issue keywords of the sentence that states the symptom (for example “the TOT screen takes 7 - 10min to open” → `TOT screen slow open`). Background sentences (an earlier ticket, an update already resolved), impact (“causing delays and frustration”), requests (“please investigate”) and comparisons (“no problems on a local environment”) are skipped, as is a leading “Since …,” / “However,” clause; “unable to find” is read as “missing”, a short list after a colon (“in the following areas: Trial Balance …”) stays with its sentence, and when the symptom sentence refers back (“this batch”) up to three keywords of the sentence before it come first (`posted GL Journal missing batch transaction Trial Balance`); a quoted or labelled error message is cut to its first seven keywords (`Third Party Logon string must contain`); filler words and repeats are removed and at most seven words are kept, because the Knowledgebase search box is character-limited. A quoted or labelled error message is preferred, and error codes are kept only when they appear next to the words *error* / *code* (or as `0x…` codes) in the question — incidental numbers are dropped. The product constraint is applied separately by the link or route, never by adding the product to the phrase.

## Knowledgebase routes

| Route | Purpose | Used by the extension |
|---|---|---|
| `/portal/app/portlets/results/viewsearch.jsp?q=…` | Old search page | **Never** — it returns HTTP 404. Tests fail if it reappears. |
| `/portal/app/portlets/results/viewsolution.jsp?solutionid=…` | One specific article; needs a real solution ID | Only for article links that were actually returned by a source. Solution IDs are never generated. |
| `/portal/ss/?querytext=…&tabid=2&searchaliases=…` | Search, restricted by a product search alias | Routes in `NetAdminSources.KB_SEARCH_ROUTES` with a full alias |
| `/portal/ss/?querytext=…&tabid=2` | Search with the issue keywords only, not product-filtered | Only a route without a known alias (none at present) |
| `/portal/ss/?querytext=&tabid=2&searchaliases=…` | Knowledgebase with only the product selected and an empty search | Same aliases, offered next to the pre-filled search |

Every confirmed product gets a pre-filled Knowledgebase search. `KB_SEARCH_ROUTES` uses an alias only when it is known in full; otherwise the link is labelled as not filtered by product. The search text is always the issue keywords only: the Knowledgebase search box is character-limited, so the product name is never added (only the Google link carries the product):

| Host | Product | Alias | Status |
|---|---|---|---|
| `us-kb.sage.com` | Sage 300 Cloud | `custom_us_threehundred;` | Taken from a complete working URL supplied by the user (`https://us-kb.sage.com/portal/ss/?querytext=Access+Violation&tabid=2&searchaliases=custom_us_threehundred;`). |
| `za-kb.sage.com` | Sage 300 Cloud | `custom_za_threehundred` | Taken from a working URL supplied by the user (`https://za-kb.sage.com/portal/ss/?searchaliases=custom_za_threehundred&tabid=2`). |
| `za-kb.sage.com` | Sage 300 People | `custom_za_en_threehundredpeople` | Taken from a working URL supplied by the user (`https://za-kb.sage.com/portal/ss/?querytext=&searchaliases=custom_za_en_threehundredpeople&tabid=2`). The US Knowledgebase and the Cloud aliases are never used for People. |

The Community Hub product areas come from working URLs supplied by the user (`NetAdminSources.COMMUNITY_GROUPS`): Sage 300 People → `https://communityhub.sage.com/za/sage-300-people/`; Sage 300 Cloud → `https://communityhub.sage.com/za/sage-300/` and `https://communityhub.sage.com/us/sage-300/`. They are offered as product links; no search URL inside a product area has been confirmed, so the pre-filled Community Hub search (`/search?q=<phrase>`) still covers all products and is labelled as such.

To filter a search by product, set `alias` on its route to the full alias once it has been confirmed from a working URL; the empty-search product link is then offered too. To add a product, append `{ sourceId, name, host, product, alias }`.

**Verification status:** the Sage Knowledgebase hosts could not be reached from the environment in which this version was built (DNS resolution was blocked), so none of the routes or aliases above were validated live by the extension's authors. All three aliases and the Community Hub product areas rely on user-supplied working URLs; confirm them in a signed-in browser before relying on them.

## What it does

1. If the search phrase is empty, retrieval is skipped.
2. The service worker requests the product's Knowledgebase search routes and the Community Hub search for `<phrase>` (issue keywords only), using the agent's own authenticated browser session. When the product is not confirmed, no Knowledgebase route is requested.
3. Result titles, URLs, snippets and article/solution IDs are parsed and gated on at least two terms from the actual question. Knowledgebase results are only kept when they link to a `viewsolution.jsp` article with a real solution ID.
4. Matched results are shown in **Guidance from matched Sage sources** and in the **Sage searches** card. Only the retrieved title and extract are used — the steps inside an article are never inferred from its title.

Nothing is fabricated: only the text present in the retrieved page is displayed, and everything is HTML-escaped.

## Sources and limits

| Source | Host | Automatic retrieval |
|---|---|---|
| Sage Knowledgebase (ZA) | `za-kb.sage.com` | Sage 300 Cloud (`custom_za_threehundred`) and Sage 300 People (`custom_za_en_threehundredpeople`) tickets, via `/portal/ss/` with the issue keywords, when enabled. |
| Sage Knowledgebase (US) | `us-kb.sage.com` | Sage 300 Cloud tickets only, via `/portal/ss/` with `custom_us_threehundred;`, when enabled |
| Sage Community Hub | `communityhub.sage.com` | Yes, when enabled |

- One request per source, per refresh. No crawling and no following of result links.
- 6 second timeout per request (`NetAdminSources.TIMEOUT_MS`).
- Responses are truncated at 400 KB and at most 5 ranked results are shown.
- Only absolute `https://` links on the three hosts above are rendered; anything else is discarded.
- Google is **not** scraped. It remains a normal click-through link. A supported non-AI search API (for example Google Programmable Search) would be required to change that, and none is configured.

## Approval and disabling

**Automated reading of Sage Knowledgebase and Sage Community Hub pages must be approved by Sage IT / InfoSec before it is enabled for general use.**

- It is **off by default**. Nothing is fetched until the user ticks *Retrieve live Sage Knowledgebase and Community Hub results* in the side panel.
- To disable it for a user: untick the setting.
- To disable it for everyone: remove the `https://za-kb.sage.com/*`, `https://us-kb.sage.com/*` and `https://communityhub.sage.com/*` entries from `host_permissions` in `extension/manifest.json`. The side panel then reports the sources as unavailable and keeps the pre-filled search links.

## Failure behaviour

If a source cannot be read — not signed in (a sign-in wall), blocked, timed out, changed markup, an HTTP error, a branded 404/unsupported page, or no results for the ticket's product — the source is reported as unavailable **with the reason** in the side panel and in the draft reply, and the manual search links are described as click-throughs rather than as usable pre-filled searches. `NetAdminSources.looksLikeErrorPage` catches error pages that are served with a 200 status. No error is hidden and no result is invented.

The panel and the reply are kept in step by `NetAdminAnalyzer.applySources`, which is pure and idempotent: refreshing the sources, switching retrieval off, or a source becoming unavailable updates the sourced-guidance card and the draft reply together.

## Tests

`tests/sources.test.js` exercises parsing and ranking against the static fixtures in `tests/fixtures/source-pages.js`. The tests make no network calls.
