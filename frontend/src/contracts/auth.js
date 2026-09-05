export const USER_ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  SALES_REP: 'SALES_REP',
  SALES_MANAGER: 'SALES_MANAGER',
  FINANCE_OPERATIONS: 'FINANCE_OPERATIONS',
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
    value: USER_ROLES.SALES_MANAGER,
    label: 'Sales manager',
    shortLabel: 'Manager',
    description: 'Review discount exceptions and monitor deal health.',
  },
  {
    value: USER_ROLES.FINANCE_OPERATIONS,
    label: 'Finance & operations',
    shortLabel: 'Finance',
    description: 'Review high-risk deals, billing and fulfilment decisions.',
  },
])

export const AUTH_ENDPOINTS = Object.freeze({
  register: '/api/v1/auth/registrations',
  login: '/api/v1/auth/login',
  me: '/api/v1/auth/me',
  logout: '/api/v1/auth/logout',
  registrationRequests: '/api/v1/admin/registration-requests',
  registrationDecision: (requestId) =>
    `/api/v1/admin/registration-requests/${encodeURIComponent(requestId)}`,
  portalSession: '/api/v1/portal/session',
  portalLogout: '/api/v1/portal/logout',
  portalInvitations: '/api/v1/portal/invitations',
})

export function getRoleLabel(role) {
  if (role === USER_ROLES.ADMIN) return 'Administrator'
  return INTERNAL_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role
}
