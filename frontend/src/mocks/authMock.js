import {
  SIGNUP_ROLE_OPTIONS,
  USER_ROLES,
  USER_STATUSES,
} from '../contracts/auth.js'

const STORAGE_KEY = 'dealflow360.mock.users.v1'
const MOCK_DELAY_MS = 650

const seedUsers = [
  {
    id: 'usr_admin_demo',
    fullName: 'Aarav Mehta',
    email: 'admin@dealflow360.local',
    password: 'Admin@360',
    role: USER_ROLES.ADMIN,
    requestedRole: USER_ROLES.ADMIN,
    status: USER_STATUSES.ACTIVE,
    is_verified: true,
    is_deleted: false,
    approval: {
      requestedAt: null,
      reviewedAt: '2026-09-05T00:00:00.000Z',
      reviewedByUserId: 'SYSTEM',
      reason: 'Predefined platform administrator',
    },
  },
  {
    id: 'usr_sales_rep_demo',
    fullName: 'Mira Shah',
    email: 'rep@dealflow360.local',
    password: 'Demo@360',
    role: USER_ROLES.SALES_REP,
    requestedRole: USER_ROLES.SALES_REP,
    status: USER_STATUSES.ACTIVE,
    is_verified: true,
    is_deleted: false,
    approval: {
      requestedAt: '2026-09-04T09:00:00.000Z',
      reviewedAt: '2026-09-04T09:12:00.000Z',
      reviewedByUserId: 'usr_admin_demo',
      reason: null,
    },
  },
  {
    id: 'usr_manager_demo',
    fullName: 'Kabir Rao',
    email: 'manager@dealflow360.local',
    password: 'Demo@360',
    role: USER_ROLES.MANAGER,
    requestedRole: USER_ROLES.MANAGER,
    status: USER_STATUSES.ACTIVE,
    is_verified: true,
    is_deleted: false,
    approval: {
      requestedAt: '2026-09-04T09:00:00.000Z',
      reviewedAt: '2026-09-04T09:14:00.000Z',
      reviewedByUserId: 'usr_admin_demo',
      reason: null,
    },
  },
  {
    id: 'usr_finance_demo',
    fullName: 'Neha Iyer',
    email: 'finance@dealflow360.local',
    password: 'Demo@360',
    role: USER_ROLES.FINANCE,
    requestedRole: USER_ROLES.FINANCE,
    status: USER_STATUSES.ACTIVE,
    is_verified: true,
    is_deleted: false,
    approval: {
      requestedAt: '2026-09-04T09:00:00.000Z',
      reviewedAt: '2026-09-04T09:18:00.000Z',
      reviewedByUserId: 'usr_admin_demo',
      reason: null,
    },
  },
]

let activeUserId = null
let activePortalSession = null
let mockTierDiscounts = []
let mockCategoryDiscount = null
let mockRiskData = {
  configured: false,
  medium_risk_threshold: 25,
  high_risk_threshold: 50,
  line_item_rule: {
    condition: 'applied_discount > product_discount',
    minimum_risk: 'MEDIUM',
    configurable: false,
  },
  updated_by: null,
  updatedAt: null,
}

function wait() {
  return new Promise((resolve) => window.setTimeout(resolve, MOCK_DELAY_MS))
}

function normaliseEmail(email) {
  return String(email ?? '').trim().toLowerCase()
}

function createId(prefix) {
  const randomPart =
    globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 18)
  return `${prefix}_${randomPart}`
}

function readUsers() {
  try {
    const savedUsers = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    const savedEmails = new Set(savedUsers.map((user) => user.email))
    return [...seedUsers.filter((user) => !savedEmails.has(user.email)), ...savedUsers]
  } catch {
    return [...seedUsers]
  }
}

function writeUsers(users) {
  const nonSeedUsers = users.filter(
    (user) => !seedUsers.some((seedUser) => seedUser.id === user.id),
  )
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nonSeedUsers))
}

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    requestedRole: user.requestedRole,
    status: user.status,
    is_verified: user.is_verified ?? user.status === USER_STATUSES.ACTIVE,
    is_deleted: Boolean(user.is_deleted),
  }
}

