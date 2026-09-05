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
    throw error
  }
  return data
}

export const storeApi = {
  list({ limit = 100 } = {}) {
    const query = new URLSearchParams({ limit: String(limit) })
    return request(`${STORE_BASE_URL}/get_stores?${query}`)
  },

  create(payload) {
    return request(`${STORE_BASE_URL}/create_store`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
}
