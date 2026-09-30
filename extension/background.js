importScripts('offline-engine.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ analysisCache: {}, settings: { cacheEnabled: true } });
});

chrome.action.onClicked.addListener(tab => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openSidePanel') {
    const tabId = sender.tab?.id;
    if (tabId) chrome.sidePanel.open({ tabId }).catch(console.error);
    sendResponse({ success: !!tabId });
    return;
  }
  if (request.action === 'clearCache') {
    chrome.storage.local.set({ analysisCache: {} }, () => sendResponse({ success: true }));
    return true;
  }
  if (request.action === 'getHistory') {
    sendResponse({ success: true, data: [] });
    return;
  }
  if (request.action === 'getSettings') {
    chrome.storage.local.get('settings', data => sendResponse({ success: true, settings: data.settings || {} }));
    return true;
  }
  if (request.action === 'saveSettings') {
    chrome.storage.local.set({ settings: request.data }, () => sendResponse({ success: true }));
    return true;
  }
  if (request.action === 'chat') {
    sendResponse({ success: true, reply: NetAdminEngine.chat(request.message, request.data) });
    return;
  }
  if (request.action !== 'analyze') return;
  const ticket = request.data || {};
  const result = NetAdminEngine.analyseTicket(ticket);
  sendResponse({ success: true, data: { ticketId: result.ticketId, analysis: result.analysis, topic: result.topic, reply: result.reply, product: result.product, summary: result.summary, duration: 0 }, fromCache: false });
});
