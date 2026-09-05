import {
  INTERNAL_ROLE_OPTIONS,
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
    role: USER_ROLES.SALES_MANAGER,
    requestedRole: USER_ROLES.SALES_MANAGER,
    status: USER_STATUSES.ACTIVE,
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
    role: USER_ROLES.FINANCE_OPERATIONS,
    requestedRole: USER_ROLES.FINANCE_OPERATIONS,
    status: USER_STATUSES.ACTIVE,
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
  async register({ fullName, email, password, requestedRole }) {
    await wait()
    const users = readUsers()
    const normalisedEmail = normaliseEmail(email)
    const allowedRole = INTERNAL_ROLE_OPTIONS.some((role) => role.value === requestedRole)

    if (!allowedRole) {
      throw apiError(400, 'INVALID_ROLE', 'Choose one of the available internal roles.')
    }

    if (users.some((user) => user.email === normalisedEmail)) {
      throw apiError(409, 'EMAIL_ALREADY_REGISTERED', 'An account already uses this email.')
    }

    const submittedAt = new Date().toISOString()
    const user = {
      id: createId('usr'),
      fullName: String(fullName).trim(),
      email: normalisedEmail,
      password,
      role: null,
      requestedRole,
      status: USER_STATUSES.PENDING_APPROVAL,
      approval: {
        requestedAt: submittedAt,
        reviewedAt: null,
        reviewedByUserId: null,
        reason: null,
      },
    }
    users.push(user)
    writeUsers(users)

    return {
      request: {
        id: user.id,
        status: user.status,
        requestedRole: user.requestedRole,
        submittedAt,
        applicant: {
          fullName: user.fullName,
          email: user.email,
        },
      },
      message: 'Your access request has been sent to an administrator.',
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
      )
    }

    if (user.status !== USER_STATUSES.ACTIVE) {
      throw apiError(403, 'ACCOUNT_SUSPENDED', 'This account is currently unavailable.')
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

  async reviewRegistration(requestId, { decision, reason }) {
    await wait()
    const users = readUsers()
    const user = users.find((candidate) => candidate.id === requestId)
    if (!user) throw apiError(404, 'REQUEST_NOT_FOUND', 'Registration request not found.')

    user.status =
      decision === 'APPROVE' ? USER_STATUSES.ACTIVE : USER_STATUSES.REJECTED
    user.role = decision === 'APPROVE' ? user.requestedRole : null
    user.approval = {
      ...user.approval,
      reviewedAt: new Date().toISOString(),
      reviewedByUserId: 'usr_admin_demo',
      reason: reason || null,
    }
    writeUsers(users)
    return { user: registrationUser(user) }
  },
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
}
