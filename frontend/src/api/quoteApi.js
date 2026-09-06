const QUOTE_BASE_URL = '/v1/api/quote'

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
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(data?.message ?? 'Quotations could not be loaded.')
    error.status = response.status
    error.code = data?.code ?? 'QUOTE_REQUEST_FAILED'
    throw error
  }

  return data
}

export const quoteApi = {
  getPricingPolicy() {
    return request(`${QUOTE_BASE_URL}/pricing_policy`)
  },

  list({ page = 1, limit = 100, status, search } = {}) {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    })
    if (status) query.set('status', status)
    if (search) query.set('search', search)
    return request(`${QUOTE_BASE_URL}/get_quotes?${query}`)
  },

  /**
   * Quotations cleared for fulfillment. Morning Star already pins this to
   * `status: APPROVED` and the latest revision; the gateway additionally scopes
   * it to the signed-in rep.
   */
  listApproved({ page = 1, limit = 100 } = {}) {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    })
    return request(`${QUOTE_BASE_URL}/approved_quotes?${query}`)
  },

  get(quoteId) {
    return request(`${QUOTE_BASE_URL}/${encodeURIComponent(quoteId)}`)
  },

  getInvoice(quoteId) {
    return request(`/v1/api/customer/${encodeURIComponent(quoteId)}/invoice`)
  },

  create(payload) {
    return request(`${QUOTE_BASE_URL}/new_quotation`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  update(payload) {
    return request(`${QUOTE_BASE_URL}/quotation`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },

  review(payload, reviewerRole) {
    const approvalBaseUrl = reviewerRole === 'FINANCE'
      ? '/v1/api/finance'
      : '/v1/api/manager'
    return request(`${approvalBaseUrl}/approve_quote`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
}