function registrationUser(user) {
  return {
    ...publicUser(user),
    approval: { ...user.approval },
  }
}

function apiError(status, code, message, details) {
  const error = new Error(message)
  error.status = status
  error.code = code
  error.details = details
  return error
}

export const mockAuthApi = {
  async register({
    fullName,
    email,
    password,
    requestedRole = USER_ROLES.CUSTOMER,
    _custom_json = null,
  }) {
    await wait()
    const users = readUsers()
    const normalisedEmail = normaliseEmail(email)
    const allowedRole = SIGNUP_ROLE_OPTIONS.some(
      (role) => role.value === requestedRole,
    )

    if (!allowedRole) {
      throw apiError(400, 'INVALID_ROLE', 'Choose one of the available account types.')
    }

    if (requestedRole === USER_ROLES.CUSTOMER) {
      const hasValidCustomerDetails =
        String(_custom_json?.delivery_address ?? '').trim().length > 0 &&
        Number.isFinite(_custom_json?.lat) &&
        _custom_json.lat >= -90 &&
        _custom_json.lat <= 90 &&
        Number.isFinite(_custom_json?.long) &&
        _custom_json.long >= -180 &&
        _custom_json.long <= 180

      if (!hasValidCustomerDetails) {
        throw apiError(
          400,
          'INVALID_CUSTOMER_DETAILS',
          'Enter a delivery address and valid latitude and longitude.',
        )
      }
    }

    const existingUser = users.find((user) => user.email === normalisedEmail)
    if (existingUser && existingUser.status !== USER_STATUSES.REJECTED) {
      throw apiError(409, 'EMAIL_ALREADY_REGISTERED', 'An account already uses this email.')
    }

    const submittedAt = new Date().toISOString()
    const resubmitted = Boolean(existingUser)
    const user = existingUser ?? { id: createId('usr') }

    Object.assign(user, {
      fullName: String(fullName).trim(),
      email: normalisedEmail,
      password,
      role: null,
      requestedRole,
      status: USER_STATUSES.PENDING_APPROVAL,
      is_verified: false,
      is_deleted: false,
      _custom_json:
        requestedRole === USER_ROLES.CUSTOMER ? { ..._custom_json } : null,
      approval: {
        requestedAt: submittedAt,
        reviewedAt: null,
        reviewedByUserId: null,
        reason: null,
      },
    })
    if (!existingUser) users.push(user)
    writeUsers(users)

    return {
      request: {
        id: user.id,
        status: user.status,
        requestedRole: user.requestedRole,
        is_verified: false,
        submittedAt,
        resubmitted,
        applicant: {
          fullName: user.fullName,
          email: user.email,
        },
      },
      message: resubmitted
        ? 'Your new account request has been sent to an administrator.'
        : 'Your account request has been sent to an administrator.',
    }
  },

  async login({ email, password }) {
    await wait()
    const user = readUsers().find((candidate) => candidate.email === normaliseEmail(email))

    if (!user || user.password !== password) {
      throw apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
    }

    if (user.status === USER_STATUSES.PENDING_APPROVAL) {
      throw apiError(
        403,
        'ACCOUNT_PENDING_APPROVAL',
        'Your access request is still waiting for administrator approval.',
        {
          requestId: user.id,
          requestedRole: user.requestedRole,
          submittedAt: user.approval.requestedAt,
          applicant: {
            fullName: user.fullName,
            email: user.email,
          },
        },
      )
    }

    if (user.status === USER_STATUSES.REJECTED) {
      throw apiError(
        403,
        'ACCOUNT_REJECTED',
        user.approval.reason || 'This access request was not approved.',
        {
          reason: user.approval.reason || 'This access request was not approved.',
          reviewedAt: user.approval.reviewedAt,
          requestedRole: user.requestedRole,
          applicant: {
            fullName: user.fullName,
            email: user.email,
          },
        },
      )
    }

    if (user.status !== USER_STATUSES.ACTIVE) {
      throw apiError(403, 'ACCOUNT_SUSPENDED', 'This account is currently unavailable.')
    }

    if (user.is_verified === false) {
      throw apiError(
        403,
        'ACCOUNT_NOT_VERIFIED',
        'This account has not been verified by an administrator.',
      )
    }

    activeUserId = user.id
    return {
      user: publicUser(user),
      session: {
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      },
    }
  },

  async getCurrentUser() {
    await wait()
    const user = readUsers().find((candidate) => candidate.id === activeUserId)
    return user
      ? { authenticated: true, user: publicUser(user) }
      : { authenticated: false, user: null }
  },

  async forgotPassword() {
    await wait()
    return {
      message: 'If an account exists for that email, the password reset request has been accepted.',
    }
  },

  async logout() {
    await wait()
    activeUserId = null
  },

  async listRegistrationRequests() {
    await wait()
    return {
      items: readUsers()
        .filter((user) => user.status === USER_STATUSES.PENDING_APPROVAL)
        .map(registrationUser),
    }
  },

  async approveUser(userId) {
    await wait()
    const users = readUsers()
    const user = users.find((candidate) => candidate.id === userId)

    if (!user) throw apiError(404, 'REQUEST_NOT_FOUND', 'Registration request not found.')
    if (user.status !== USER_STATUSES.PENDING_APPROVAL) {
      throw apiError(409, 'REQUEST_ALREADY_REVIEWED', 'This registration request was already reviewed.')
    }

    user.status = USER_STATUSES.ACTIVE
    user.role = user.requestedRole
    user.is_verified = true
    user.is_deleted = false
    user.approval = {
      ...user.approval,
      reviewedAt: new Date().toISOString(),
      reviewedByUserId: 'usr_admin_demo',
      reason: null,
    }
    writeUsers(users)

    return { user: registrationUser(user) }
  },

  async reviewRegistration(requestId, { decision, reason }) {
    await wait()
    const users = readUsers()
    const user = users.find((candidate) => candidate.id === requestId)
    if (!user) throw apiError(404, 'REQUEST_NOT_FOUND', 'Registration request not found.')
    if (user.status !== USER_STATUSES.PENDING_APPROVAL) {
      throw apiError(409, 'REQUEST_ALREADY_REVIEWED', 'This registration request was already reviewed.')
    }

    user.status =
      decision === 'APPROVE' ? USER_STATUSES.ACTIVE : USER_STATUSES.REJECTED
    user.role = decision === 'APPROVE' ? user.requestedRole : null
    user.is_verified = decision === 'APPROVE'
    user.is_deleted = decision === 'REJECT'
    user.approval = {
      ...user.approval,
      reviewedAt: new Date().toISOString(),
      reviewedByUserId: 'usr_admin_demo',
      reason: reason || null,
    }
    writeUsers(users)
    return { user: registrationUser(user) }
  },

  async createTierDiscount({ tier, discount, threshold = 0 }) {
    await wait()
    const now = new Date().toISOString()
    const tierDiscount = {
      id: createId('tier'),
      tier,
      discount,
      threshold,
      createdAt: now,
      updatedAt: now,
    }
    mockTierDiscounts.push(tierDiscount)
    return { tier_discount: tierDiscount }
  },

  async getDiscountPolicy() {
    await wait()
    return {
      tier_discounts: [...mockTierDiscounts],
      category_discount: mockCategoryDiscount,
    }
  },

  async updateTierDiscount({ tier, discount, threshold }) {
    await wait()
    const existing = mockTierDiscounts.find(
      (item) => item.tier.toUpperCase() === tier.toUpperCase(),
    )
    const now = new Date().toISOString()
    // The real PATCH treats both fields as optional, so an omitted value keeps
    // whatever is already stored.
    const tierDiscount = existing
      ? {
          ...existing,
          discount: discount ?? existing.discount,
          threshold: threshold ?? existing.threshold ?? 0,
          updatedAt: now,
        }
      : {
          id: createId('tier'),
          tier,
          discount: discount ?? 0,
          threshold: threshold ?? 0,
          createdAt: now,
          updatedAt: now,
        }
    mockTierDiscounts = [
      ...mockTierDiscounts.filter((item) => item.id !== tierDiscount.id),
      tierDiscount,
    ]
    return { tier_discount: tierDiscount }
  },

  async createCategoryDiscount({ hardware, service, subscription }) {
    await wait()
    const now = new Date().toISOString()
    mockCategoryDiscount = {
      id: createId('category'),
      hardware,
      service,
      subscription,
      createdAt: now,
      updatedAt: now,
    }
    return { category_discount: mockCategoryDiscount }
  },

  async updateCategoryDiscount({ hardware, service, subscription }) {
    await wait()
    const now = new Date().toISOString()
    mockCategoryDiscount = {
      id: mockCategoryDiscount?.id ?? createId('category'),
      hardware,
      service,
      subscription,
      createdAt: mockCategoryDiscount?.createdAt ?? now,
      updatedAt: now,
    }
    return { category_discount: mockCategoryDiscount }
  },

  async getRiskData() {
    await wait()
    return { risk_data: mockRiskData }
  },

  async configureRisk({ medium_risk_threshold, high_risk_threshold }) {
    await wait()
    if (medium_risk_threshold >= high_risk_threshold) {
      throw apiError(
        400,
        'VALIDATION_ERROR',
        'The high threshold must be greater than the medium threshold.',
      )
    }
    mockRiskData = {
      ...mockRiskData,
      configured: true,
      medium_risk_threshold,
      high_risk_threshold,
      updatedAt: new Date().toISOString(),
    }
    return { risk_data: mockRiskData }
  },
}

