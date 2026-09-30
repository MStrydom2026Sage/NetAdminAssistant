# Curated local knowledge base

`extension/knowledge/knowledge-base.json` holds the knowledge entries that support staff maintain by hand. It is loaded locally by the extension with `chrome.runtime.getURL`, so editing it needs no build step and no network access.

## Entry format

```json
{
  "id": "kb-bank-reconciliation-difference",
  "title": "Bank reconciliation is out of balance after a statement import",
  "product": "Sage 300 Cloud",
  "module": "bank",
  "topicId": "bank-reconciliation",
  "keywords": ["bank reconciliation", "ofx", "out of balance"],
  "phrases": ["bank", "statement", "reconciliation"],
  "errorPatterns": ["out of balance"],
  "likelyCause": "Short, factual explanation of the usual cause.",
  "steps": ["Safe check 1", "Safe check 2"],
  "alreadyDonePatterns": ["statement re-imported"],
  "links": [{ "title": "Sage Knowledgebase search: ...", "url": "https://za-kb.sage.com/..." }],
  "source": "Local knowledge base (support team)"
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique. Duplicates are ignored. |
| `title` | yes | Shown as the entry heading. |
| `product` | no | `Sage 300 People` or `Sage 300 Cloud`. A different product lowers the score. |
| `module` | no | One of `gl, ap, ar, ic, oe, po, bank, tax, si, people`. |
| `topicId` | no | A rule id from `extension/analyze.js` (`RULES`). Matching the topic is the strongest signal. |
| `keywords` | no | Phrases matched against the ticket text (weight 3 each). |
| `errorPatterns` | no | Error text matched against the ticket text (weight 5 each). |
| `phrases` | no | Single normalised words used for term overlap (weight 1 each). |
| `likelyCause` | yes | Presented as suggested guidance, never as a confirmed answer. |
| `steps` | yes | Safe, non-destructive checks. |
| `alreadyDonePatterns` | no | Documentation of work the rules engine already prunes. |
| `links` | no | **Must** be `https://` URLs; anything else is dropped when loading. |
| `source` | no | Shown under the entry so the reader knows where it came from. |

## Rules for new entries

1. An entry is only offered when it matches the topic or some wording in the ticket. Product or module alone is never enough.
2. Entries **never** override the rules engine. They are additive context shown in their own card.
3. Do not add guidance that contradicts an existing rule in `analyze.js`. Update the rule instead, or narrow the entry with `topicId`.
4. Never include customer names, site codes, contact details or ticket references.
5. Keep steps safe: check and confirm before changing live data.
6. Do not invent Knowledgebase article titles, menu paths or solution IDs. Link to a search or to an article you have actually opened.

## Adding or updating an entry

1. Edit `extension/knowledge/knowledge-base.json`.
2. Run `npm test` — `tests/knowledge.test.js` validates the file structure, the link scheme and the matching behaviour.
3. Reload the unpacked extension in `chrome://extensions/`.
