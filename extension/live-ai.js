(function (root) {
  const HELPER = 'http://127.0.0.1:3000';

  function buildRequest(ticket, local, attachments, consent) {
    if (consent !== true) throw new Error('Confirm permission to send ticket evidence to OpenAI first.');
    if (!local || local.questionSource === 'Not provided') throw new Error('Analyze a ticket with a recorded query first.');
    return {
      consent: true,
      ticket: {
        product: local.product,
        productConflict: Boolean(local.productScope?.conflicts?.length),
        question: local.summary,
        release: local.fields?.version || '',
        resolutionsAttempted: local.fields?.resolutionsAttempted || ticket.resolutionsAttempted || '',
        stepsToReplicate: local.fields?.stepsToReplicate || '',
        actions: (ticket.actions || []).slice(0, 50).map((action) => ({
          action: action.action || action.actionType || '',
          date: action.actionDate || action.date || '',
          actionDescription: action.actionDescription || ''
        }))
      },
      attachments: attachments || []
    };
  }

  async function analyse(payload) {
    const response = await fetch(`${HELPER}/analyse-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NetAdmin-Request': 'live-analysis' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(160000)
    });
    const result = await response.json();
    if (!response.ok || !result.success || !result.analysis) {
      throw new Error(result.error || `Live AI failed (HTTP ${response.status}).`);
    }
    return result;
  }

  root.NetAdminLiveAI = { buildRequest, analyse };
})(typeof self !== 'undefined' ? self : globalThis);
