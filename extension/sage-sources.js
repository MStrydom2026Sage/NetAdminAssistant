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

  const SOURCES = [
    { id: 'kb-za', name: 'Sage Knowledgebase (ZA)', host: 'za-kb.sage.com', search: 'https://za-kb.sage.com/portal/app/portlets/results/viewsearch.jsp?q=' },
    { id: 'kb-us', name: 'Sage Knowledgebase (US)', host: 'us-kb.sage.com', search: 'https://us-kb.sage.com/portal/app/portlets/results/viewsearch.jsp?q=' },
    { id: 'community', name: 'Sage Community Hub', host: 'communityhub.sage.com', search: 'https://communityhub.sage.com/search?q=' }
  ];

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
    const codes = (context.errorCodes || []).map((code) => code.toLowerCase());
    const moduleLabel = text(context.moduleLabel).toLowerCase();
    const product = text(context.product).toLowerCase();
    return results
      .map((result, index) => {
        const haystack = `${result.title} ${result.snippet}`.toLowerCase();
        let score = 0;
        const matchedTerms = terms.filter((term) => haystack.includes(term));
        score += matchedTerms.length * 2;
        score += codes.filter((code) => haystack.includes(code)).length * 6;
        if (moduleLabel && haystack.includes(moduleLabel)) score += 3;
        if (product && product !== 'sage product not specified' && haystack.includes(product)) score += 2;
        // An article identifier only breaks ties; it never makes an unrelated
        // result relevant on its own.
        if (score > 0 && result.articleId) score += 1;
        return Object.assign({}, result, { score, matchedTerms, index });
      })
      .filter((result) => result.score > 0)
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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      return body.slice(0, MAX_BYTES);
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
    if (!query) return { enabled: true, fetchedAt: Date.now(), results: [], unavailable: SOURCES.map((s) => s.name) };
    const timeoutMs = options.timeoutMs || TIMEOUT_MS;
    const results = [];
    const unavailable = [];
    for (const source of SOURCES) {
      try {
        const html = await fetchText(`${source.search}${encodeURIComponent(query)}`, timeoutMs);
        const parsed = parseResults(html, source.id);
        if (!parsed.length) unavailable.push(source.name);
        results.push(...parsed);
      } catch (error) {
        unavailable.push(source.name);
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
    rankResults,
    safeUrl,
    fetchSageSources
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
