# Optional live Sage Knowledgebase and Community Hub retrieval

The extension can rank live results from the official Sage sources. This is an **optional enhancement**: the rules engine, the local knowledge base and the past-ticket matching are fully functional without it.

## What it does

1. The rules engine generates a ticket-specific search phrase from the recorded question (site codes, greetings and ticket references removed). If no usable question terms are captured, retrieval is skipped.
2. The service worker requests the search page of each source that still has a supported search endpoint, using the agent's own authenticated browser session.
3. Result titles, URLs, snippets and article/solution IDs are parsed and gated on at least two terms from the actual question; incidental error codes, module names and product labels cannot make a result relevant.
4. Matched results are shown in **Guidance from matched Sage sources** with their source and link next to them, and in the **Sage searches** card. Only the retrieved title and extract are used — the steps inside an article are never inferred from its title.

Nothing is fabricated: only the text present in the retrieved page is displayed, and everything is HTML-escaped.

## Sources and limits

| Source | Host | Automatic retrieval |
|---|---|---|
| Sage Knowledgebase (ZA) | `za-kb.sage.com` | **No** — reported as unavailable, see below |
| Sage Knowledgebase (US) | `us-kb.sage.com` | **No** — reported as unavailable, see below |
| Sage Community Hub | `communityhub.sage.com` | Yes, when enabled |

### The retired Knowledgebase search endpoint

`https://za-kb.sage.com/portal/app/portlets/results/viewsearch.jsp?q=…` and its US equivalent now answer with **HTTP Status 404 – Not Found**. No replacement Knowledgebase query endpoint could be verified, so:

- Neither Knowledgebase is fetched. `NetAdminSources.SOURCES` gives them an empty `search`, and `fetchSageSources` reports them as unavailable with the reason, instead of requesting a URL that is known to be broken.
- The side panel links to the Knowledgebase **home page** and to a clearly labelled **site-restricted Google search** (`site:za-kb.sage.com OR site:us-kb.sage.com`). Both are manual click-throughs; Google is still never read automatically.
- Their hosts stay on the allowlist so Knowledgebase links remain renderable and parsable if a supported endpoint is confirmed later. Restoring retrieval only needs a verified `search` URL on the source.
- `tests/sources.test.js` and `tests/analyze.test.js` fail if `/portal/app/portlets/results/viewsearch.jsp` reappears anywhere.

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

If a source cannot be read — not signed in, blocked, timed out, changed markup, an HTTP error or a branded 404/unsupported page — the source is reported as unavailable **with the reason** in the side panel and in the draft reply, and the manual search links are described as click-throughs rather than as usable pre-filled searches. `NetAdminSources.looksLikeErrorPage` catches error pages that are served with a 200 status. No error is hidden and no result is invented.

The panel and the reply are kept in step by `NetAdminAnalyzer.applySources`, which is pure and idempotent: refreshing the sources, switching retrieval off, or a source becoming unavailable updates the sourced-guidance card and the draft reply together.

## Tests

`tests/sources.test.js` exercises parsing and ranking against the static fixtures in `tests/fixtures/source-pages.js`. The tests make no network calls.