let mockPortalQuotation = {
  id: 'quote_acme_demo',
  reference: 'Q-2026-0042',
  status: 'APPROVED',
  customer: {
    name: 'Acme Corporation',
    email: 'procurement@acme.example',
    tier: 'GOLD',
  },
  salesContact: 'rep@dealflow360.local',
  lines: [
    {
      id: 'line-laptop',
      articleId: 'article-laptop',
      name: 'Laptop Pro 14',
      sku: '84713010',
      category: 'HARDWARE',
      quantity: 2,
      unitPrice: 1200,
      discount: 12,
      tax: 18,
      subtotal: 2400,
      discountedTotal: 1795.2,
      total: 2118.34,
    },
    {
      id: 'line-service',
      articleId: 'article-service',
      name: 'Onsite Setup Service',
      sku: '998313',
      category: 'SERVICES',
      quantity: 1,
      unitPrice: 450,
      discount: 8,
      tax: 18,
      subtotal: 450,
      discountedTotal: 351.9,
      total: 415.24,
    },
  ],
  pricing: {
    subtotal: 2850,
    discountedSubtotal: 2147.1,
    discount: 702.9,
    tax: 386.48,
    total: 2533.58,
    tierDiscount: 15,
    orderDiscount: 0,
    taxIncluded: true,
  },
  revision: { version: 1, negotiationId: 'demo-negotiation' },
  latestRequest: null,
  createdAt: '2026-09-05T09:00:00.000Z',
  updatedAt: '2026-09-05T09:00:00.000Z',
  capabilities: { canNegotiate: true, canConfirm: true },
}

