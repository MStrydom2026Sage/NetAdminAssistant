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

  // Sage Knowledgebase routes:
  //  - /portal/app/portlets/results/viewsearch.jsp is retired and answers
  //    "HTTP Status 404 - Not Found". It is never requested.
  //  - /portal/app/portlets/results/viewsolution.jsp?solutionid=… is a single
  //    article. It needs a real solution ID, so it is only ever taken from a
  //    retrieved page, never constructed.
  //  - /portal/ss/?querytext=…&tabid=2[&searchaliases=…] is the search route,
  //    used only through the product routes in KB_SEARCH_ROUTES. Without a
  //    confirmed product there is no Knowledgebase search.
  const SOURCES = [
    {
      id: 'kb-za',
      name: 'Sage Knowledgebase (ZA)',
      host: 'za-kb.sage.com',
      home: 'https://za-kb.sage.com/',
      search: '',
      unavailableReason: 'no verified product-specific Knowledgebase search alias is configured; open the Knowledgebase and search there'
    },
    {
      id: 'kb-us',
      name: 'Sage Knowledgebase (US)',
      host: 'us-kb.sage.com',
      home: 'https://us-kb.sage.com/',
      search: '',
      unavailableReason: 'no verified product-specific Knowledgebase search alias is configured; open the Knowledgebase and search there'
    },
    { id: 'community', name: 'Sage Community Hub', host: 'communityhub.sage.com', home: 'https://communityhub.sage.com/', search: 'https://communityhub.sage.com/search?q=' }
  ];

  // Product Knowledgebase search routes. Every product gets a pre-filled
  // /portal/ss/ search:
  //  - alias routes restrict the search with a product search alias whose
  //    complete value is known. custom_us_threehundred; (US Knowledgebase,
  //    Sage 300 Cloud) comes in full from a working search URL supplied by the
  //    support team.
  //  - keyword routes are used where no full alias is known (the ZA Sage 300
  //    alias is only known truncated, custom_za_en_threehundr…, and no Sage 300
  //    People alias is known). The product name is added to the search text
  //    instead, so the search is pre-filled but not product-filtered by the
  //    Knowledgebase; each article still has to be checked. Never guess an
  //    alias: when one is confirmed, set `alias` and the route becomes filtered.
  // None of these routes could be validated live from the build environment.
  const KB_SEARCH_ROUTES = Object.freeze([
    Object.freeze({
      sourceId: 'kb-us',
      name: 'Sage Knowledgebase (US)',
      host: 'us-kb.sage.com',
      product: 'Sage 300 Cloud',
      alias: 'custom_us_threehundred;',
      keyword: ''
    }),
    Object.freeze({
      sourceId: 'kb-za',
      name: 'Sage Knowledgebase (ZA)',
      host: 'za-kb.sage.com',
      product: 'Sage 300 Cloud',
      alias: '',
      keyword: 'Sage 300 Cloud'
    }),
    Object.freeze({
      sourceId: 'kb-za',
      name: 'Sage Knowledgebase (ZA)',
      host: 'za-kb.sage.com',
      product: 'Sage 300 People',
      alias: '',
      keyword: 'Sage 300 People'
    })
  ]);

  /** Knowledgebase search routes for a product (empty if none). */
  function kbSearchRoutes(product) {
    return KB_SEARCH_ROUTES.filter((route) => route.product === product);
  }

  /**
   * The /portal/ss/ search URL for a route and a keyword phrase: filtered by
   * the product alias when one is known, otherwise with the product name
   * added to the search text.
   */
  function buildKbSearchUrl(route, query) {
    const searchText = route.alias ? text(query) : `${route.keyword || route.product} ${text(query)}`.trim();
    const querytext = encodeURIComponent(searchText).replace(/%20/g, '+');
    return `https://${route.host}/portal/ss/?querytext=${querytext}&tabid=2${route.alias ? `&searchaliases=${route.alias}` : ''}`;
  }

  /**
   * The product-filtered Knowledgebase landing page (no search text), as in
   * https://us-kb.sage.com/portal/ss/?tabid=3&searchaliases=custom_us_threehundred
   */
  function buildKbBrowseUrl(route) {
    if (!route.alias) return '';
    return `https://${route.host}/portal/ss/?tabid=3&searchaliases=${route.alias.replace(/;$/, '')}`;
  }

  /** A Knowledgebase article link, as opposed to navigation or search pages. */
  function isKbArticleUrl(url) {
    return /^https:\/\/[a-z]{2}-kb\.sage\.com\/portal\/app\/portlets\/results\/viewsolution\.jsp\?(?:[^#]*&)?solutionid=\d{4,20}(?:[&#]|$)/i.test(text(url));
  }

  // Branded error pages are served with a 200 status by some portals, so the
  // body is checked as well as the HTTP status.
  const ERROR_PAGE = /HTTP Status 404|status code[^<]{0,20}404|\b404\b[^<]{0,20}(?:not found|error)|not found[^<]{0,20}\b404\b|page (?:cannot be found|not found)|requested (?:resource|page|url)[^<]{0,40}(?:not (?:available|found)|unavailable)|service unavailable/i;

  // Sign-in walls are served with a 200 status as well.
  const SIGN_IN_PAGE = /<title>[^<]{0,80}\b(?:sign[\s-]?in|log[\s-]?in|login|single sign-on)\b[^<]{0,80}<\/title>|<input[^>]+type=["']?password|\b(?:please|you must)\s+(?:sign|log)\s*(?:in|on)\b/i;

  /** '' for a usable page, otherwise 'empty', 'error' or 'sign-in'. */
  function classifyPage(html) {
    if (typeof html !== 'string' || !html.trim()) return 'empty';
    if (ERROR_PAGE.test(html.slice(0, 4000))) return 'error';
    if (SIGN_IN_PAGE.test(html.slice(0, 20000))) return 'sign-in';
    return '';
  }

  /** True when the body is a branded 404, sign-in or unsupported page rather than results. */
  function looksLikeErrorPage(html) {
    return classifyPage(html) !== '';
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

  // Real solution IDs are up to 15 digits; the full ID is captured, never a prefix.
  const ARTICLE_ID = /[?&](?:solutionid|id)=(\d{4,20})(?!\d)|(?:solution|article|kb)[^a-z0-9]{0,3}(\d{4,20})(?!\d)/i;

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
  function productTools() {
    const analyzer = root.NetAdminAnalyzer;
    return analyzer && typeof analyzer.otherProductsIn === 'function' ? analyzer : null;
  }

  function rankResults(results = [], context = {}) {
    const terms = (context.terms || []).map((term) => term.toLowerCase()).filter(Boolean);
    const tools = productTools();
    const product = text(context.product);
    const known = Boolean(tools) && tools.PRODUCT_LABELS.includes(product);
    return results
      // Results naming another product are dropped even when the keywords match.
      .filter((result) => !known || !tools.otherProductsIn(`${result.title} ${result.snippet} ${result.url}`, product).length)
      .map((result, index) => {
        const haystack = `${result.title} ${result.snippet}`.toLowerCase();
        let score = 0;
        const matchedTerms = terms.filter((term) => new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'i').test(haystack));
        score += matchedTerms.length * 2;
        // An article identifier only breaks ties; it never makes an unrelated
        // result relevant on its own.
        if (matchedTerms.length >= 2 && result.articleId) score += 1;
        // Product-specific only when it came from a verified product-scoped
        // search or names the product itself.
        const productVerified = known && (result.productScoped === true
          || tools.mentionsProduct(`${result.title} ${result.snippet} ${result.url}`, product));
        return Object.assign({}, result, { score, matchedTerms, index, productVerified });
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
      const kind = classifyPage(body);
      if (kind === 'sign-in') throw new Error('the page asked for sign-in instead of returning results');
      if (kind) throw new Error('the page returned a not-found or unsupported response');
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
    const product = text(options.product);
    const tools = productTools();
    const known = Boolean(tools) && tools.PRODUCT_LABELS.includes(product);
    const results = [];
    const unavailable = [];
    for (const source of SOURCES) {
      const route = known ? kbSearchRoutes(product).find((item) => item.sourceId === source.id) : null;
      let url = '';
      if (route) url = buildKbSearchUrl(route, query);
      else if (source.search) url = `${source.search}${encodeURIComponent(known ? `${product} ${query}` : query)}`;
      if (!url) {
        unavailable.push({
          name: source.name,
          reason: known
            ? `no verified ${product} search alias is configured for this Knowledgebase; open it and search there`
            : 'the product is not confirmed, so no product-filtered Knowledgebase search is made',
          url: source.home || ''
        });
        continue;
      }
      try {
        const html = await fetchText(url, timeoutMs);
        // Knowledgebase pages only count when they link to actual articles.
        const parsed = parseResults(html, source.id)
          .filter((result) => !/kb\.sage\.com$/.test(source.host) || isKbArticleUrl(result.url))
          .map((result) => Object.assign(result, { productScoped: Boolean(route && route.alias) }));
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
    KB_SEARCH_ROUTES,
    kbSearchRoutes,
    buildKbBrowseUrl,
    buildKbSearchUrl,
    isKbArticleUrl,
    classifyPage,
    TIMEOUT_MS,
    MAX_RESULTS,
    parseResults,
    looksLikeErrorPage,
    rankResults,
    safeUrl,
    fetchSageSources
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
