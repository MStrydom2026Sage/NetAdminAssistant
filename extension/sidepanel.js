/**
 * Side panel script.
 *
 * The analysis is produced by the local rules engine in the service worker.
 * Nothing here contacts an AI service, an API key or a helper server.
 */

let currentTicket = {};
let currentAnalysis = null;

document.addEventListener('DOMContentLoaded', async () => {
  const analyzeBtn = document.getElementById('analyzeBtn');
  const refreshSourcesBtn = document.getElementById('refreshSourcesBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const resultsContainer = document.getElementById('results');

  setStatus('Offline rules analysis ready', 'healthy');
  await loadSettings();
  await refreshHistoryCount();

  analyzeBtn?.addEventListener('click', () => analyzeActiveTab(resultsContainer));
  refreshSourcesBtn?.addEventListener('click', () => refreshSources(resultsContainer));
  clearCacheBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clearCache' }, () => setStatus('Cached analyses cleared', 'healthy'));
  });

  document.getElementById('copyReplyBtn')?.addEventListener('click', async () => {
    const value = document.getElementById('replyText').value;
    try {
      await navigator.clipboard.writeText(value);
      setStatus('Reply copied to the clipboard', 'healthy');
    } catch {
      setStatus('Select the reply text and copy it manually', 'error');
    }
  });

  document.getElementById('chatBtn')?.addEventListener('click', () => {
    const message = document.getElementById('chatInput').value;
    chrome.runtime.sendMessage({ action: 'chat', message, data: currentTicket }, (response) => {
      document.getElementById('chatReply').textContent = response?.reply || response?.error || 'No response available.';
    });
  });

  document.getElementById('liveSourcesToggle')?.addEventListener('change', saveSettings);
  document.getElementById('learnToggle')?.addEventListener('change', saveSettings);
  document.getElementById('resetHistoryBtn')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'resetHistory' }, async () => {
      await refreshHistoryCount();
      setStatus('Stored ticket learning removed from this device', 'healthy');
    });
  });
});

function setStatus(message, state) {
  const status = document.getElementById('backendStatus');
  if (!status) return;
  status.className = `status-indicator ${state || ''}`.trim();
  status.textContent = message;
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      const settings = response?.settings || {};
      const live = document.getElementById('liveSourcesToggle');
      const learn = document.getElementById('learnToggle');
      if (live) live.checked = Boolean(settings.liveSourcesEnabled);
      if (learn) learn.checked = settings.learnFromCompleted !== false;
      resolve(settings);
    });
  });
}

function saveSettings() {
  const data = {
    liveSourcesEnabled: document.getElementById('liveSourcesToggle')?.checked || false,
    learnFromCompleted: document.getElementById('learnToggle')?.checked || false
  };
  chrome.runtime.sendMessage({ action: 'saveSettings', data });
}

function refreshHistoryCount() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
      const count = response?.data?.length || 0;
      const label = document.getElementById('historyCount');
      if (label) {
        label.textContent = count
          ? `${count} anonymised completed ticket${count === 1 ? '' : 's'} stored locally (kept for up to 180 days).`
          : 'No completed-ticket learning stored on this device yet.';
      }
      resolve(count);
    });
  });
}

async function analyzeActiveTab(container) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return showError(container, 'Could not identify the active tab.');

  chrome.tabs.sendMessage(tab.id, { action: 'scrapeQueue' }, (queueResponse) => {
    if (chrome.runtime.lastError) return; // queue is optional
    const learn = document.getElementById('learnToggle')?.checked;
    const completed = queueResponse?.data?.completed || [];
    if (learn && completed.length) {
      chrome.runtime.sendMessage({ action: 'learnCompleted', data: completed }, () => refreshHistoryCount());
    }
  });

  chrome.tabs.sendMessage(tab.id, { action: 'scrapeTicket' }, (response) => {
    if (chrome.runtime.lastError) return showError(container, 'Refresh the NetAdmin page and try again.');
    if (response?.success) analyzeAndDisplay(response.data, container);
    else showError(container, response?.error || 'Could not read the ticket.');
  });
}

function analyzeAndDisplay(ticketData, container) {
  currentTicket = ticketData;
  container.innerHTML = '<div class="loading">Analyzing ticket…</div>';
  chrome.runtime.sendMessage({ action: 'analyze', data: ticketData }, (response) => {
    if (chrome.runtime.lastError) return showError(container, chrome.runtime.lastError.message);
    if (!response?.success) return showError(container, response?.error || 'Analysis failed.');
    currentAnalysis = response.data;
    renderAnalysis(response.data, response.fromCache, container);
    refreshSources(container, true);
  });
}

function refreshSources(container, silent) {
  if (!currentAnalysis) {
    if (!silent) setStatus('Analyze a ticket before refreshing the Sage sources.', 'error');
    return;
  }
  const payload = {
    query: currentAnalysis.query,
    product: currentAnalysis.product,
    moduleLabel: currentAnalysis.module?.label,
    terms: currentAnalysis.questionSource === 'Not provided' ? [] : NetAdminAnalyzer.normalizeTerms(currentAnalysis.summary)
  };
  chrome.runtime.sendMessage({ action: 'fetchSources', data: payload }, (response) => {
    if (chrome.runtime.lastError || !response?.success) return renderSources(null);
    renderSources(response.data);
  });
}

