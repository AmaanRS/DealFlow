export const CUSTOMER_TIER_LIMITS = {
  Bronze: 5,
  Silver: 10,
  Gold: 15,
}

export const CATEGORY_DISCOUNT_LIMITS = {
  Hardware: 15,
  Services: 10,
  Subscriptions: 12,
}

export const products = [
  {
    id: 'prod-apexbook',
    sku: 'HW-APX-14',
    name: 'ApexBook Pro 14',
    category: 'Hardware',
    price: 125000,
    cost: 89000,
    unit: 'Unit',
    tax: 18,
    stock: 18,
    description: 'Business laptop with three-year on-site warranty.',
  },
  {
    id: 'prod-dock',
    sku: 'HW-DOCK-11',
    name: 'Universal USB-C Dock',
    category: 'Hardware',
    price: 18500,
    cost: 10800,
    unit: 'Unit',
    tax: 18,
    stock: 9,
    description: 'Dual-display dock, 100W power delivery and Ethernet.',
  },
  {
    id: 'prod-monitor',
    sku: 'HW-DISP-27',
    name: 'Clarity 27 Display',
    category: 'Hardware',
    price: 32000,
    cost: 21800,
    unit: 'Unit',
    tax: 18,
    stock: 24,
    description: '27-inch QHD monitor for managed workplace deployments.',
  },
  {
    id: 'prod-setup',
    sku: 'SV-SETUP-01',
    name: 'Deployment & Setup',
    category: 'Services',
    price: 28000,
    cost: 17500,
    unit: 'Project',
    tax: 18,
    stock: null,
    description: 'Configuration, deployment and employee onboarding service.',
  },
  {
    id: 'prod-training',
    sku: 'SV-TRAIN-08',
    name: 'Team Enablement Workshop',
    category: 'Services',
    price: 42000,
    cost: 23000,
    unit: 'Session',
    tax: 18,
    stock: null,
    description: 'Remote enablement workshop for up to 25 participants.',
  },
  {
    id: 'prod-care',
    sku: 'SUB-CARE-M',
    name: 'CloudCare Plus',
    category: 'Subscriptions',
    price: 7500,
    cost: 2200,
    unit: 'User / month',
    tax: 18,
    stock: null,
    recurring: true,
    plan: 'Monthly',
    description: 'Device monitoring, remote support and monthly health reports.',
  },
  {
    id: 'prod-secure',
    sku: 'SUB-SEC-Y',
    name: 'SecureDesk Enterprise',
    category: 'Subscriptions',
    price: 54000,
    cost: 18000,
    unit: 'Workspace / year',
    tax: 18,
    stock: null,
    recurring: true,
    plan: 'Yearly',
    description: 'Identity, device compliance and managed security policies.',
  },
]

const quoteLines = [
  { id: 'line-1', productId: 'prod-apexbook', quantity: 2, discount: 12 },
  { id: 'line-2', productId: 'prod-setup', quantity: 1, discount: 18 },
  { id: 'line-3', productId: 'prod-care', quantity: 12, discount: 8 },
]

