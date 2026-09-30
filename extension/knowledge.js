/**
 * Curated local knowledge base loader.
 *
 * The knowledge file ships with the extension and is read with the extension's
 * own URL, so no network request and no third-party service is involved.
 */
(function (root) {
  'use strict';

  const text = (value) => (typeof value === 'string' ? value.trim() : '');

  /** Validate and normalise the raw knowledge file contents. */
  function normalizeKnowledge(raw) {
    const entries = raw && Array.isArray(raw.entries) ? raw.entries : [];
    const seen = new Set();
    const normalized = [];
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const id = text(entry.id) || `entry-${index}`;
      if (seen.has(id)) return;
      seen.add(id);
      normalized.push({
        id,
        title: text(entry.title) || id,
        product: text(entry.product),
        module: text(entry.module),
        topicId: text(entry.topicId),
        keywords: (entry.keywords || []).map(text).filter(Boolean),
        phrases: (entry.phrases || []).map(text).filter(Boolean),
        errorPatterns: (entry.errorPatterns || []).map(text).filter(Boolean),
        likelyCause: text(entry.likelyCause),
        steps: (entry.steps || []).map(text).filter(Boolean),
        alreadyDonePatterns: (entry.alreadyDonePatterns || []).map(text).filter(Boolean),
        links: (entry.links || [])
          .filter((link) => link && /^https:\/\//i.test(text(link.url)))
          .map((link) => ({ title: text(link.title) || text(link.url), url: text(link.url) })),
        source: text(entry.source) || 'Local knowledge base'
      });
    });
    return normalized;
  }

  let cache = null;

  /** Load the bundled knowledge file. Returns [] if it cannot be read. */
  async function loadKnowledge() {
    if (cache) return cache;
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) return [];
      const response = await fetch(chrome.runtime.getURL('knowledge/knowledge-base.json'));
      if (!response.ok) return [];
      cache = normalizeKnowledge(await response.json());
      return cache;
    } catch (error) {
      console.warn('[NetAdmin Assistant] Knowledge base unavailable:', error && error.message);
      return [];
    }
  }

  root.NetAdminKnowledge = Object.freeze({ loadKnowledge, normalizeKnowledge });
})(typeof globalThis !== 'undefined' ? globalThis : this);
