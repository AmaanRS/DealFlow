const CUSTOMER_BASE_URL = '/v1/api/customer'

async function request(path) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data?.message ?? 'Customers could not be loaded.')
    error.status = response.status
    error.code = data?.code ?? 'CUSTOMER_REQUEST_FAILED'
    throw error
  }
  return data
}

export const customerApi = {
  list({ limit = 100, search } = {}) {
    const query = new URLSearchParams({ limit: String(limit) })
    if (search) query.set('search', search)
    return request(`${CUSTOMER_BASE_URL}/get_customers?${query}`)
  },
}
