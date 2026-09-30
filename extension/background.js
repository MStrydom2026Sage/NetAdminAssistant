/**
 * Background Service Worker
 * Handles extension initialization and message routing.
 *
 * All ticket analysis is performed locally by the rules engine. There is no
 * backend server, no API key and no AI provider.
 */

importScripts('analyze.js', 'knowledge.js', 'history.js', 'sage-sources.js');

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

const DEFAULT_SETTINGS = {
  showConfidence: true,
  cacheEnabled: true,
  maxCacheAge: CACHE_DURATION,
  liveSourcesEnabled: false,
  learnFromCompleted: true
};

// Initialize storage on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[NetAdmin Assistant] Extension installed/updated');

  const stored = await storageGet(['settings']);
  chrome.storage.local.set({
    analysisCache: {},
    settings: Object.assign({}, DEFAULT_SETTINGS, stored.settings || {})
  });
});

chrome.action.onClicked?.addListener((tab) => {
  if (tab?.id) chrome.sidePanel?.open({ tabId: tab.id }).catch(console.error);
});

/**
 * Message listener - handle requests from content/popup/sidepanel
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'analyze':
      handleAnalyze(request.data, sendResponse);
      return true; // Keep channel open for async

    case 'chat':
      handleChat(request, sendResponse);
      return true;

    case 'learnCompleted':
      NetAdminHistory.learnFromCompleted(request.data || [])
        .then((records) => sendResponse({ success: true, count: records.length }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;

    case 'resetHistory':
      NetAdminHistory.resetHistory().then(() => sendResponse({ success: true }));
      return true;

    case 'getHistory':
      NetAdminHistory.loadHistory().then((records) => sendResponse({ success: true, data: records }));
      return true;

    case 'fetchSources':
      handleFetchSources(request.data || {}, sendResponse);
      return true;

    case 'getSettings':
      storageGet(['settings']).then((data) =>
        sendResponse({ success: true, settings: Object.assign({}, DEFAULT_SETTINGS, data.settings || {}) })
      );
      return true;

    case 'saveSettings':
      chrome.storage.local.set({ settings: Object.assign({}, DEFAULT_SETTINGS, request.data || {}) }, () => {
        sendResponse({ success: true });
      });
      return true;

    case 'clearCache':
      chrome.storage.local.set({ analysisCache: {} }, () => sendResponse({ success: true }));
      return true;

    case 'openSidePanel': {
      const tabId = sender.tab?.id;
      if (tabId) chrome.sidePanel?.open({ tabId }).catch(console.error);
      sendResponse({ success: Boolean(tabId) });
      return false;
    }

    default:
      sendResponse({ error: 'Unknown action' });
      return false;
  }
});

/**
 * Handle ticket analysis request using the offline rules engine.
 */
async function handleAnalyze(data, sendResponse) {
  const started = Date.now();
  try {
    const ticket = data || {};
    const cacheKey = ticket.incidentReference || ticket.ticketId || '';
    const signature = JSON.stringify([ticket.question, ticket.rawLoggedText, ticket.summary, ticket.subject, ticket.description, ticket.product]);

    const cached = await getCachedAnalysis(cacheKey, signature);
    if (cached) {
      sendResponse({ success: true, data: cached, fromCache: true });
      return;
    }

    // Past-ticket learning is still stored locally and can be reset from the
    // side panel, but historical matches no longer feed the current diagnosis.
    const knowledge = await NetAdminKnowledge.loadKnowledge();

    const result = NetAdminAnalyzer.analyseTicket(ticket, { knowledge });
    const payload = Object.assign({}, result, { duration: Date.now() - started, engine: 'Offline rules analysis' });

    if (cacheKey) await cacheAnalysis(cacheKey, signature, payload);
    sendResponse({ success: true, data: payload, fromCache: false });
  } catch (error) {
    console.error('[NetAdmin Assistant] Analysis error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/** Scoped offline support chat. */
async function handleChat(request, sendResponse) {
  try {
    const knowledge = await NetAdminKnowledge.loadKnowledge();
    sendResponse({ success: true, reply: NetAdminAnalyzer.chat(request.message, request.data || {}, { knowledge }) });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Optional live retrieval from the official Sage Knowledgebase and Community
 * Hub. Disabled unless the user switches it on, and failures are reported
 * rather than hidden so the pre-filled search links remain the fallback.
 */
async function handleFetchSources(data, sendResponse) {
  try {
    const stored = await storageGet(['settings']);
    const settings = Object.assign({}, DEFAULT_SETTINGS, stored.settings || {});
    if (!settings.liveSourcesEnabled) {
      sendResponse({ success: true, data: { enabled: false, results: [], unavailable: [] } });
      return;
    }
    const result = await NetAdminSources.fetchSageSources(data);
    sendResponse({ success: true, data: result });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data || {})));
}

/**
 * Cache analysis result
 */
async function cacheAnalysis(ticketId, signature, result) {
  const data = await storageGet(['analysisCache']);
  const cache = data.analysisCache || {};
  cache[ticketId] = { data: result, signature, timestamp: Date.now() };
  return new Promise((resolve) => chrome.storage.local.set({ analysisCache: cache }, resolve));
}

/**
 * Retrieve cached analysis
 */
async function getCachedAnalysis(ticketId, signature) {
  if (!ticketId) return null;
  const data = await storageGet(['analysisCache', 'settings']);
  const settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
  if (!settings.cacheEnabled) return null;

  const cache = data.analysisCache || {};
  const cached = cache[ticketId];
  if (!cached) return null;

  if (cached.signature === signature && Date.now() - cached.timestamp < (settings.maxCacheAge || CACHE_DURATION)) return cached.data;

  delete cache[ticketId];
  chrome.storage.local.set({ analysisCache: cache });
  return null;
}