let mockPortalHistory = [{
  quoteId: mockPortalQuotation.id,
  version: 1,
  status: mockPortalQuotation.status,
  total: mockPortalQuotation.pricing.total,
  risk: 'LOW',
  isLatest: true,
  createdAt: mockPortalQuotation.createdAt,
}]

function requireMockPortalSession() {
  if (!activePortalSession) {
    throw apiError(
      401,
      'PORTAL_AUTHENTICATION_REQUIRED',
      'Open the secure quotation link to continue.',
    )
  }
}

function mockQuoteSummary(quotation) {
  return {
    id: quotation.id,
    reference: quotation.reference,
    status: quotation.status,
    lineCount: quotation.lines.length,
    total: quotation.pricing.total,
    revision: quotation.revision,
    salesContact: quotation.salesContact,
    createdAt: quotation.createdAt,
    updatedAt: quotation.updatedAt,
  }
}

function createMockRevision(status, latestRequest = null) {
  const submittedAt = new Date().toISOString()
  const version = mockPortalQuotation.revision.version + 1
  const quotation = {
    ...mockPortalQuotation,
    id: `quote_acme_demo_r${version}`,
    status,
    updatedAt: submittedAt,
    revision: { ...mockPortalQuotation.revision, version },
    latestRequest,
    capabilities: status === 'COMPLETED'
      ? { canNegotiate: false, canConfirm: false }
      : { canNegotiate: true, canConfirm: true },
  }
  mockPortalHistory = [
    {
      quoteId: quotation.id,
      version,
      status,
      total: quotation.pricing.total,
      risk: 'LOW',
      isLatest: true,
      createdAt: submittedAt,
    },
    ...mockPortalHistory.map((revision) => ({ ...revision, isLatest: false })),
  ]
  mockPortalQuotation = quotation
  return quotation
}

