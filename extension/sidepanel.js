document.addEventListener('DOMContentLoaded', async () => {
  const analyzeBtn = document.getElementById('analyzeBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const resultsContainer = document.getElementById('results');
  const status = document.getElementById('backendStatus');
  status.className = 'status-indicator healthy';
  status.textContent = '✅ Offline rules engine ready';
  analyzeBtn?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return showError(resultsContainer, 'Could not identify the active tab.');
    chrome.tabs.sendMessage(tab.id, { action: 'scrapeTicket' }, async (response) => {
      if (chrome.runtime.lastError) return showError(resultsContainer, 'Refresh the NetAdmin page and try again.');
      if (response?.success) await analyzeAndDisplay(response.data, resultsContainer);
      else showError(resultsContainer, response?.error || 'Could not read the ticket.');
    });
  });
  clearCacheBtn?.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'clearCache' }, () => alert('Cache cleared')));
  document.getElementById('chatBtn')?.addEventListener('click', () => {
    const message = document.getElementById('chatInput').value;
    const reply = NetAdminEngine.chat(message, currentTicket);
    document.getElementById('chatReply').textContent = reply;
  });
});

let currentTicket = {};

function analyzeAndDisplay(ticketData, container) {
  currentTicket = ticketData;
  container.innerHTML = '<div class="loading">Analyzing ticket…</div>';
  chrome.runtime.sendMessage({ action: 'analyze', data: ticketData }, (response) => {
    if (chrome.runtime.lastError) return showError(container, chrome.runtime.lastError.message);
    if (response?.success) renderAnalysis(response.data, response.fromCache, container);
    else showError(container, response?.error || 'Analysis failed.');
  });
}
function showError(container, message) { container.innerHTML = `<div class="error">${escapeHtml(message)}</div>`; }
function renderAnalysis(data, fromCache, container) {
  const { analysis, duration } = data; const { rootCause, solution, searchResults } = analysis;
  let html = `<div class="analysis-header"><h2>${escapeHtml(data.ticketId)}</h2>${fromCache ? '<span class="badge cache">Cached</span>' : ''}<p class="metadata">Offline rules engine · ${escapeHtml(data.product)}</p></div>`;
  html += `<div class="analysis-section root-cause"><h3>🔍 Root Cause Analysis</h3><div class="confidence-bar" style="width:${Math.max(0, Math.min(100, rootCause.confidence * 100))}%"></div><p class="confidence-text">Confidence: ${(rootCause.confidence * 100).toFixed(0)}%</p><div class="content">${escapeHtml(rootCause.content)}</div>${rootCause.evidence?.length ? `<div class="evidence"><strong>Evidence:</strong><ul>${rootCause.evidence.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>` : ''}</div>`;
  html += `<div class="analysis-section solution"><h3>✅ Recommended Solution</h3><div class="content">${escapeHtml(solution.content)}</div>${solution.steps?.length ? `<ol class="steps">${solution.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}</div>`;
  html += '<div class="analysis-section search"><h3>🔎 Knowledge Base Search</h3>';
  if (searchResults?.length) searchResults.forEach(result => { html += `<div class="search-query"><strong>${escapeHtml(result.query)}</strong><div class="search-sources">`; Object.entries(result.results || {}).forEach(([source, sourceData]) => { if (sourceData?.results?.length) html += `<div class="source"><span class="source-name">${escapeHtml(sourceData.source || source)}</span><ul>${sourceData.results.slice(0, 3).filter(item => /^https:\/\/(?:help|community)\.sage\.com\/$/.test(item.url)).map(item => `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></li>`).join('')}</ul></div>`; }); html += '</div></div>'; });
  else html += '<p>No search results available.</p>';
  container.innerHTML = `${html}</div><div class="analysis-section solution"><h3>Suggested customer reply</h3><div class="content">${escapeHtml(data.reply)}</div></div>`;
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value == null ? '' : String(value); return div.innerHTML; }
