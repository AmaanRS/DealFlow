import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  Minus,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { customerApi } from '../../api/customerApi.js'
import { productApi } from '../../api/productApi.js'
import { quoteApi } from '../../api/quoteApi.js'
import { calculateQuote, formatMoney, formatPercentage } from '../dealMath.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { Panel, StatusBadge } from '../components/Ui.jsx'

const CATALOGUE_PAGE_SIZE = 8
const SEARCH_DEBOUNCE_MS = 350
// Subscriptions are not added as quotation lines from this picker.
const CATALOGUE_CATEGORIES = 'HARDWARE,SERVICES'
const CATEGORY_CODES = { Hardware: 'HARDWARE', Services: 'SERVICES' }

function WorkflowSteps({ stage }) {
  const stages = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'NEGOTIATION', 'COMPLETED']
  const activeIndex = stage === 'REJECTED'
    ? 1
    : Math.max(0, stages.indexOf(stage))
  const labels = ['Build quote', 'Approval', 'Fulfillment', 'Negotiation', 'Complete']

  return (
    <div className="workflow-steps">
      {labels.map((label, index) => (
        <span className={`${index <= activeIndex ? 'active' : ''}${index === activeIndex ? ' current' : ''}`} key={label}>
          <i>{index < activeIndex || stage === 'COMPLETED' ? <Check size={12} /> : index + 1}</i>
          {label}
        </span>
      ))}
    </div>
  )
}

function formatRevisionDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time unavailable'
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function revisionLineName(revision, productId) {
  const product = (revision.quote?.products ?? []).find((item) =>
    [item._id, item.article_id].some((value) => String(value) === String(productId)),
  )
  return product?.name ?? 'Quotation line'
}

function approvalCopy(calculation) {
  if (calculation.risk === 'LOW') {
    return {
      title: 'Low risk · auto-approved',
      detail: 'Submitting sends this quotation directly to Approved.',
      action: 'Submit & auto-approve',
    }
  }
  if (calculation.risk === 'HIGH') {
    return {
      title: 'High risk · approval required',
      detail: 'The quotation enters the manager and finance review path.',
      action: 'Submit for approval',
    }
  }
  return {
    title: 'Medium risk · approval required',
    detail: 'The quotation enters the sales manager review queue.',
    action: 'Submit for approval',
  }
}

function boundedPercentage(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(100, Math.max(0, Math.round(number * 100) / 100))
}

function PercentageControl({ value, onChange, label, compact = false, tone = 'default' }) {
  const normalizedValue = boundedPercentage(value)
  const [draft, setDraft] = useState(String(normalizedValue))

  function commit(nextValue) {
    const next = boundedPercentage(nextValue === '' ? 0 : nextValue)
    setDraft(String(next))
    onChange(next)
  }

  function handleChange(event) {
    const nextDraft = event.target.value
    setDraft(nextDraft)
    if (nextDraft === '') return

    const number = Number(nextDraft)
    if (!Number.isFinite(number)) return
    const next = boundedPercentage(number)
    if (next !== number) setDraft(String(next))
    onChange(next)
  }

  return (
    <div className={`percentage-control percentage-control--${tone}${compact ? ' percentage-control--compact' : ''}`}>
      <button type="button" onClick={() => commit(normalizedValue - 1)} disabled={normalizedValue <= 0} aria-label={`Decrease ${label}`}><Minus size={12} /></button>
      <label>
        <input
          type="number"
          min="0"
          max="100"
          step="0.5"
          inputMode="decimal"
          value={draft}
          onChange={handleChange}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          onWheel={(event) => event.currentTarget.blur()}
          aria-label={label}
        />
        <span>%</span>
      </label>
      <button type="button" onClick={() => commit(normalizedValue + 1)} disabled={normalizedValue >= 100} aria-label={`Increase ${label}`}><Plus size={12} /></button>
    </div>
  )
}

