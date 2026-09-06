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

export const INTERNAL_ROLE_OPTIONS = Object.freeze([
  {
    value: USER_ROLES.SALES_REP,
    label: 'Sales representative',
    shortLabel: 'Sales rep',
    description: 'Build quotations, manage customers and submit deals for approval.',
  },
  {
    value: USER_ROLES.MANAGER,
    label: 'Sales manager',
    shortLabel: 'Manager',
    description: 'Review discount exceptions and monitor deal health.',
  },
  {
    value: USER_ROLES.FINANCE,
    label: 'Finance & operations',
    shortLabel: 'Finance',
    description: 'Review high-risk deals, billing and fulfilment decisions.',
  },
])

export const CUSTOMER_ROLE_OPTION = Object.freeze({
  value: USER_ROLES.CUSTOMER,
  label: 'Customer',
  shortLabel: 'Customer',
  description: 'Receive quotations and manage purchases for your organization.',
})

export const SIGNUP_ROLE_OPTIONS = Object.freeze([
  CUSTOMER_ROLE_OPTION,
  ...INTERNAL_ROLE_OPTIONS,
])

export const AUTH_ENDPOINTS = Object.freeze({
  register: '/v1/api/user/auth/signup',
  login: '/v1/api/user/auth/login',
  forgotPassword: '/v1/api/user/auth/forgot_password',
  me: '/v1/api/user/auth/me',
  logout: '/v1/api/user/auth/logout',
  registrationRequests: '/v1/api/admin/registration-requests',
  approveUser: '/v1/api/admin/approve_user',
  registrationDecision: (requestId) =>
    `/v1/api/admin/registration-requests/${encodeURIComponent(requestId)}`,
  discountPolicy: '/v1/api/admin/discount_policy',
  createTierDiscount: '/v1/api/admin/create_tier_discount',
  updateTierDiscount: '/v1/api/admin/tier_discount',
  createCategoryDiscount: '/v1/api/admin/create_category_discount',
  updateCategoryDiscount: '/v1/api/admin/category_discount',
  riskData: '/v1/api/admin/risks_data',
  configureRisk: '/v1/api/admin/configure_risk',
  portalSession: '/v1/api/portal/session',
  portalLogout: '/v1/api/portal/logout',
  portalInvitations: '/v1/api/portal/invitations',
  portalQuotations: '/v1/api/portal/quotations',
  portalQuotation: '/v1/api/portal/quotation',
  portalQuotationHistory: '/v1/api/portal/quotation-history',
  portalNegotiations: '/v1/api/portal/negotiations',
  portalConfirm: '/v1/api/portal/confirm',
})

export function getRoleLabel(role) {
  if (role === USER_ROLES.ADMIN) return 'Administrator'
  return SIGNUP_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role
}
