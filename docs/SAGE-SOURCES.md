# Optional live Sage Knowledgebase and Community Hub retrieval

The extension can rank live results from the official Sage sources. This is an **optional enhancement**: the rules engine, the local knowledge base and the past-ticket matching are fully functional without it.

## What it does

1. The rules engine generates a ticket-specific search phrase from the recorded question (site codes, greetings and ticket references removed). If no usable question terms are captured, retrieval is skipped.
2. The service worker requests the search page of each configured source using the agent's own authenticated browser session.
3. Result titles, URLs, snippets and article/solution IDs are parsed and gated on at least two terms from the actual question; incidental error codes, module names and product labels cannot make a result relevant.
4. The top results are shown in the **Sage searches** card, alongside the pre-filled search links.

Nothing is fabricated: only the text present in the retrieved page is displayed, and everything is HTML-escaped.

## Sources and limits

| Source | Host |
|---|---|
| Sage Knowledgebase (ZA) | `za-kb.sage.com` |
| Sage Knowledgebase (US) | `us-kb.sage.com` |
| Sage Community Hub | `communityhub.sage.com` |

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

If a source cannot be read — not signed in, blocked, timed out, changed markup — the side panel states which source was unavailable and keeps the pre-filled searches. No error is hidden and no result is invented.

## Tests

`tests/sources.test.js` exercises parsing and ranking against the static fixtures in `tests/fixtures/source-pages.js`. The tests make no network calls.
