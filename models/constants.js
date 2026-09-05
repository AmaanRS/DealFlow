export const USER_ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  SALES_REP: 'SALES_REP',
  MANAGER: 'MANAGER',
  FINANCE: 'FINANCE',
  CUSTOMER: 'CUSTOMER',
})

export const USER_STATUSES = Object.freeze({
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
})

export const SESSION_KINDS = Object.freeze({
  INTERNAL: 'INTERNAL',
  CUSTOMER_PORTAL: 'CUSTOMER_PORTAL',
})

export const ITEM_CATEGORIES = Object.freeze([
  'HARDWARE',
  'SERVICES',
  'SUBSCRIPTION',
])

export const QUOTE_STATUSES = Object.freeze([
  'APPROVED',
  'REJECTED',
  'DRAFT',
  'PENDING_APPROVAL',
  'NEGOTIATION',
  'COMPLETED',
])

export const QUOTE_RISKS = Object.freeze(['LOW', 'MEDIUM', 'HIGH'])

export const SUBSCRIPTION_STATUSES = Object.freeze([
  'ACTIVE',
  'PAUSED',
  'CANCELLED',
])

export const AUTO_APPROVER = 'AUTO'
