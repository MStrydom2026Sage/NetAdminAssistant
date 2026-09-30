/**
 * Past-ticket learning.
 *
 * Completed NetAdmin tickets that the signed-in agent can already see are
 * reduced to an anonymised, local record so that new tickets can be matched
 * against work that has already been resolved. Everything stays in
 * chrome.storage.local and nothing is sent anywhere.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'completedTicketKnowledge';
  const MAX_RECORDS = 200;
  const MAX_AGE_DAYS = 180;
  const MAX_TEXT = 400;

  const text = (value) => (typeof value === 'string' ? value.trim() : '');

  const CONTACT_PATTERNS = [
    /[\w.+-]+@[\w-]+\.[\w.-]+/g,
    /\+?\d[\d\s()-]{7,}\d/g
  ];

  /** Remove contact details and customer codes from stored free text. */
  function sanitize(value) {
    const analyzer = root.NetAdminAnalyzer;
    let out = text(value);
    for (const pattern of CONTACT_PATTERNS) out = out.replace(pattern, '[removed]');
    if (analyzer) out = analyzer.stripSiteCodes(out);
    return out.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  }

  /** Stable non-identifying local label for a completed ticket. */
  function shortLabel(value) {
    let hash = 0x811c9dc5;
    const source = text(value);
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `past-${hash.toString(16).slice(0, 6)}`;
  }

  /** Reduce a completed ticket to the minimum anonymised record we keep. */
  function anonymizeCompletedTicket(ticket = {}) {
    const analyzer = root.NetAdminAnalyzer;
    if (!analyzer) return null;
    const summary = sanitize(ticket.summary || ticket.outline || ticket.subject || '');
    const resolution = sanitize(
      ticket.resolution
      || ticket.closureNotes
      || (ticket.actions || [])
        .map((action) => (typeof action === 'string' ? action : action && (action.actionDescription || action.description)))
        .filter(Boolean)
        .slice(-1)[0]
      || ''
    );
    if (!summary && !resolution) return null;
    const analysis = analyzer.analyseTicket({
      subject: summary,
      description: [summary, resolution].filter(Boolean).join('\n'),
      product: ticket.product
    });
    const closed = text(ticket.closedDate || ticket.completedDate || ticket.date);
    const period = /^(\d{4})[-/](\d{2})/.exec(closed);
    return {
      reference: shortLabel(ticket.incidentReference || ticket.ticketId || summary),
      topicId: analysis.topic.id,
      module: analysis.module.id,
      product: analysis.product,
      summary,
      resolution,
      terms: analyzer.normalizeTerms(`${summary} ${resolution}`).slice(0, 40),
      errorCodes: analyzer.extractErrorCodes(`${summary} ${resolution}`),
      closedPeriod: period ? `${period[1]}-${period[2]}` : '',
      storedAt: Date.now()
    };
  }

  /** Merge new records with the stored ones, applying the retention rules. */
  function mergeRecords(existing = [], incoming = [], now = Date.now()) {
    const cutoff = now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const byReference = new Map();
    existing.concat(incoming)
      .filter((record) => record && record.reference && (record.storedAt || 0) >= cutoff)
      .forEach((record) => byReference.set(record.reference, record));
    return Array.from(byReference.values())
      .sort((a, b) => (b.storedAt || 0) - (a.storedAt || 0))
      .slice(0, MAX_RECORDS);
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage) return resolve({});
      chrome.storage.local.get(key, (data) => resolve(data || {}));
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage) return resolve();
      chrome.storage.local.set(values, resolve);
    });
  }

  /** Read the stored completed-ticket knowledge. */
  async function loadHistory() {
    const data = await storageGet(STORAGE_KEY);
    const stored = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
    return mergeRecords(stored, []);
  }

  /** Learn from the completed queue scraped from the signed-in NetAdmin session. */
  async function learnFromCompleted(completedTickets = []) {
    const records = completedTickets.map(anonymizeCompletedTicket).filter(Boolean);
    if (!records.length) return loadHistory();
    const existing = await loadHistory();
    const merged = mergeRecords(existing, records);
    await storageSet({ [STORAGE_KEY]: merged });
    return merged;
  }

  /** Delete every stored completed-ticket record. */
  async function resetHistory() {
    await storageSet({ [STORAGE_KEY]: [] });
    return [];
  }

  root.NetAdminHistory = Object.freeze({
    STORAGE_KEY,
    MAX_RECORDS,
    MAX_AGE_DAYS,
    anonymizeCompletedTicket,
    mergeRecords,
    loadHistory,
    learnFromCompleted,
    resetHistory,
    shortLabel,
    sanitize
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
