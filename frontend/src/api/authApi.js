import { AUTH_ENDPOINTS } from '../contracts/auth.js'
import { mockAuthApi, mockPortalApi } from '../mocks/authMock.js'

const useMockApi = import.meta.env.VITE_USE_MOCK_AUTH === 'true'

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    ...options,
  })
  const data = response.status === 204 ? null : await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(data?.message ?? 'The request could not be completed.')
    error.status = response.status
    error.code = data?.code ?? 'REQUEST_FAILED'
    error.fields = data?.fields
    error.details = data?.details
    throw error
  }

  return data
}

const realAuthApi = {
  register(payload) {
    return request(AUTH_ENDPOINTS.register, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  login(payload) {
    return request(AUTH_ENDPOINTS.login, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  forgotPassword(payload) {
    return request(AUTH_ENDPOINTS.forgotPassword, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  resetPassword(payload) {
    return request(AUTH_ENDPOINTS.resetPassword, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  getCurrentUser() {
    return request(AUTH_ENDPOINTS.me)
  },

  logout() {
    return request(AUTH_ENDPOINTS.logout, { method: 'POST' })
  },

  listRegistrationRequests(status = 'PENDING_APPROVAL', { search } = {}) {
    const query = new URLSearchParams({ status })
    if (search) query.set('search', search)
    return request(`${AUTH_ENDPOINTS.registrationRequests}?${query}`)
  },

  approveUser(userId) {
    return request(AUTH_ENDPOINTS.approveUser, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    })
  },

  reviewRegistration(requestId, payload) {
    return request(AUTH_ENDPOINTS.registrationDecision(requestId), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },

  createTierDiscount(payload) {
    return request(AUTH_ENDPOINTS.createTierDiscount, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  getDiscountPolicy() {
    return request(AUTH_ENDPOINTS.discountPolicy)
  },

  updateTierDiscount(payload) {
    return request(AUTH_ENDPOINTS.updateTierDiscount, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },

  createCategoryDiscount(payload) {
    return request(AUTH_ENDPOINTS.createCategoryDiscount, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  updateCategoryDiscount(payload) {
    return request(AUTH_ENDPOINTS.updateCategoryDiscount, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },

  getRiskData() {
    return request(AUTH_ENDPOINTS.riskData)
  },

  configureRisk(payload) {
    return request(AUTH_ENDPOINTS.configureRisk, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
}

export const authApi = useMockApi ? mockAuthApi : realAuthApi

const realPortalApi = {
  exchangeAccessToken(accessToken) {
    return request(AUTH_ENDPOINTS.portalSession, {
      method: 'POST',
      body: JSON.stringify({ accessToken }),
    })
  },

  getSession() {
    return request(AUTH_ENDPOINTS.portalSession)
  },

  logout() {
    return request(AUTH_ENDPOINTS.portalLogout, { method: 'POST' })
  },

  listQuotations({ page = 1, limit = 50 } = {}) {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) })
    return request(`${AUTH_ENDPOINTS.portalQuotations}?${query}`)
  },

  getQuotation(quotationId) {
    const query = quotationId
      ? `?${new URLSearchParams({ quotationId })}`
      : ''
    return request(`${AUTH_ENDPOINTS.portalQuotation}${query}`)
  },

  getQuotationHistory(quotationId) {
    const query = new URLSearchParams({ quotationId })
    return request(`${AUTH_ENDPOINTS.portalQuotationHistory}?${query}`)
  },

  submitNegotiation(payload) {
    return request(AUTH_ENDPOINTS.portalNegotiations, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  confirmQuotation(quotationId) {
    return request(AUTH_ENDPOINTS.portalConfirm, {
      method: 'POST',
      body: JSON.stringify({ quotationId }),
    })
  },
}

export const portalApi = useMockApi ? mockPortalApi : realPortalApi