export default function QuotationBuilderPage() {
  const { quoteId } = useParams()
  const navigate = useNavigate()
  const {
    quotes,
    updateQuote,
    addProduct,
    updateLine,
    removeLine,
    submitQuote,
    quotesLoading,
    loadQuote,
  } = useWorkspace()
  const quote = quotes.find((item) => item.id === quoteId)
  const editable = Boolean(quote && (quote.isUnsaved || quote.stage === 'DRAFT'))
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [cataloguePage, setCataloguePage] = useState(1)
  const [cataloguePagination, setCataloguePagination] = useState({
    page: 1,
    total: 0,
    totalPages: 1,
  })
  const [customers, setCustomers] = useState([])
  const [catalogueProducts, setCatalogueProducts] = useState([])
  const [pricingPolicy, setPricingPolicy] = useState(null)
  const [catalogueLoading, setCatalogueLoading] = useState(editable)
  const [catalogueError, setCatalogueError] = useState(null)
  const [saving, setSaving] = useState(null)
  const [quoteLookup, setQuoteLookup] = useState({
    quoteId: null,
    loading: false,
    error: null,
  })
  const [revisionHistory, setRevisionHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(null)

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [quoteId])

  useEffect(() => {
    if (
      !quoteId ||
      quote ||
      quotesLoading ||
      quoteLookup.quoteId === quoteId
    ) {
      return undefined
    }

    let active = true
    Promise.resolve()
      .then(() => {
        if (!active) return null
        setQuoteLookup({ quoteId, loading: true, error: null })
        return loadQuote(quoteId)
      })
      .then(() => {
        if (active) setQuoteLookup({ quoteId, loading: false, error: null })
      })
      .catch((error) => {
        if (active) setQuoteLookup({ quoteId, loading: false, error })
      })

    return () => {
      active = false
    }
  }, [loadQuote, quote, quoteId, quoteLookup.quoteId, quotesLoading])

  useEffect(() => {
    if (!editable) return undefined
    let active = true

    Promise.all([customerApi.list(), quoteApi.getPricingPolicy()])
      .then(([customerResult, policyResult]) => {
        if (!active) return
        setCustomers(customerResult.customers ?? [])
        setPricingPolicy(policyResult)
      })
      .catch((error) => {
        if (active) setCatalogueError(error)
      })

    return () => {
      active = false
    }
  }, [editable])

  useEffect(() => {
    if (!quote?.serverManaged) return undefined

    let active = true
    Promise.resolve()
      .then(() => {
        if (!active) return null
        setHistoryLoading(true)
        setHistoryError(null)
        return quoteApi.getHistory(quoteId)
      })
      .then((result) => {
        if (active && result) setRevisionHistory(result.revisions ?? [])
      })
      .catch((error) => {
        if (active) setHistoryError(error)
      })
      .finally(() => {
        if (active) setHistoryLoading(false)
      })

    return () => {
      active = false
    }
  }, [quote?.serverManaged, quoteId])

  /**
   * The catalogue is paged and searched on the server. Fetching everything and
   * filtering locally only worked while the catalogue was small: past one page
   * the rep would silently stop seeing products that exist.
   */
  useEffect(() => {
    if (!editable) return undefined
    let active = true

    Promise.resolve()
      .then(() => {
        if (!active) return null
        setCatalogueLoading(true)
        setCatalogueError(null)
        return productApi.list({
          page: cataloguePage,
          limit: CATALOGUE_PAGE_SIZE,
          category: category === 'All' ? CATALOGUE_CATEGORIES : CATEGORY_CODES[category],
          search: query || undefined,
        })
      })
      .then((result) => {
        if (!active || !result) return
        setCatalogueProducts(result.products ?? [])
        setCataloguePagination({
          page: result.pagination?.page ?? cataloguePage,
          total: result.pagination?.total ?? 0,
          totalPages: Math.max(1, result.pagination?.total_pages ?? 1),
        })
      })
      .catch((error) => {
        if (active) setCatalogueError(error)
      })
      .finally(() => {
        if (active) setCatalogueLoading(false)
      })

    return () => {
      active = false
    }
  }, [cataloguePage, category, editable, query])

  // Debounced, and a new term restarts paging.
  useEffect(() => {
    if (draftQuery.trim() === query) return undefined
    const timer = window.setTimeout(() => {
      setCataloguePage(1)
      setQuery(draftQuery.trim())
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draftQuery, query])

  const calculation = useMemo(
    () => {
      if (!quote) return null
      const calculationQuote = editable
        ? { ...quote, serverPricing: null }
        : quote
      return calculateQuote(calculationQuote, pricingPolicy)
    },
    [editable, pricingPolicy, quote],
  )
  // Fixed tabs rather than tabs derived from the fetched page: a rep needs to
  // see that Services exists and is empty, not have the tab silently vanish.
  const catalogueCategories = ['All', 'Hardware', 'Services']

  function changeCataloguePage(nextPage) {
    if (nextPage < 1 || nextPage > cataloguePagination.totalPages) return
    setCataloguePage(nextPage)
  }

  function changeCategory(next) {
    if (next === category) return
    setCataloguePage(1)
    setCategory(next)
  }

  async function refreshCurrentQuote() {
    try {
      const historyResult = await quoteApi.getHistory(quote.id)
      const revisions = historyResult.revisions ?? []
      setRevisionHistory(revisions)
      setHistoryError(null)
      const latest = revisions.find((revision) => revision.quote?.is_latest_quote)
      const latestId = String(latest?.quote?._id ?? quote.id)
      await loadQuote(latestId)
      if (latestId !== quote.id) {
        navigate(`/quotations/${latestId}`, { replace: true })
        toast.success('Latest customer revision loaded.')
      } else {
        toast.success('Quotation refreshed.')
      }
    } catch (error) {
      setHistoryError(error)
      toast.error(error.message || 'Quotation could not be refreshed.')
    }
  }

  const quoteIsLoading = !quote && (
    quotesLoading ||
    quoteLookup.loading ||
    quoteLookup.quoteId !== quoteId
  )

  if (quoteIsLoading) {
    return (
      <div className="missing-state">
        <span className="spinner" />
        <h1>Loading quotation…</h1>
      </div>
    )
  }

  if (!quote || !calculation) {
    return (
      <div className="missing-state">
        <AlertTriangle size={28} />
        <h1>{quoteLookup.error?.code === 'QUOTE_NOT_FOUND' ? 'Quotation not found' : 'Could not load quotation'}</h1>
        {quoteLookup.error && <p>{quoteLookup.error.message}</p>}
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setQuoteLookup({ quoteId: null, loading: false, error: null })}
        >
          Retry
        </button>
        <button className="button button--primary" type="button" onClick={() => navigate('/quotations')}>Back to quotations</button>
      </div>
    )
  }

  const workflow = approvalCopy(calculation)
  const selectedCustomerExists = customers.some(
    (customer) => customer.id === quote.customer.id,
  )

  function changeCustomer(customerId) {
    const customer = customers.find((item) => item.id === customerId)
    if (!customer) return
    updateQuote(quote.id, {
      customer: {
        id: customer.id,
        name: customer.fullName,
        email: customer.email,
        tier: customer.tier,
      },
    })
  }

  async function persistQuote(status) {
    if (!quote.customer.id) {
      toast.error('Select a customer before saving the quotation.')
      return
    }
    if (!quote.lines.length) {
      toast.error('Add at least one product before saving the quotation.')
      return
    }
    if (!pricingPolicy) {
      toast.error('Pricing policy is unavailable. Refresh before saving.')
      return
    }

    setSaving(status)
    try {
      const result = await submitQuote(quote.id, status)
      if (status === 'DRAFT') {
        toast.success('Quotation saved as draft')
      } else {
        const serverRisk = result.quote.serverPricing.risk
        toast.success(
          serverRisk === 'LOW'
            ? 'Quotation auto-approved'
            : 'Quotation sent for approval',
          { description: `Morning Star confirmed ${serverRisk.toLowerCase()} commercial risk.` },
        )
      }
      navigate(`/quotations/${result.quote.id}`, { replace: true })
    } catch (error) {
      toast.error(error.message ?? 'The quotation could not be saved.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="page-stack quote-builder-page">
      <header className="quote-builder-header">
        <div>
          <button className="back-link" type="button" onClick={() => navigate('/quotations')}><ArrowLeft size={15} /> Quotations</button>
          <span className="quote-title-line">
            <h1>Quotation Detail: {quote.isUnsaved ? 'New' : quote.id}</h1>
            <StatusBadge status={quote.stage} label={quote.isUnsaved ? 'Unsaved' : undefined} />
          </span>
          <p>Configure customer pricing, validate discounts live and route the quotation correctly.</p>
        </div>
        {!editable && (
          <button className="button button--quiet" type="button" onClick={refreshCurrentQuote}><RefreshCw size={15} /> Refresh latest revision</button>
        )}
      </header>

      <WorkflowSteps stage={quote.stage} />

      {quote.serverManaged && (
        historyLoading ? (
          <section className="negotiation-history-state"><span className="spinner" /> Loading revision history…</section>
        ) : historyError ? (
          <section className="negotiation-history-state negotiation-history-state--error">
            <AlertTriangle size={17} />
            <span>{historyError.message}</span>
            <button className="link-button" type="button" onClick={refreshCurrentQuote}>Try again</button>
          </section>
        ) : (revisionHistory.length > 1 || ['NEGOTIATION', 'COMPLETED'].includes(quote.stage)) ? (
          <Panel
            title="Negotiation & revision history"
            description="Customer requests create a new immutable quotation revision. The current revision stays open until the customer confirms it."
            className="negotiation-history-panel"
          >
            <div className="negotiation-history-list">
              {revisionHistory.map((revision) => {
                const current = Boolean(revision.quote?.is_latest_quote)
                const customerEvent = revision.customer_event
                const confirmed = customerEvent?.type === 'CUSTOMER_QUOTATION_CONFIRMED'
                return (
                  <article className={current ? 'is-current' : ''} key={revision.quote?._id ?? revision.quote_version}>
                    <span className="negotiation-history-marker">{confirmed ? <Check size={13} /> : revision.quote_version}</span>
                    <div className="negotiation-history-copy">
                      <header>
                        <span><strong>Revision {revision.quote_version}</strong>{current && <em>Current</em>}</span>
                        <span><StatusBadge status={revision.quote?.status} /><b>{formatMoney(revision.quote?.selling_price ?? 0)}</b></span>
                      </header>
                      <small>{formatRevisionDate(customerEvent?.occurred_at ?? revision.createdAt ?? revision.quote?.createdAt)}</small>
                      {confirmed ? (
                        <p className="negotiation-confirmed"><Check size={14} /> Customer confirmed this revision. Negotiation is complete.</p>
                      ) : customerEvent ? (
                        <div className="customer-request-detail">
                          <strong><MessageSquareText size={14} /> Customer requested changes</strong>
                          {customerEvent.change_request && <p>{customerEvent.change_request}</p>}
                          {customerEvent.counter_discount !== null && (
                            <p><b>Counter discount:</b> {customerEvent.counter_discount}%</p>
                          )}
                          {(customerEvent.line_comments ?? []).map((comment) => (
                            <p key={`${comment.productId}-${comment.comment}`}>
                              <b>{revisionLineName(revision, comment.productId)}:</b> {comment.comment}
                            </p>
                          ))}
                        </div>
                      ) : revision.quote?.reason ? (
                        <p>{revision.quote.reason}</p>
                      ) : (
                        <p>Quotation terms recorded.</p>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </Panel>
        ) : null
      )}

      <section className="quote-customer-bar">
        <label>
          <span>Customer</span>
          {editable ? (
            <select value={quote.customer.id} onChange={(event) => changeCustomer(event.target.value)} disabled={catalogueLoading}>
              <option value="">Select a customer</option>
              {!selectedCustomerExists && quote.customer.id && (
                <option value={quote.customer.id}>{quote.customer.name}</option>
              )}
              {customers.map((customer) => (
                <option value={customer.id} key={customer.id}>{customer.fullName}</option>
              ))}
            </select>
          ) : (
            <input value={quote.customer.name} disabled />
          )}
        </label>
        <label>
          <span>Customer contact</span>
          <input type="email" value={quote.customer.email} placeholder="Assigned from customer" disabled />
        </label>
        <label>
          <span>Customer tier</span>
          <input value={quote.customer.tier} placeholder="Assigned automatically" disabled />
        </label>
      </section>

      {editable && (
        <Panel title="Add products" description="Search the live catalogue, then add items to the quotation below.">
          <div className="catalogue-toolbar catalogue-toolbar--compact">
            <label className="filter-search">
              <Search size={15} />
              <input
                type="search"
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
                placeholder="Search product or SKU"
              />
            </label>
            <div className="category-tabs">
              {catalogueCategories.map((item) => (
                <button type="button" className={category === item ? 'active' : ''} onClick={() => changeCategory(item)} key={item}>{item}</button>
              ))}
            </div>
          </div>
          {catalogueLoading ? (
            <p className="empty-copy">Loading catalogue…</p>
          ) : catalogueError ? (
            <div className="inline-error">{catalogueError.message}</div>
          ) : (
            <>
              <div className="catalogue-compact-list">
                {catalogueProducts.map((product) => (
                  <article key={product.id}>
                    <div><strong>{product.name}</strong><small>{product.sku} · {product.category} · {product.stock} available</small></div>
                    <strong>{formatMoney(product.price)}</strong>
                    <button type="button" onClick={() => addProduct(quote.id, product)} disabled={product.stock === 0 && !product.recurring}>
                      <Plus size={14} /> Add
                    </button>
                  </article>
                ))}
                {!catalogueProducts.length && (
                  <p className="empty-copy">
                    {query
                      ? `Nothing matches “${query}”. The search covers product names and SKUs.`
                      : category === 'All'
                        ? 'No products in the catalogue yet.'
                        : `No ${category.toLowerCase()} products in the catalogue yet.`}
                  </p>
                )}
              </div>

              {cataloguePagination.totalPages > 1 && (
                <footer className="catalogue-pagination">
                  <button
                    className="button button--quiet button--small"
                    type="button"
                    onClick={() => changeCataloguePage(cataloguePage - 1)}
                    disabled={cataloguePage <= 1}
                  >
                    <ChevronLeft size={14} /> Previous
                  </button>
                  <small>
                    Page {cataloguePagination.page} of {cataloguePagination.totalPages}
                    {' · '}
                    {cataloguePagination.total} product{cataloguePagination.total === 1 ? '' : 's'}
                  </small>
                  <button
                    className="button button--quiet button--small"
                    type="button"
                    onClick={() => changeCataloguePage(cataloguePage + 1)}
                    disabled={cataloguePage >= cataloguePagination.totalPages}
                  >
                    Next <ChevronRight size={14} />
                  </button>
                </footer>
              )}
            </>
          )}
        </Panel>
      )}

      <section className="quote-workbench">
        <div className="quote-builder-main">
          <Panel title="Quotation lines" description="Set quantity and rep discount for each selected product.">
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Discount</th>
                    <th>Limit</th>
                    <th>Line total</th>
                    <th>Policy</th>
                    {editable && <th aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {calculation.lines.map((line) => (
                    <tr key={line.id}>
                      <td data-label="Product"><strong>{line.product.name}</strong><small>{line.product.sku} · {line.product.category}</small></td>
                      <td data-label="Quantity">
                        {editable ? (
                          <div className="quantity-control">
                            <button type="button" onClick={() => updateLine(quote.id, line.id, { quantity: Math.max(1, line.quantity - 1) })} disabled={line.quantity <= 1} aria-label={`Decrease ${line.product.name} quantity`}><Minus size={13} /></button>
                            <strong>{line.quantity}</strong>
                            <button type="button" onClick={() => updateLine(quote.id, line.id, { quantity: line.quantity + 1 })} aria-label={`Increase ${line.product.name} quantity`}><Plus size={13} /></button>
                          </div>
                        ) : line.quantity}
                      </td>
                      <td data-label="Unit price">{formatMoney(line.product.price)}</td>
                      <td data-label="Rep discount">
                        {editable ? (
                          <PercentageControl
                            value={line.discount}
                            onChange={(discount) => updateLine(quote.id, line.id, { discount })}
                            label={`${line.product.name} rep discount`}
                            tone={line.excess > 0 ? 'over' : 'default'}
                            compact
                          />
                        ) : formatPercentage(line.discount)}
                      </td>
                      <td data-label="Product limit"><strong>{formatPercentage(line.allowedDiscount)}</strong></td>
                      <td data-label="Line total"><strong>{formatMoney(line.net)}</strong></td>
                      <td data-label="Policy"><span className={`line-policy-status ${line.excess > 0 ? 'over' : 'ok'}`}>{line.excess > 0 ? `Approval +${line.excess.toFixed(1)}pt` : 'Within limit'}</span></td>
                      {editable && <td className="quotation-line-action" data-label="Remove"><button className="icon-button danger-hover" type="button" onClick={() => removeLine(quote.id, line.id)} aria-label={`Remove ${line.product.name}`}><Trash2 size={16} /></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!calculation.lines.length && (
                <div className="empty-cart"><PackagePlus size={24} /><strong>No products added</strong><span>Choose products from the live catalogue above.</span></div>
              )}
            </div>
          </Panel>
        </div>

        <aside className="quote-summary-card">
          <header>
            <span>LIVE PRICING</span>
            <h2>Quotation summary</h2>
            <p>Totals and approval routing update as you edit.</p>
          </header>
          <dl className="quote-summary-list">
            <div><dt>Subtotal</dt><dd>{formatMoney(calculation.subtotal)}</dd></div>
            <div><dt>Customer tier</dt><dd>{quote.customer.tier || 'Not selected'}</dd></div>
            <div><dt>Tier discount</dt><dd>{formatPercentage(calculation.tierDiscount)}</dd></div>
            <div className="quote-order-discount">
              <dt>Order discount</dt>
              <dd>
                {editable ? (
                  <PercentageControl
                    compact
                    value={quote.orderDiscount}
                    onChange={(orderDiscount) => updateQuote(quote.id, { orderDiscount })}
                    label="Order discount"
                  />
                ) : formatPercentage(quote.orderDiscount)}
              </dd>
            </div>
            <div><dt>Effective discount</dt><dd>{formatPercentage(calculation.discountPercentage)}</dd></div>
            <div className="quote-summary-total"><dt>Quotation total</dt><dd>{formatMoney(calculation.total)}</dd></div>
          </dl>
          <div className={`quote-risk-decision quote-risk-decision--${calculation.risk.toLowerCase()}`}>
            {calculation.risk === 'LOW' ? <Check size={19} /> : <AlertTriangle size={19} />}
            <span><strong>{workflow.title}</strong><small>{workflow.detail}</small></span>
          </div>
          {editable && (
            <div className="quote-save-actions">
              <button className="button button--secondary" type="button" onClick={() => persistQuote('DRAFT')} disabled={Boolean(saving) || catalogueLoading || Boolean(catalogueError)}>
                <Save size={15} /> {saving === 'DRAFT' ? 'Saving…' : 'Save draft'}
              </button>
              <button className="button button--primary" type="button" onClick={() => persistQuote('PENDING_APPROVAL')} disabled={Boolean(saving) || catalogueLoading || Boolean(catalogueError)}>
                <Send size={15} /> {saving === 'PENDING_APPROVAL' ? 'Submitting…' : workflow.action}
              </button>
            </div>
          )}
        </aside>
      </section>
    </div>
  )
}
