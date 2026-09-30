document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('backendStatus').textContent = '✅ Offline rules engine ready';
  document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const status = document.getElementById('status');
    const results = document.getElementById('results');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { status.textContent = 'Open a NetAdmin ticket first.'; return; }
    chrome.tabs.sendMessage(tab.id, { action: 'scrapeTicket' }, response => {
      if (chrome.runtime.lastError || !response?.success) {
        status.textContent = 'Refresh the NetAdmin ticket page and try again.';
        return;
      }
      const result = NetAdminEngine.analyseTicket(response.data);
      results.replaceChildren();
      for (const [heading, content] of [
        ['Topic', result.topic.label],
        ['Suggested checks', result.topic.steps.join('\n')],
        ['Customer reply', result.reply]
      ]) {
        const section = document.createElement('div');
        section.className = 'result-section';
        const title = document.createElement('h3');
        title.textContent = heading;
        const body = document.createElement('p');
        body.textContent = content;
        body.style.whiteSpace = 'pre-wrap';
        section.append(title, body);
        results.append(section);
      }
      status.textContent = 'Offline analysis complete.';
    });
  });
  document.getElementById('historyBtn').addEventListener('click', () => {
    document.getElementById('status').textContent = 'Ticket history is not stored by the offline engine.';
  });
  document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('status').textContent = 'No server settings are required.';
  });
});
