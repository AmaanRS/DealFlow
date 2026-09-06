import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { normalizeProductCategory } from '../api/productApi.js'
import { quoteApi } from '../api/quoteApi.js'
import { calculateQuote } from './dealMath.js'
import { MOVABLE_STAGES } from './quoteStages.js'

const WorkspaceContext = createContext(null)

function formatDate(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function daysSince(value) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000))
}

function displayCategory(value) {
  const knownCategory = {
    HARDWARE: 'Hardware',
    SERVICES: 'Services',
    SUBSCRIPTION: 'Subscriptions',
  }[value]
  if (knownCategory) return knownCategory
  const label = String(value || 'Product').toLowerCase()
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function approvalStepsFor(quote) {
  if (!['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(quote.status)) {
    return []
  }

  if (quote.risk === 'LOW') return []

  if (quote.risk !== 'HIGH') {
    return [{
      id: `approval-manager-${quote._id}`,
      role: 'Sales manager',
      assignee: quote.approved_by ?? quote.assigned_to,
      status:
        quote.status === 'PENDING_APPROVAL'
          ? 'PENDING'
          : quote.status === 'APPROVED'
            ? 'APPROVED'
            : 'REJECTED',
    }]
  }

  const managerCompleted = Boolean(quote.approved_by)
  const financeCompleted = quote.status === 'APPROVED'
  const financeRejected = quote.status === 'REJECTED' && managerCompleted

  return [
    {
      id: `approval-manager-${quote._id}`,
      role: 'Sales manager',
      assignee: managerCompleted && !financeCompleted
        ? quote.approved_by
        : managerCompleted
          ? 'Completed before Finance review'
          : quote.assigned_to,
      status: managerCompleted
        ? 'APPROVED'
        : quote.status === 'REJECTED'
          ? 'REJECTED'
          : 'PENDING',
    },
    {
      id: `approval-finance-${quote._id}`,
      role: 'Finance',
      assignee: managerCompleted ? quote.assigned_to : 'Assigned after manager approval',
      status: financeCompleted
        ? 'APPROVED'
        : financeRejected
          ? 'REJECTED'
          : managerCompleted
            ? 'PENDING'
            : 'WAITING',
    },
  ]
}

function toWorkspaceQuote(quote) {
  const customer = quote.customer && typeof quote.customer === 'object'
    ? quote.customer
    : { _id: quote.customer }

  return {
    id: String(quote._id),
    serverManaged: true,
    customer: {
      id: String(customer._id ?? quote.customer),
      name: customer.fullName ?? 'Customer record unavailable',
      email: customer.email ?? '',
      tier: customer._custom_json?.tier ?? 'Unassigned',
    },
    rep: quote.created_by,
    stage: quote.status,
    validUntil: 'Not configured',
    createdAt: formatDate(quote.createdAt),
    inactivityDays: daysSince(quote.updatedAt),
    deliveryRisk: displayCategory(quote.risk),
    orderDiscount: quote.order_discount ?? 0,
    lines: (quote.products ?? []).map((product) => ({
      id: String(product._id ?? product.article_id),
      productId: String(product.item_id),
      articleId: String(product.article_id),
      quantity: Math.max(1, Number(product.inv) || 1),
      discount: Number(product.applied_discount) || 0,
      allowedDiscount: Number(product.product_discount) || 0,
      product: {
        id: String(product.item_id),
        articleId: String(product.article_id),
        sku: product.hsn,
        name: product.name,
        category: displayCategory(product.category),
        categoryCode: product.category,
        price: product.unit_price,
        cost: null,
        unit: 'Unit',
        tax: product.gst,
        stock: null,
        recurring: product.category === 'SUBSCRIPTION',
        plan: product.category === 'SUBSCRIPTION' ? 'Recurring' : null,
        discountLimit: Number(product.product_discount) || 0,
        categoryDiscount: Number(product.category_discount) || 0,
        description: `HSN ${product.hsn}`,
      },
    })),
    approvalSteps: approvalStepsFor(quote),
    audit: [{
      id: `audit-${quote._id}`,
      actor: quote.approved_by ?? quote.created_by,
      action: quote.status === 'DRAFT' ? 'Quotation created' : `Status: ${quote.status}`,
      detail: quote.reason ?? 'Quotation data loaded from Morning Star.',
      time: formatDate(quote.updatedAt),
    }],
    fulfillmentDetails: quote.fulfillment_details ?? [],
    serverPricing: {
      gross: quote.cost_price ?? 0,
      discounted: quote.discounted_price ?? 0,
      total: quote.selling_price ?? 0,
      tierDiscount: quote.tier_discount ?? 0,
      risk: quote.risk,
    },
  }
}

function createAudit(actor, action, detail) {
  return {
    id: `audit-${crypto.randomUUID()}`,
    actor,
    action,
    detail,
    time: 'Just now',
  }
}

const QUOTES_PAGE_SIZE = 20

export function WorkspaceProvider({ children, user }) {
  const [quotes, setQuotes] = useState([])
  const [quotesLoading, setQuotesLoading] = useState(true)
  const [quotesError, setQuotesError] = useState(null)
  const [quotesPage, setQuotesPage] = useState(1)
  const [quotesTotalPages, setQuotesTotalPages] = useState(1)
  const [quotesLoadingMore, setQuotesLoadingMore] = useState(false)
  // Held here rather than in the page so paging and searching share one
  // request path: a new term resets to page one and the sentinel keeps working.
  const [quotesSearch, setQuotesSearch] = useState('')
  const hasMoreQuotes = quotesPage < quotesTotalPages

  const refreshQuotes = useCallback(async () => {
    setQuotesLoading(true)
    setQuotesError(null)
    try {
      const result = await quoteApi.list({
        page: 1,
        limit: QUOTES_PAGE_SIZE,
        search: quotesSearch || undefined,
      })
      setQuotes((result.quotes ?? []).map((quote) => toWorkspaceQuote(quote)))
      setQuotesPage(result.pagination?.page ?? 1)
      setQuotesTotalPages(result.pagination?.total_pages ?? 1)
    } catch (error) {
      setQuotes([])
      setQuotesError(error)
    } finally {
      setQuotesLoading(false)
    }
  }, [quotesSearch])

  const loadQuote = useCallback(async (quoteId) => {
    const result = await quoteApi.get(quoteId)
    const loadedQuote = toWorkspaceQuote(result.quote)
    setQuotes((current) => [
      loadedQuote,
      ...current.filter((quote) => quote.id !== loadedQuote.id),
    ])
    return loadedQuote
  }, [])

  /**
   * Append the next page. Locally created drafts have no server id yet, so they
   * are preserved across appends, and any quote the page returns that is already
   * on screen is de-duplicated rather than added twice.
   */
  const loadMoreQuotes = useCallback(async () => {
    if (quotesLoadingMore || quotesLoading) return
    if (quotesPage >= quotesTotalPages) return

    setQuotesLoadingMore(true)
    try {
      const nextPage = quotesPage + 1
      const result = await quoteApi.list({
        page: nextPage,
        limit: QUOTES_PAGE_SIZE,
        search: quotesSearch || undefined,
      })
      const incoming = (result.quotes ?? []).map((quote) => toWorkspaceQuote(quote))
      setQuotes((current) => {
        const seen = new Set(current.map((quote) => quote.id))
        return [...current, ...incoming.filter((quote) => !seen.has(quote.id))]
      })
      setQuotesPage(result.pagination?.page ?? nextPage)
      setQuotesTotalPages(result.pagination?.total_pages ?? quotesTotalPages)
    } catch (error) {
      setQuotesError(error)
    } finally {
      setQuotesLoadingMore(false)
    }
  }, [quotesLoading, quotesLoadingMore, quotesPage, quotesSearch, quotesTotalPages])

  useEffect(() => {
    let active = true

    Promise.resolve()
      .then(() => {
        if (!active) return null
        setQuotesLoading(true)
        setQuotesError(null)
        return quoteApi.list({
          page: 1,
          limit: QUOTES_PAGE_SIZE,
          search: quotesSearch || undefined,
        })
      })
      .then((result) => {
        if (!active || !result) return
        setQuotes((result.quotes ?? []).map((quote) => toWorkspaceQuote(quote)))
        setQuotesPage(result.pagination?.page ?? 1)
        setQuotesTotalPages(result.pagination?.total_pages ?? 1)
      })
      .catch((error) => {
        if (active) setQuotesError(error)
      })
      .finally(() => {
        if (active) setQuotesLoading(false)
      })

    return () => {
      active = false
    }
  }, [quotesSearch])

  function commit(nextQuotes) {
    setQuotes(nextQuotes)
  }

  function updateQuote(quoteId, updater) {
    commit(
      quotes.map((quote) => {
        if (quote.id !== quoteId) return quote
        return typeof updater === 'function' ? updater(quote) : { ...quote, ...updater }
      }),
    )
  }

  function createQuote() {
    const sequence = Math.max(
      42,
      ...quotes
        .map((quote) => Number(quote.id.split('-').at(-1)))
        .filter(Number.isFinite),
    ) + 1
    const id = `Q-2026-${String(sequence).padStart(4, '0')}`
    const quote = {
      id,
      serverManaged: false,
      isUnsaved: true,
      customer: { id: '', name: 'Select a customer', email: '', tier: '' },
      rep: user.fullName,
      stage: 'DRAFT',
      validUntil: '20 Sep 2026',
      createdAt: '05 Sep 2026',
      inactivityDays: 0,
      deliveryRisk: 'Low',
      orderDiscount: 0,
      lines: [],
      approvalSteps: [],
      audit: [createAudit(user.fullName, 'Working copy opened', 'Not saved yet.')],
    }
    commit([quote, ...quotes.filter((item) => !item.isUnsaved)])
    return id
  }

  function addProduct(quoteId, product) {
    updateQuote(quoteId, (quote) => {
      const existing = quote.lines.find(
        (line) => line.product.articleId === product.articleId,
      )
      const lines = existing
        ? quote.lines.map((line) =>
            line.id === existing.id ? { ...line, quantity: line.quantity + 1 } : line,
          )
        : [
            ...quote.lines,
            {
              id: `line-${crypto.randomUUID()}`,
              productId: product.id,
              product,
              quantity: 1,
              discount: 0,
            },
          ]
      return { ...quote, lines }
    })
  }

  function updateLine(quoteId, lineId, patch) {
    updateQuote(quoteId, (quote) => ({
      ...quote,
      lines: quote.lines.map((line) =>
        line.id === lineId ? { ...line, ...patch } : line,
      ),
    }))
  }

  function removeLine(quoteId, lineId) {
    updateQuote(quoteId, (quote) => ({
      ...quote,
      lines: quote.lines.filter((line) => line.id !== lineId),
    }))
  }

  async function submitQuote(quoteId, status = 'PENDING_APPROVAL') {
    const quote = quotes.find((item) => item.id === quoteId)
    if (!quote) return null
    const updates = {
      customer: quote.customer.id,
      products: quote.lines.map((line) => ({
        article_id: line.product.articleId,
        category: normalizeProductCategory(
          line.product.categoryCode || line.product.category,
        ),
        inv: line.quantity,
        applied_discount: line.discount,
      })),
      order_discount: quote.orderDiscount,
      status,
      reason: null,
      subscription_details: [],
    }
    const result = quote.serverManaged && quote.stage === 'DRAFT'
      ? await quoteApi.update({ quote_id: quote.id, updates })
      : await quoteApi.create(updates)
    const persistedQuote = toWorkspaceQuote(result.quote)
    setQuotes((current) => [
      persistedQuote,
      ...current.filter(
        (item) => item.id !== quoteId && item.id !== persistedQuote.id && !item.isUnsaved,
      ),
    ])
    return {
      quote: persistedQuote,
      calculation: calculateQuote(persistedQuote),
    }
  }

  /**
   * Move a quotation to another board column.
   *
   * The gateway only lets a sales rep write DRAFT or PENDING_APPROVAL on their
   * own quote — APPROVED belongs to the approval chain, NEGOTIATION to the
   * customer portal and COMPLETED to billing — so only those two columns accept
   * a drop. The card is moved optimistically and rolled back if the write fails.
   */
  async function moveQuote(quoteId, nextStage) {
    const quote = quotes.find((item) => item.id === quoteId)
    if (!quote || quote.stage === nextStage) return null
    if (!MOVABLE_STAGES.includes(nextStage)) {
      throw Object.assign(new Error(`${nextStage} is not a stage you can move a quotation into.`), {
        code: 'STAGE_NOT_MOVABLE',
      })
    }
    if (!quote.serverManaged) {
      throw Object.assign(new Error('Save this draft before moving it on the board.'), {
        code: 'QUOTE_NOT_SAVED',
      })
    }

    const previousStage = quote.stage
    setQuotes((current) => current.map((item) =>
      item.id === quoteId ? { ...item, stage: nextStage } : item,
    ))

    try {
      const result = await quoteApi.update({
        quote_id: quoteId,
        updates: { status: nextStage },
      })
      const persisted = toWorkspaceQuote(result.quote)
      // A revision is a new document, so swap the old id out rather than patch it.
      setQuotes((current) => [
        persisted,
        ...current.filter((item) => item.id !== quoteId && item.id !== persisted.id),
      ])
      return persisted
    } catch (error) {
      setQuotes((current) => current.map((item) =>
        item.id === quoteId ? { ...item, stage: previousStage } : item,
      ))
      throw error
    }
  }

  async function reviewQuote(quoteId, decision, reason = '') {
    const result = await quoteApi.review(
      {
        quote_id: quoteId,
        decision,
        ...(reason ? { reason } : {}),
      },
      user.role,
    )
    const persisted = toWorkspaceQuote(result.quote)
    setQuotes((current) => [
      persisted,
      ...current.filter((item) => item.id !== quoteId && item.id !== persisted.id),
    ])
    return { quote: persisted, approval: result.approval }
  }

  function resetWorkspace() {
    refreshQuotes()
  }

  const value = {
    user,
    quotes,
    quotesLoading,
    quotesError,
    quotesLoadingMore,
    quotesSearch,
    setQuotesSearch,
    hasMoreQuotes,
    loadMoreQuotes,
    loadQuote,
    refreshQuotes,
    moveQuote,
    updateQuote,
    createQuote,
    addProduct,
    updateLine,
    removeLine,
    submitQuote,
    reviewQuote,
    resetWorkspace,
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

// This companion hook intentionally lives beside its provider for this small utility app.
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return value
}
