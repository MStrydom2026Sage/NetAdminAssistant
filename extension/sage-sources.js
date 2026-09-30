/**
 * Optional live retrieval from the official Sage Knowledgebase and Sage
 * Community Hub.
 *
 * This is an enhancement only. Everything else in the extension works with no
 * network access at all. Retrieval uses the agent's own authenticated browser
 * session, a short timeout, a capped response size and a fixed result limit.
 * Automated reading of these pages must be approved by Sage IT / InfoSec and
 * can be switched off from the side panel (see docs/SAGE-SOURCES.md).
 */
(function (root) {
  'use strict';

  const TIMEOUT_MS = 6000;
  const MAX_BYTES = 400000;
  const MAX_RESULTS = 5;
  const MAX_SNIPPET = 220;

  // The Knowledgebase search endpoint that was used here
  // (/portal/app/portlets/results/viewsearch.jsp) now answers with
  // "HTTP Status 404 - Not Found". No replacement query endpoint has been
  // verified, so the Knowledgebase is configured with no search URL: it is
  // reported as unavailable for retrieval instead of being fetched, and its
  // home page is offered as a manual click-through. Its host stays on the
  // allowlist so that Knowledgebase links remain renderable and parsable.
  const SOURCES = [
    {
      id: 'kb-za',
      name: 'Sage Knowledgebase (ZA)',
      host: 'za-kb.sage.com',
      home: 'https://za-kb.sage.com/',
      search: '',
      unavailableReason: 'the Knowledgebase search endpoint was retired and returns HTTP 404; open the Knowledgebase and search there'
    },
    {
      id: 'kb-us',
      name: 'Sage Knowledgebase (US)',
      host: 'us-kb.sage.com',
      home: 'https://us-kb.sage.com/',
      search: '',
      unavailableReason: 'the Knowledgebase search endpoint was retired and returns HTTP 404; open the Knowledgebase and search there'
    },
    { id: 'community', name: 'Sage Community Hub', host: 'communityhub.sage.com', home: 'https://communityhub.sage.com/', search: 'https://communityhub.sage.com/search?q=' }
  ];

  // Branded error pages are served with a 200 status by some portals, so the
  // body is checked as well as the HTTP status.
  const ERROR_PAGE = /HTTP Status 404|status code[^<]{0,20}404|\b404\b[^<]{0,20}(?:not found|error)|not found[^<]{0,20}\b404\b|page (?:cannot be found|not found)|requested (?:resource|page|url)[^<]{0,40}(?:not (?:available|found)|unavailable)|service unavailable/i;

  /** True when the body is a branded 404 / unsupported page rather than results. */
  function looksLikeErrorPage(html) {
    if (typeof html !== 'string' || !html.trim()) return true;
    return ERROR_PAGE.test(html.slice(0, 4000));
  }

  const ALLOWED_HOSTS = SOURCES.map((source) => source.host);

  const text = (value) => (typeof value === 'string' ? value.trim() : '');

  const ENTITIES = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#039;': "'",
    '&apos;': "'"
  };

  // Single pass so a decoded "&" can never combine with following characters
  // to form another entity.
  function decodeEntities(value) {
    return text(value).replace(/&(?:nbsp|amp|lt|gt|quot|apos|#0?39);/gi, (match) => ENTITIES[match.toLowerCase()] || match);
  }

  function stripTags(value) {
    return decodeEntities(String(value == null ? '' : value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  /** Only absolute https links on the official Sage hosts are ever used. */
  function safeUrl(href, host) {
    const value = text(href);
    if (!value) return '';
    let absolute = value;
    if (value.startsWith('/')) absolute = `https://${host}${value}`;
    if (!/^https:\/\//i.test(absolute)) return '';
    const hostMatch = /^https:\/\/([^/?#]+)/i.exec(absolute);
    if (!hostMatch || !ALLOWED_HOSTS.includes(hostMatch[1].toLowerCase())) return '';
    return absolute.slice(0, 500);
  }

  const ARTICLE_ID = /(?:solution|article|kb)[^a-z0-9]{0,3}(\d{4,8})|[?&](?:solutionid|id)=(\d{4,8})/i;

  /**
   * Parse a Sage search results page into structured results.
   * Pure string parsing so it can be exercised from tests with static fixtures.
   */
  function parseResults(html, sourceId) {
    const source = SOURCES.find((item) => item.id === sourceId);
    if (!source || typeof html !== 'string') return [];
    const results = [];
    const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]{0,600}?)(?=<a\b|$)/gi;
    let match;
    while ((match = anchor.exec(html)) !== null && results.length < 40) {
      const url = safeUrl(decodeEntities(match[1]), source.host);
      const title = stripTags(match[2]).slice(0, 200);
      if (!url || title.length < 6) continue;
      if (results.some((item) => item.url === url)) continue;
      const snippetSource = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(match[3]);
      const idMatch = ARTICLE_ID.exec(url) || ARTICLE_ID.exec(title);
      results.push({
        source: source.name,
        sourceId: source.id,
        title,
        url,
        snippet: snippetSource ? stripTags(snippetSource[1]).slice(0, MAX_SNIPPET) : '',
        articleId: idMatch ? (idMatch[1] || idMatch[2]) : ''
      });
    }
    return results;
  }

  /**
   * Rank parsed results against the ticket evidence.
   * Nothing is invented: only the words already present in the result are used.
   */
  function rankResults(results = [], context = {}) {
    const terms = (context.terms || []).map((term) => term.toLowerCase()).filter(Boolean);
    return results
      .map((result, index) => {
        const haystack = `${result.title} ${result.snippet}`.toLowerCase();
        let score = 0;
        const matchedTerms = terms.filter((term) => new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'i').test(haystack));
        score += matchedTerms.length * 2;
        // An article identifier only breaks ties; it never makes an unrelated
        // result relevant on its own.
        if (matchedTerms.length >= 2 && result.articleId) score += 1;
        return Object.assign({}, result, { score, matchedTerms, index });
      })
      .filter((result) => result.matchedTerms.length >= 2)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, MAX_RESULTS)
      .map((result) => {
        const copy = Object.assign({}, result);
        delete copy.index;
        return copy;
      });
  }

  async function fetchText(url, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(url, {
        credentials: 'include',
        redirect: 'follow',
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error(`the page returned HTTP ${response.status}`);
      const body = (await response.text()).slice(0, MAX_BYTES);
      if (looksLikeErrorPage(body)) throw new Error('the page returned a not-found or unsupported response');
      return body;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Retrieve and rank results for one search phrase.
   * Any source that cannot be read is reported as unavailable; the pre-filled
   * search links in the side panel remain usable either way.
   */
  async function fetchSageSources(options = {}) {
    const query = text(options.query);
    if (!query || !Array.isArray(options.terms) || options.terms.length < 2) {
      return { enabled: true, fetchedAt: Date.now(), results: [], unavailable: [] };
    }
    const timeoutMs = options.timeoutMs || TIMEOUT_MS;
    const results = [];
    const unavailable = [];
    for (const source of SOURCES) {
      if (!source.search) {
        unavailable.push({ name: source.name, reason: source.unavailableReason || 'no supported search endpoint is configured', url: source.home || '' });
        continue;
      }
      try {
        const html = await fetchText(`${source.search}${encodeURIComponent(query)}`, timeoutMs);
        const parsed = parseResults(html, source.id);
        if (!parsed.length) unavailable.push({ name: source.name, reason: 'no result could be read from the page', url: source.home || '' });
        results.push(...parsed);
      } catch (error) {
        unavailable.push({ name: source.name, reason: (error && error.message) || 'the page could not be read', url: source.home || '' });
      }
    }
    return {
      enabled: true,
      fetchedAt: Date.now(),
      query,
      unavailable,
      results: rankResults(results, options)
    };
  }

  root.NetAdminSources = Object.freeze({
    SOURCES,
    ALLOWED_HOSTS,
    TIMEOUT_MS,
    MAX_RESULTS,
    parseResults,
    looksLikeErrorPage,
    rankResults,
    safeUrl,
    fetchSageSources
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
