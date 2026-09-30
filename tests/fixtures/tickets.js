function ticket(ref, product, summary, tried = '', attachments = []) {
  const raw = `Product: ${product}\n${summary === null ? '' : `Summary of the query experienced and the outcome you are working towards: ${summary}\n`}Describe the resolutions attempted: ${tried}`;
  return { incidentReference: ref, rawLoggedText: raw, customer: { contactName: 'Thandi' }, attachments, actions: [{ actionDescription: raw }] };
}
const TICKETS = [
  { name: 'BOM batch', data: ticket('WF100001', 'Sage 300 Cloud', 'Bill of material for batch production of 93 loaves.'), topic: 'bom-batch', mode: 'guide' },
  { name: 'People tax PAYE', data: ticket('WF100002', 'Sage 300 People', '[U60804] Employee tax difference PAYE.', 'Imported the latest generic tax tables and ran Company Rule recalculation.'), topic: 'tax-tables', mode: 'guide', product: 'Sage 300 People' },
  { name: 'Third-party compatibility', data: ticket('WF100003', 'Sage 300 Cloud', 'Is Peresoft Cashbook compatible?'), topic: 'external-third-party', mode: 'search' },
  { name: 'G/L control account', data: ticket('WF100004', 'Sage 300 Cloud', 'Pick vendor on G/L control account.'), topic: 'gl-vendor-customer-control', mode: 'guide' },
  { name: 'Bank reconciliation', data: ticket('WF100005', 'Sage 300 Cloud', 'Bank reconciliation out of balance after OFX import.'), topic: 'bank-reconcile', mode: 'guide' },
  { name: 'ESS mobile', data: ticket('WF100006', 'Sage 300 People', 'Invalid QR code in ESS mobile app.'), topic: 'ess-mobile', mode: 'guide', product: 'Sage 300 People' },
  { name: 'Generic fallback', data: ticket('WF100007', 'Sage 300 Cloud', 'Screen freezes after weekend.'), topic: 'generic', mode: 'search' },
  { name: 'Missing summary', data: ticket('WF100008', 'Sage 300 Cloud', null), topic: 'generic', mode: 'search' }
];
const QUEUE = [
  { incidentReference: 'WF200001', stage: 'In Progress', priority: 'Medium', outline: 'Report layout' },
  { incidentReference: 'WF200002', stage: 'Logged', priority: 'Critical', outline: 'Payroll error - cannot run' },
  { incidentReference: 'WF200003', stage: 'Logged', priority: 'Low', outline: 'How to add user' },
  { incidentReference: 'WF200004', stage: 'Waiting for feedback', priority: 'High', outline: 'Tax difference' }
];
module.exports = { TICKETS, QUEUE };
