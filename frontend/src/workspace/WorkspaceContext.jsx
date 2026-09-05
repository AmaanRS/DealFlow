import { createContext, useContext, useState } from 'react'
import { calculateQuote } from './dealMath.js'
import { cloneSeedQuotes } from './seed.js'

const STORAGE_KEY = 'dealflow.workspace.state.v1'
const WorkspaceContext = createContext(null)

function loadQuotes() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {
    // Browser storage can be unavailable in strict privacy modes.
  }
  return cloneSeedQuotes()
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
  const [quotes, setQuotes] = useState(loadQuotes)

  function commit(nextQuotes) {
    setQuotes(nextQuotes)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextQuotes))
    } catch {
      // The application still works for the active session without persistence.
    }
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
      customer: { name: 'New customer', email: '', tier: 'Bronze' },
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

  function addProduct(quoteId, productId) {
    updateQuote(quoteId, (quote) => {
      const existing = quote.lines.find((line) => line.productId === productId)
      const lines = existing
        ? quote.lines.map((line) =>
            line.id === existing.id ? { ...line, quantity: line.quantity + 1 } : line,
          )
        : [
            ...quote.lines,
            {
              id: `line-${crypto.randomUUID()}`,
              productId,
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

  function submitQuote(quoteId) {
    const quote = quotes.find((item) => item.id === quoteId)
    if (!quote) return null
    const calculation = calculateQuote(quote)
    const requiresFinance = calculation.approvalLevel === 'MANAGER_AND_FINANCE'
    const requiresManager = calculation.approvalLevel !== 'NONE'
    const nextStage = requiresManager ? 'PENDING_APPROVAL' : 'APPROVED'
    const approvalSteps = requiresManager
      ? [
          { id: 'step-manager', role: 'Sales manager', assignee: 'Mira Shah', status: 'PENDING' },
          ...(requiresFinance
            ? [{ id: 'step-finance', role: 'Finance', assignee: 'Rohan Mehta', status: 'WAITING' }]
            : []),
        ]
      : []

    updateQuote(quoteId, (current) => ({
      ...current,
      stage: nextStage,
      approvalSteps,
      audit: [
        createAudit(
          'DealFlow policy',
          requiresManager ? 'Approval routed automatically' : 'Policy check passed',
          requiresManager
            ? `${requiresFinance ? 'Manager and Finance' : 'Manager'} review required at risk score ${calculation.riskScore}.`
            : 'Discounts are within all configured limits.',
        ),
        ...current.audit,
      ],
    }))
    return { stage: nextStage, calculation }
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
    commit(cloneSeedQuotes())
  }

  const value = {
    user,
    quotes,
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