function showError(container, message) {
  container.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

function renderAnalysis(data, fromCache, container) {
  const { analysis, topic, knowledge, similarTickets } = data;
  const { rootCause, solution } = analysis;

  let html = `<div class="analysis-header"><h2>${escapeHtml(data.ticketId)}</h2>`
    + `${fromCache ? '<span class="badge cache">Cached</span>' : ''}`
    + `<span class="badge">Offline rules analysis</span>`
    + `<p class="metadata">${escapeHtml(data.product)}${data.module && data.module.id !== 'unknown' ? ` · ${escapeHtml(data.module.label)}` : ''} · ${escapeHtml(topic.label)}</p></div>`
    + `<div class="analysis-section"><h3>📝 Ticket query</h3><p class="confidence-text">Source: ${escapeHtml(data.questionSource)}</p>`
    + `<div class="content">${escapeHtml(data.querySummary || data.summary)}</div>`
    + `${data.querySummary && data.querySummary !== data.summary ? `<details><summary>Full recorded query</summary><div class="content">${escapeHtml(data.summary)}</div></details>` : ''}</div>`;

  html += `<div class="analysis-section root-cause"><h3>🔍 Suggested area (not confirmed)</h3>`
    + `<div class="confidence-bar" style="width:${Math.max(0, Math.min(100, rootCause.confidence * 100))}%"></div>`
    + `<p class="confidence-text">Rules confidence: ${(rootCause.confidence * 100).toFixed(0)}%</p>`
    + `<div class="content">${escapeHtml(rootCause.content)}</div>`
    + `${rootCause.evidence?.length ? `<div class="evidence"><strong>Confirmed evidence from the ticket:</strong><ul>${rootCause.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}</div>`;

  html += `<div class="analysis-section solution"><h3>✅ Suggested next steps</h3><div class="content">${escapeHtml(solution.content)}</div>`
    + `${solution.steps?.length ? `<ol class="steps">${solution.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : ''}</div>`;

  if (knowledge?.length) {
    html += '<div class="analysis-section solution"><h3>📘 Local knowledge base</h3><div class="search-sources">';
    knowledge.forEach((entry) => {
      html += `<div class="source"><span class="source-name">${escapeHtml(entry.title)}</span>`
        + `<div class="content">${escapeHtml(entry.likelyCause)}</div>`
        + `${entry.steps.length ? `<ol class="steps">${entry.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : ''}`
        + `${entry.links.length ? `<ul>${entry.links.map((link) => `<li>${safeLink(link)}</li>`).join('')}</ul>` : ''}`
        + `<p class="confidence-text">${escapeHtml(entry.source)} · suggested guidance</p></div>`;
    });
    html += '</div></div>';
  }

  html += '<div class="analysis-section" id="similarSection"><h3>🗂️ Similar completed tickets</h3>';
  if (similarTickets?.length) {
    html += '<p class="confidence-text">Historical context from completed tickets stored locally. Not authoritative.</p><div class="search-sources">';
    similarTickets.forEach((item) => {
      html += `<div class="source"><span class="source-name">${escapeHtml(item.reference)}${item.closedPeriod ? ` · closed ${escapeHtml(item.closedPeriod)}` : ''}</span>`
        + `<div class="content">${escapeHtml(item.summary)}</div>`
        + `${item.resolution ? `<div class="content"><strong>Recorded action:</strong> ${escapeHtml(item.resolution)}</div>` : '<p class="confidence-text">No resolution text was captured for this ticket.</p>'}`
        + `<p class="confidence-text">Match score ${escapeHtml(String(item.score))} · ${escapeHtml(item.confidence)}</p></div>`;
    });
    html += '</div>';
  } else {
    html += '<p class="confidence-text">No similar completed tickets were found in the local history.</p>';
  }
  html += '</div>';

  html += `<div class="analysis-section search"><h3>🔎 Sage searches</h3><div class="search-query"><strong>${escapeHtml(data.query)}</strong><div class="search-sources">`
    + `<div class="source"><span class="source-name">Pre-filled searches (click to open)</span><ul>${topic.links.map((link) => `<li>${safeLink(link)}</li>`).join('')}</ul></div>`
    + '</div></div><div id="liveSources"></div></div>';

  container.innerHTML = html;

  const replySection = document.getElementById('replySection');
  const replyText = document.getElementById('replyText');
  if (replySection && replyText) {
    replyText.value = data.reply;
    replySection.hidden = false;
  }
  renderSources(null);
}

function renderSources(sources) {
  const target = document.getElementById('liveSources');
  if (!target) return;
  if (!sources || sources.enabled === false) {
    target.innerHTML = '<p class="confidence-text">Live Sage Knowledgebase and Community Hub retrieval is switched off. The pre-filled searches above stay available.</p>';
    return;
  }
  if (!sources.results?.length) {
    target.innerHTML = `<p class="confidence-text">No live results could be read${sources.unavailable?.length ? ` (${escapeHtml(sources.unavailable.join(', '))} unavailable)` : ''}. Use the pre-filled searches above.</p>`;
    return;
  }
  const stamp = sources.fetchedAt ? new Date(sources.fetchedAt).toLocaleTimeString() : '';
  target.innerHTML = `<div class="source"><span class="source-name">Live Sage results${stamp ? ` · retrieved ${escapeHtml(stamp)}` : ''}</span><ul>`
    + sources.results.map((result) => `<li>${safeLink(result)}${result.articleId ? ` <span class="badge">ID ${escapeHtml(result.articleId)}</span>` : ''}${result.snippet ? `<div class="content">${escapeHtml(result.snippet)}</div>` : ''}<p class="confidence-text">${escapeHtml(result.source)}</p></li>`).join('')
    + `</ul>${sources.unavailable?.length ? `<p class="confidence-text">Unavailable: ${escapeHtml(sources.unavailable.join(', '))}</p>` : ''}</div>`;
}

/** Only render https links, with the text escaped. */
function safeLink(link) {
  const url = typeof link?.url === 'string' ? link.url : '';
  const title = escapeHtml(link?.title || url);
  if (!/^https:\/\//i.test(url)) return title;
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}
