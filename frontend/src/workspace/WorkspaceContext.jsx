import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { quoteApi } from '../api/quoteApi.js'
import { USER_ROLES } from '../contracts/auth.js'
import { calculateQuote } from './dealMath.js'

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

function approvalStepsFor(quote, user) {
  if (!['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(quote.status)) {
    return []
  }

  const assignedToCurrentUser = quote.assigned_to === user.email
  const role = !assignedToCurrentUser
    ? 'Assigned reviewer'
    : user.role === USER_ROLES.FINANCE
      ? 'Finance'
      : 'Sales manager'

  return [{
    id: `approval-${quote._id}`,
    role,
    assignee: quote.assigned_to,
    status:
      quote.status === 'PENDING_APPROVAL'
        ? 'PENDING'
        : quote.status === 'APPROVED'
          ? 'APPROVED'
          : 'REJECTED',
  }]
}

function toWorkspaceQuote(quote, user) {
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
      quantity: product.inv,
      discount: product.applied_discount,
      allowedDiscount: product.product_discount,
      product: {
        id: String(product.item_id),
        articleId: String(product.article_id),
        sku: product.hsn,
        name: product.name,
        category: displayCategory(product.category),
        price: product.unit_price,
        cost: null,
        unit: 'Unit',
        tax: product.gst,
        stock: null,
        discountLimit: product.product_discount,
        description: `HSN ${product.hsn}`,
      },
    })),
    approvalSteps: approvalStepsFor(quote, user),
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

export function WorkspaceProvider({ children, user }) {
  const [quotes, setQuotes] = useState([])
  const [quotesLoading, setQuotesLoading] = useState(true)
  const [quotesError, setQuotesError] = useState(null)

  const refreshQuotes = useCallback(async () => {
    setQuotesLoading(true)
    setQuotesError(null)
    try {
      const result = await quoteApi.list()
      setQuotes((result.quotes ?? []).map((quote) => toWorkspaceQuote(quote, user)))
    } catch (error) {
      setQuotes([])
      setQuotesError(error)
    } finally {
      setQuotesLoading(false)
    }
  }, [user])

  useEffect(() => {
    let active = true

    quoteApi.list()
      .then((result) => {
        if (active) {
          setQuotes((result.quotes ?? []).map((quote) => toWorkspaceQuote(quote, user)))
        }
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
  }, [user])

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
      audit: [createAudit(user.fullName, 'Draft created', 'New quotation started.')],
    }
    commit([quote, ...quotes])
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

  async function submitQuote(quoteId) {
    const quote = quotes.find((item) => item.id === quoteId)
    if (!quote) return null
    const result = await quoteApi.create({
      customer: quote.customer.id,
      products: quote.lines.map((line) => ({
        article_id: line.product.articleId,
        category: line.product.categoryCode,
        inv: line.quantity,
        applied_discount: line.discount,
      })),
      order_discount: quote.orderDiscount,
      status: 'PENDING_APPROVAL',
      reason: null,
      subscription_details: [],
    })
    const persistedQuote = toWorkspaceQuote(result.quote, user)
    setQuotes((current) => [
      persistedQuote,
      ...current.filter((item) => item.id !== quoteId && item.id !== persistedQuote.id),
    ])
    return {
      quote: persistedQuote,
      calculation: calculateQuote(persistedQuote),
    }
  }

  function reviewQuote(quoteId, decision, reason = '') {
    updateQuote(quoteId, (quote) => {
      let stage
      let approvalSteps = quote.approvalSteps

      if (decision === 'APPROVE') {
        const activeIndex = approvalSteps.findIndex((step) => step.status === 'PENDING')
        approvalSteps = approvalSteps.map((step, index) => {
          if (index === activeIndex) return { ...step, status: 'APPROVED' }
          if (index === activeIndex + 1 && step.status === 'WAITING') {
            return { ...step, status: 'PENDING' }
          }
          return step
        })
        stage = approvalSteps.some((step) => step.status === 'PENDING')
          ? 'PENDING_APPROVAL'
          : 'APPROVED'
      } else if (decision === 'REJECT') {
        stage = 'REJECTED'
      } else {
        stage = 'REVISION'
      }

      return {
        ...quote,
        stage,
        approvalSteps,
        audit: [
          createAudit(
            user.fullName,
            decision === 'APPROVE'
              ? 'Approval step completed'
              : decision === 'REJECT'
                ? 'Quotation rejected'
                : 'Returned for revision',
            reason || 'Decision recorded from the approval workspace.',
          ),
          ...quote.audit,
        ],
      }
    })
  }

  function resetWorkspace() {
    refreshQuotes()
  }

  const value = {
    user,
    quotes,
    quotesLoading,
    quotesError,
    refreshQuotes,
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
