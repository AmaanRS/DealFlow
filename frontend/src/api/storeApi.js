const STORE_BASE_URL = '/v1/api/store'

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
    const error = new Error(data?.message ?? 'Stores could not be loaded.')
    error.status = response.status
    error.code = data?.code ?? 'STORE_REQUEST_FAILED'
    // NO_ELIGIBLE_STORE carries the offending article and requested quantity on
    // the body, which the fulfillment screen shows in the shortage callout.
    error.details = data ?? {}
    throw error
  }
  return data
}

export const storeApi = {
  list({ page = 1, limit = 100, search, itemIds = [] } = {}) {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    })
    if (search) query.set('search', search)
    if (itemIds.length) query.set('item_ids', itemIds.join(','))
    return request(`${STORE_BASE_URL}/get_stores?${query}`)
  },

  create(payload) {
    return request(`${STORE_BASE_URL}/create_store`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  /**
   * Allocate the quotation's physical lines to the nearest store holding enough
   * sellable stock. This writes the allocation onto the quote, so it is both the
   * suggestion and the acceptance. Resolves to `{ quote, store_split }`.
   */
  split(quoteId) {
    return request(`${STORE_BASE_URL}/store_split`, {
      method: 'POST',
      body: JSON.stringify({ quote_id: quoteId }),
    })
  },

  manualSplit(quoteId, stores) {
    return request(`${STORE_BASE_URL}/manual_store_split`, {
      method: 'PATCH',
      body: JSON.stringify({ quote_id: quoteId, stores }),
    })
  },
}