export const initialQuotes = [
  {
    id: 'Q-2026-0042',
    customer: {
      name: 'Acme Corporation',
      email: 'procurement@acme.example',
      tier: 'Gold',
    },
    rep: 'Aanya Patel',
    stage: 'PENDING_APPROVAL',
    validUntil: '12 Sep 2026',
    createdAt: '05 Sep 2026',
    inactivityDays: 1,
    deliveryRisk: 'Low',
    orderDiscount: 0,
    lines: quoteLines,
    approvalSteps: [
      { id: 'step-manager', role: 'Sales manager', assignee: 'Mira Shah', status: 'PENDING' },
      { id: 'step-finance', role: 'Finance', assignee: 'Rohan Mehta', status: 'WAITING' },
    ],
    audit: [
      { id: 'audit-1', actor: 'Aanya Patel', action: 'Quotation submitted', detail: 'Automatic routing selected Manager + Finance.', time: 'Today, 10:42' },
      { id: 'audit-2', actor: 'DealFlow policy', action: 'High discount variance detected', detail: 'Deployment & Setup is 8 points above its category ceiling.', time: 'Today, 10:42' },
    ],
  },
  {
    id: 'Q-2026-0041',
    customer: { name: 'Beta Industries', email: 'ops@beta.example', tier: 'Silver' },
    rep: 'Aanya Patel',
    stage: 'NEGOTIATION',
    validUntil: '10 Sep 2026',
    createdAt: '02 Sep 2026',
    inactivityDays: 3,
    deliveryRisk: 'Medium',
    orderDiscount: 2,
    lines: [
      { id: 'line-4', productId: 'prod-monitor', quantity: 8, discount: 8 },
      { id: 'line-5', productId: 'prod-secure', quantity: 1, discount: 5 },
    ],
    approvalSteps: [
      { id: 'step-manager', role: 'Sales manager', assignee: 'Mira Shah', status: 'APPROVED' },
    ],
    audit: [
      { id: 'audit-3', actor: 'Mira Shah', action: 'Manager approval granted', detail: 'Approved with current delivery promise.', time: 'Yesterday, 16:20' },
      { id: 'audit-4', actor: 'Beta Industries', action: 'Requested a change', detail: 'Asked for delivery before 18 September.', time: 'Today, 09:15' },
    ],
  },
  {
    id: 'Q-2026-0040',
    customer: { name: 'Northstar Labs', email: 'finance@northstar.example', tier: 'Bronze' },
    rep: 'Kabir Singh',
    stage: 'DRAFT',
    validUntil: '18 Sep 2026',
    createdAt: '04 Sep 2026',
    inactivityDays: 1,
    deliveryRisk: 'Low',
    orderDiscount: 0,
    lines: [
      { id: 'line-6', productId: 'prod-apexbook', quantity: 3, discount: 4 },
      { id: 'line-7', productId: 'prod-dock', quantity: 3, discount: 4 },
    ],
    approvalSteps: [],
    audit: [
      { id: 'audit-5', actor: 'Kabir Singh', action: 'Draft created', detail: 'Created from Northstar opportunity.', time: 'Yesterday, 11:08' },
    ],
  },
  {
    id: 'Q-2026-0039',
    customer: { name: 'Helios Retail', email: 'buying@helios.example', tier: 'Gold' },
    rep: 'Aanya Patel',
    stage: 'FULFILLMENT',
    validUntil: '06 Sep 2026',
    createdAt: '29 Aug 2026',
    inactivityDays: 0,
    deliveryRisk: 'High',
    orderDiscount: 1,
    lines: [
      { id: 'line-8', productId: 'prod-apexbook', quantity: 14, discount: 10 },
      { id: 'line-9', productId: 'prod-dock', quantity: 14, discount: 9 },
      { id: 'line-10', productId: 'prod-care', quantity: 14, discount: 6 },
    ],
    approvalSteps: [
      { id: 'step-manager', role: 'Sales manager', assignee: 'Mira Shah', status: 'APPROVED' },
    ],
    audit: [
      { id: 'audit-6', actor: 'Helios Retail', action: 'Quotation confirmed', detail: 'Customer accepted the final commercial terms.', time: '02 Sep, 14:32' },
      { id: 'audit-7', actor: 'DealFlow inventory', action: 'Order split proposed', detail: 'Two warehouses required to protect the delivery date.', time: '02 Sep, 14:33' },
    ],
  },
  {
    id: 'Q-2026-0038',
    customer: { name: 'Vega Systems', email: 'admin@vega.example', tier: 'Silver' },
    rep: 'Meera Nair',
    stage: 'CONFIRMED',
    validUntil: '01 Sep 2026',
    createdAt: '25 Aug 2026',
    inactivityDays: 0,
    deliveryRisk: 'Low',
    orderDiscount: 0,
    lines: [
      { id: 'line-11', productId: 'prod-monitor', quantity: 4, discount: 6 },
      { id: 'line-12', productId: 'prod-training', quantity: 1, discount: 5 },
    ],
    approvalSteps: [],
    audit: [
      { id: 'audit-8', actor: 'Vega Systems', action: 'Quotation confirmed', detail: 'No additional approval was required.', time: '30 Aug, 12:04' },
    ],
  },
]

