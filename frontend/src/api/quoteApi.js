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

  list({ page = 1, limit = 100, status } = {}) {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    })
    if (status) query.set('status', status)
    return request(`${QUOTE_BASE_URL}/get_quotes?${query}`)
  },

  get(quoteId) {
    return request(`${QUOTE_BASE_URL}/${encodeURIComponent(quoteId)}`)
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
}
