/**
 * Static ticket fixtures. No customer data, no network access.
 */
function ticket(reference, product, summary, attempted = '', extra = {}) {
  const raw = [
    `Product: ${product}`,
    summary === null ? '' : `Summary of the query experienced and the outcome you are working towards: ${summary}`,
    extra.stepsToReplicate ? `Detail the steps to replicate the issue: ${extra.stepsToReplicate}` : '',
    `Describe the resolutions attempted: ${attempted}`
  ].filter(Boolean).join('\n');
  return Object.assign({
    incidentReference: reference,
    rawLoggedText: raw,
    customer: { contactName: 'Thandi' },
    attachments: extra.attachments || [],
    actions: [{ actionDescription: raw }]
  }, extra.ticket || {});
}

const TICKETS = [
  {
    name: 'BOM batch production',
    topic: 'bom-assembly',
    mode: 'guide',
    product: 'Sage 300 Cloud',
    module: 'ic',
    data: ticket('WF100001', 'Sage 300 Cloud', 'Bill of material for batch production of 93 loaves does not give the expected assembly quantity.')
  },
  {
    name: 'People tax PAYE',
    topic: 'people-tax-paye',
    mode: 'guide',
    product: 'Sage 300 People',
    module: 'people',
    data: ticket('WF100002', 'Sage 300 People', '[U60804] Employee tax PAYE difference between March and April.', 'Imported the latest generic tax tables and ran Company Rule recalculation.')
  },
  {
    name: 'Third-party compatibility',
    topic: 'third-party-compatibility',
    mode: 'search',
    product: 'Sage 300 Cloud',
    data: ticket('WF100003', 'Sage 300 Cloud', 'Is Peresoft Cashbook compatible with the latest Sage 300 Cloud release?')
  },
  {
    name: 'G/L control account',
    topic: 'gl-control-account',
    mode: 'guide',
    product: 'Sage 300 Cloud',
    module: 'gl',
    data: ticket('WF100004', 'Sage 300 Cloud', 'Cannot pick a vendor on a G/L control account journal entry.')
  },
  {
    name: 'Bank reconciliation',
    topic: 'bank-reconciliation',
    mode: 'guide',
    product: 'Sage 300 Cloud',
    module: 'bank',
    data: ticket('WF100005', 'Sage 300 Cloud', 'Bank reconciliation is out of balance after the OFX bank statement import.')
  },
  {
    name: 'ESS mobile registration',
    topic: 'people-ess-mobile',
    mode: 'guide',
    product: 'Sage 300 People',
    module: 'people',
    data: ticket('WF100006', 'Sage 300 People', 'Employee gets an invalid QR code when registering the ESS mobile app.')
  },
  {
    name: 'Generic fallback',
    topic: 'generic',
    mode: 'search',
    product: 'Sage 300 Cloud',
    data: ticket('WF100007', 'Sage 300 Cloud', 'The screen freezes after the weekend.')
  },
  {
    name: 'Missing summary',
    topic: 'generic',
    mode: 'search',
    product: 'Sage 300 Cloud',
    data: ticket('WF100008', 'Sage 300 Cloud', null)
  },
  {
    name: 'People MCS password',
    topic: 'people-mcs-password',
    mode: 'guide',
    product: 'Sage 300 People',
    module: 'people',
    data: ticket('WF100009', 'Sage 300 People', 'The MCS service will not start after the password was changed.')
  },
  {
    name: 'Tax Services setup',
    topic: 'tax-services',
    mode: 'guide',
    product: 'Sage 300 Cloud',
    module: 'tax',
    data: ticket('WF100010', 'Sage 300 Cloud', 'VAT is calculated incorrectly, the tax authority and tax class setup needs checking.')
  },
  {
    name: 'I/C Day End',
    topic: 'ic-day-end',
    mode: 'guide',
    product: 'Sage 300 Cloud',
    module: 'ic',
    data: ticket('WF100011', 'Sage 300 Cloud', 'Inventory costing is missing because Day End processing has not completed.')
  },
  {
    name: 'A/R history',
    topic: 'ar-history',
    mode: 'guide',
    product: 'Sage 300 Cloud',
    module: 'ar',
    data: ticket('WF100012', 'Sage 300 Cloud', 'A/R history does not show the customer statement transactions for the prior period.')
  },
  {
    name: 'Reporting connector',
    topic: 'reporting-connector',
    mode: 'guide',
    product: 'Sage 300 Cloud',
    module: 'si',
    data: ticket('WF100013', 'Sage 300 Cloud', 'Sage Intelligence SI Connector fails when refreshing the financial reporter layout.')
  },
  {
    name: 'G/L consolidations',
    topic: 'gl-consolidation',
    mode: 'guide',
    product: 'Sage 300 Cloud',
    module: 'gl',
    data: ticket('WF100014', 'Sage 300 Cloud', 'General ledger consolidation totals differ between the source and destination company.')
  }
];

const QUEUE = [
  { incidentReference: 'WF200001', stage: 'In Progress', priority: 'Medium', outline: 'Report layout' },
  { incidentReference: 'WF200002', stage: 'Logged', priority: 'Critical', outline: 'Payroll error - cannot run' },
  { incidentReference: 'WF200003', stage: 'Logged', priority: 'Low', outline: 'How to add user' },
  { incidentReference: 'WF200004', stage: 'Waiting for feedback', priority: 'High', outline: 'Tax difference' }
];

const COMPLETED = [
  {
    incidentReference: 'WF900001',
    summary: 'Bank reconciliation out of balance after OFX import for site code ZA12345',
    resolution: 'Two duplicated statement lines were removed and the reconciliation balanced. Contact jane@example.com 082 123 4567.',
    closedDate: '2026-04-18',
    product: 'Sage 300 Cloud'
  },
  {
    incidentReference: 'WF900002',
    summary: 'Employee tax PAYE difference after a backdated increase',
    resolution: 'The backdated earning changed the annual equivalent; recalculated the company rule and the PAYE agreed.',
    closedDate: '2026-03-02',
    product: 'Sage 300 People'
  },
  {
    incidentReference: 'WF900003',
    summary: 'Bill of material assembly yield incorrect for batch production',
    resolution: 'The component unit of measure was corrected on the bill of materials and the batch produced the expected quantity.',
    closedDate: '2026-02-11',
    product: 'Sage 300 Cloud'
  }
];

module.exports = { TICKETS, QUEUE, COMPLETED, ticket };
