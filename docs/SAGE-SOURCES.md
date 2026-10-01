# Optional live Sage Knowledgebase and Community Hub retrieval

The extension can rank live results from the official Sage sources. This is an **optional enhancement**: the rules engine, the local knowledge base and the past-ticket matching are fully functional without it.

## Product scope: the Incident Type Group

The NetAdmin **Incident Type Group** (for example `Support-Sage 300 Cloud`) is read from the ticket page and is the authoritative product for the analysis:

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

The rules engine builds one concise phrase from the recorded question (“How would you best describe this query?” / *Confirmed from this ticket*): greetings, ticket references, site codes, email addresses, phone numbers, the customer's name and the product prefix are removed. A quoted or labelled error message is preferred, and error codes are kept only when they appear next to the words *error* / *code* (or as `0x…` codes) in the question — incidental numbers are dropped. The product constraint is applied separately by the link or route, never by adding the product to the phrase.

## Knowledgebase routes

| Route | Purpose | Used by the extension |
|---|---|---|
| `/portal/app/portlets/results/viewsearch.jsp?q=…` | Old search page | **Never** — it returns HTTP 404. Tests fail if it reappears. |
| `/portal/app/portlets/results/viewsolution.jsp?solutionid=…` | One specific article; needs a real solution ID | Only for article links that were actually returned by a source. Solution IDs are never generated. |
| `/portal/ss/?querytext=…&tabid=2&searchaliases=…` | Search, restricted by a product search alias | Only with an alias in `NetAdminSources.KB_SEARCH_ROUTES` |

`KB_SEARCH_ROUTES` contains only aliases known in full:

| Host | Product | Alias | Status |
|---|---|---|---|
| `us-kb.sage.com` | Sage 300 Cloud | `custom_us_threehundred;` | Taken from a complete working URL supplied by the user (`https://us-kb.sage.com/portal/ss/?querytext=Access+Violation&tabid=2&searchaliases=custom_us_threehundred;`). |
| `za-kb.sage.com` | Sage 300 Cloud | `custom_za_en_threehundr…` | **Not used** — only a truncated value was available, and the suffix is not guessed. The ZA Knowledgebase home page is offered instead, labelled as not pre-filled. |
| any | Sage 300 People | — | **Not used** — no People alias could be confirmed. People tickets get the ZA Knowledgebase home page (labelled as not pre-filled) and a Google search restricted to `za-kb.sage.com` and `"Sage 300 People"`. |

To add a route, append `{ sourceId, name, host, product, alias }` with the full alias once it has been confirmed from a working URL.

**Verification status:** the Sage Knowledgebase hosts could not be reached from the environment in which this version was built (DNS resolution was blocked), so none of the routes or aliases above were validated live by the extension's authors. The US Cloud route relies on the user-supplied working URL; confirm it in a signed-in browser before relying on it.

## What it does

1. If the search phrase is empty, retrieval is skipped.
2. The service worker requests the product's verified Knowledgebase search route (if any) and the Community Hub search for `<product> <phrase>`, using the agent's own authenticated browser session. When the product is not confirmed, no Knowledgebase route is requested.
3. Result titles, URLs, snippets and article/solution IDs are parsed and gated on at least two terms from the actual question. Knowledgebase results are only kept when they link to a `viewsolution.jsp` article with a real solution ID.
4. Matched results are shown in **Guidance from matched Sage sources** and in the **Sage searches** card. Only the retrieved title and extract are used — the steps inside an article are never inferred from its title.

Nothing is fabricated: only the text present in the retrieved page is displayed, and everything is HTML-escaped.

## Sources and limits

| Source | Host | Automatic retrieval |
|---|---|---|
| Sage Knowledgebase (ZA) | `za-kb.sage.com` | **No** — no fully known product alias |
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