export const dashboardTrend = [
  { period: 'Mon', revenue: 640, margin: 31 },
  { period: 'Tue', revenue: 790, margin: 32 },
  { period: 'Wed', revenue: 720, margin: 29 },
  { period: 'Thu', revenue: 980, margin: 34 },
  { period: 'Fri', revenue: 1150, margin: 36 },
  { period: 'Sat', revenue: 920, margin: 35 },
  { period: 'Sun', revenue: 1280, margin: 37 },
]

export const warehouseData = [
  {
    id: 'wh-main',
    name: 'Main Warehouse',
    city: 'Mumbai',
    serviceLevel: 'Same day',
    shippingWeight: 1,
    utilization: 76,
    stock: { 'prod-apexbook': 10, 'prod-dock': 4, 'prod-monitor': 16 },
  },
  {
    id: 'wh-east',
    name: 'East Depot',
    city: 'Kolkata',
    serviceLevel: 'Next day',
    shippingWeight: 1.15,
    utilization: 54,
    stock: { 'prod-apexbook': 8, 'prod-dock': 5, 'prod-monitor': 8 },
  },
  {
    id: 'wh-south',
    name: 'South Hub',
    city: 'Bengaluru',
    serviceLevel: 'Next day',
    shippingWeight: 1.08,
    utilization: 61,
    stock: { 'prod-apexbook': 5, 'prod-dock': 11, 'prod-monitor': 12 },
  },
]

export const subscriptionPlans = [
  { id: 'plan-monthly', name: 'Monthly Flex', cadence: 'Monthly', proration: 'Daily', cancellation: 'Credit unused days', activeProducts: 2 },
  { id: 'plan-quarterly', name: 'Quarterly Commit', cadence: 'Quarterly', proration: 'Daily', cancellation: 'Credit next invoice', activeProducts: 1 },
  { id: 'plan-yearly', name: 'Annual Advantage', cadence: 'Yearly', proration: 'Monthly', cancellation: 'Approval required', activeProducts: 3 },
]

export const reportRows = [
  { month: 'April', quotations: 42, won: 18, revenue: 3240000, avgDiscount: 7.2, margin: 31.4 },
  { month: 'May', quotations: 48, won: 23, revenue: 3980000, avgDiscount: 7.8, margin: 30.9 },
  { month: 'June', quotations: 51, won: 27, revenue: 4470000, avgDiscount: 8.1, margin: 32.5 },
  { month: 'July', quotations: 57, won: 31, revenue: 5140000, avgDiscount: 7.4, margin: 34.1 },
  { month: 'August', quotations: 62, won: 36, revenue: 5960000, avgDiscount: 8.6, margin: 33.8 },
  { month: 'September', quotations: 38, won: 19, revenue: 4260000, avgDiscount: 8.2, margin: 35.2 },
]

export const upsellSuggestions = [
  { id: 'suggest-dock', productId: 'prod-dock', reason: 'Added in 72% of similar laptop deals', marginDelta: 7700, promoted: true },
  { id: 'suggest-training', productId: 'prod-training', reason: 'High adoption for 10+ user rollouts', marginDelta: 19000, promoted: false },
  { id: 'suggest-secure', productId: 'prod-secure', reason: 'Frequently paired with CloudCare Plus', marginDelta: 36000, promoted: true },
]

export const discountRules = [
  { tier: 'Bronze', ceiling: 5, managerFrom: 6, financeFrom: 14 },
  { tier: 'Silver', ceiling: 10, managerFrom: 11, financeFrom: 18 },
  { tier: 'Gold', ceiling: 15, managerFrom: 16, financeFrom: 22 },
]

export const stageMeta = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  NEGOTIATION: { label: 'Under negotiation', tone: 'info' },
  FULFILLMENT: { label: 'Fulfillment', tone: 'violet' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  REVISION: { label: 'Revision requested', tone: 'warning' },
  COMPLETED: { label: 'Completed', tone: 'success' },
}

export function cloneSeedQuotes() {
  return JSON.parse(JSON.stringify(initialQuotes))
}
