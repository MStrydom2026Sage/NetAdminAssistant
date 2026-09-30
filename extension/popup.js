/**
 * Popup Script
 * Quick access UI for the offline analysis.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const analyzeBtn = document.getElementById('analyzeBtn');
  const panelBtn = document.getElementById('panelBtn');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  const backendStatus = document.getElementById('backendStatus');

  if (backendStatus) {
    backendStatus.textContent = '✅ Offline rules analysis ready';
    backendStatus.className = 'status-indicator healthy';
  }

  analyzeBtn?.addEventListener('click', async () => {
    statusDiv.textContent = 'Reading ticket...';
    resultsDiv.textContent = '';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.tabs.sendMessage(tab.id, { action: 'scrapeTicket' }, async (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          statusDiv.textContent = 'Open a NetAdmin ticket and refresh the page.';
          return;
        }
        statusDiv.textContent = 'Analyzing ticket...';
        displayResults(await analyzeTicket(response.data));
      });
    } catch (error) {
      statusDiv.textContent = `Error: ${error.message}`;
    }
  });

  panelBtn?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.sidePanel?.open({ tabId: tab.id });
  });
});

async function analyzeTicket(ticketData) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'analyze', data: ticketData }, resolve);
  });
}

function displayResults(result) {
  const resultsDiv = document.getElementById('results');
  const statusDiv = document.getElementById('status');

  if (!result?.success) {
    statusDiv.textContent = `Analysis failed: ${result?.error || 'unknown error'}`;
    return;
  }

  const { data } = result;
  resultsDiv.textContent = '';
  resultsDiv.appendChild(section('Suggested area', data.analysis.rootCause.content));
  resultsDiv.appendChild(section('Suggested next steps', data.analysis.solution.steps.join('\n')));
  statusDiv.textContent = `Offline rules analysis completed in ${data.duration}ms`;
}

function section(title, body) {
  const wrapper = document.createElement('div');
  wrapper.className = 'result-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = body;
  wrapper.append(heading, paragraph);
  return wrapper;
}
