const PRODUCT_BASE_URL = '/v1/api/product'
const categoryLabels = {
  HARDWARE: 'Hardware',
  SERVICES: 'Services',
  SUBSCRIPTION: 'Subscriptions',
}

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
    const error = new Error(data?.message ?? 'Products could not be loaded.')
    error.status = response.status
    error.code = data?.code ?? 'PRODUCT_REQUEST_FAILED'
    throw error
  }
  return data
}

export function flattenProducts(items) {
  return items.flatMap((item) =>
    (item.all_identifiers ?? []).flatMap((article) =>
      (item.categories ?? []).map((category) => ({
        id: `${article._id}:${category}`,
        itemId: String(item._id),
        articleId: String(article._id),
        sku: article.seller_identifier,
        name: item.name,
        category: categoryLabels[category] ?? category,
        categoryCode: category,
        price: article.price,
        cost: null,
        unit: item.cycle ?? 'Unit',
        reportingHsn: item.reporting_hsn,
        tax: null,
        stock: article.inventory?.sellable ?? 0,
        discountLimit: article.discount ?? 0,
        storeId: String(article.store_id?._id ?? article.store_id ?? ''),
        recurring: category === 'SUBSCRIPTION',
        description: `${article.inventory?.sellable ?? 0} available · ${item.reporting_hsn}`,
      })),
    ),
  )
}

export const productApi = {
  async list({ page = 1, limit = 100, category, search } = {}) {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    })
    if (category) query.set('category', category)
    if (search) query.set('search', search)
    const result = await request(`${PRODUCT_BASE_URL}/get_products?${query}`)
    return {
      ...result,
      products: flattenProducts(result.products ?? []),
    }
  },

  createHsn(payload) {
    return request(`${PRODUCT_BASE_URL}/create_hsn`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  create(payload) {
    return request(`${PRODUCT_BASE_URL}/create_product`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  addInventory(payload) {
    return request(`${PRODUCT_BASE_URL}/add_inventory`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  /**
   * Where each quoted line is currently being pulled from. Returns the article
   * behind the line with its populated store and the quoted quantity, which is
   * what the fulfillment screen groups into shipments.
   */
  quoteInventory(quoteId, { page = 1, limit = 100 } = {}) {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    })
    return request(
      `${PRODUCT_BASE_URL}/get_inv/${encodeURIComponent(quoteId)}?${query}`,
    )
  },
}