export const mockPortalApi = {
  async exchangeAccessToken(accessToken) {
    await wait()
    if (String(accessToken).trim() !== 'DF360-ACME-2026-DEMO') {
      throw apiError(401, 'INVALID_PORTAL_LINK', 'This quotation link is invalid or expired.')
    }

    activePortalSession = {
      customer: {
        name: 'Acme Corporation',
        email: 'procurement@acme.example',
      },
      quotation: {
        id: 'quote_acme_demo',
        reference: 'Q-2026-0042',
      },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }
    return { authenticated: true, ...activePortalSession }
  },

  async getSession() {
    await wait()
    return activePortalSession
      ? { authenticated: true, ...activePortalSession }
      : { authenticated: false }
  },

  async logout() {
    await wait()
    activePortalSession = null
  },

  async listQuotations() {
    await wait()
    requireMockPortalSession()
    return {
      quotations: [mockQuoteSummary(mockPortalQuotation)],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    }
  },

  async getQuotation(quotationId) {
    await wait()
    requireMockPortalSession()
    if (quotationId && quotationId !== mockPortalQuotation.id) {
      throw apiError(409, 'QUOTE_VERSION_CONFLICT', 'A newer revision exists. Refresh your quotations and try again.')
    }
    return { quotation: mockPortalQuotation }
  },

  async getQuotationHistory(quotationId) {
    await wait()
    requireMockPortalSession()
    if (quotationId !== mockPortalQuotation.id) {
      throw apiError(409, 'QUOTE_VERSION_CONFLICT', 'A newer revision exists. Refresh your quotations and try again.')
    }
    return {
      negotiationId: mockPortalQuotation.revision.negotiationId,
      revisions: mockPortalHistory,
    }
  },

  async submitNegotiation(payload) {
    await wait()
    requireMockPortalSession()
    if (payload.quotationId !== mockPortalQuotation.id) {
      throw apiError(409, 'QUOTE_VERSION_CONFLICT', 'A newer revision exists. Refresh your quotations and try again.')
    }
    const submittedAt = new Date().toISOString()
    const quotation = createMockRevision(
      'NEGOTIATION',
      { ...payload, submittedAt },
    )
    return { quotation }
  },

  async confirmQuotation(quotationId) {
    await wait()
    requireMockPortalSession()
    if (quotationId !== mockPortalQuotation.id) {
      throw apiError(409, 'QUOTE_VERSION_CONFLICT', 'A newer revision exists. Refresh your quotations and try again.')
    }
    return { quotation: createMockRevision('COMPLETED') }
  },
}
