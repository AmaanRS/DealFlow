import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Minus,
  PackagePlus,
  Plus,
  Save,
  Search,
  Send,
  Sparkles,
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

function WorkflowSteps({ stage }) {
  const stages = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FULFILLMENT']
  const activeIndex = Math.max(0, stages.indexOf(stage))
  const labels = ['Build quote', 'Approval', 'Customer', 'Fulfillment']

  return (
    <div className="workflow-steps">
      {labels.map((label, index) => (
        <span className={index <= activeIndex ? 'active' : ''} key={label}>
          <i>{index < activeIndex ? <Check size={12} /> : index + 1}</i>
          {label}
        </span>
      ))}
    </div>
  )
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

function recommendationGroups(products, selectedArticleIds, selectedCategories) {
  const available = products.filter(
    (product) => !selectedArticleIds.has(product.articleId),
  )
  const upsell = available
    .filter((product) => selectedCategories.has(product.categoryCode))
    .slice(0, 2)
  const upsellIds = new Set(upsell.map((product) => product.articleId))
  const crossSell = available
    .filter((product) => !upsellIds.has(product.articleId))
    .slice(0, 2)
  return { upsell, crossSell }
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
    refreshQuotes,
  } = useWorkspace()
  const quote = quotes.find((item) => item.id === quoteId)
  const editable = Boolean(quote && (quote.isUnsaved || quote.stage === 'DRAFT'))
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [customers, setCustomers] = useState([])
  const [catalogueProducts, setCatalogueProducts] = useState([])
  const [pricingPolicy, setPricingPolicy] = useState(null)
  const [catalogueLoading, setCatalogueLoading] = useState(editable)
  const [catalogueError, setCatalogueError] = useState(null)
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    if (!editable) return undefined
    let active = true

    Promise.resolve()
      .then(() => {
        if (!active) return null
        setCatalogueLoading(true)
        setCatalogueError(null)
        return Promise.all([
          customerApi.list(),
          productApi.list(),
          quoteApi.getPricingPolicy(),
        ])
      })
      .then((results) => {
        if (!active || !results) return
        const [customerResult, productResult, policyResult] = results
        setCustomers(customerResult.customers ?? [])
        setCatalogueProducts(productResult.products ?? [])
        setPricingPolicy(policyResult)
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
  }, [editable])

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
  const catalogueCategories = useMemo(
    () => ['All', ...new Set(catalogueProducts.map((product) => product.category))],
    [catalogueProducts],
  )
  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return catalogueProducts.filter((product) => {
      const matchesCategory = category === 'All' || product.category === category
      const matchesQuery =
        !needle ||
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle)
      return matchesCategory && matchesQuery
    })
  }, [catalogueProducts, category, query])
  const selectedArticleIds = useMemo(
    () => new Set(quote?.lines.map((line) => line.product.articleId) ?? []),
    [quote?.lines],
  )
  const selectedCategories = useMemo(
    () => new Set(quote?.lines.map((line) => line.product.categoryCode) ?? []),
    [quote?.lines],
  )
  const suggestions = useMemo(
    () => recommendationGroups(
      catalogueProducts,
      selectedArticleIds,
      selectedCategories,
    ),
    [catalogueProducts, selectedArticleIds, selectedCategories],
  )

  if (!quote || !calculation) {
    return (
      <div className="missing-state">
        <AlertTriangle size={28} />
        <h1>Quotation not found</h1>
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

  function renderSuggestion(product) {
    return (
      <article className="quote-suggestion" key={product.id}>
        <span><Sparkles size={16} /></span>
        <div>
          <strong>{product.name}</strong>
          <small>{product.category} · {formatMoney(product.price)}</small>
        </div>
        <button type="button" onClick={() => addProduct(quote.id, product)}>
          <Plus size={14} /> Add
        </button>
      </article>
    )
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
          <button className="button button--quiet" type="button" onClick={refreshQuotes}>Refresh quotation</button>
        )}
      </header>

      <WorkflowSteps stage={quote.stage} />

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
          <span>Price list / tier</span>
          <input value={quote.customer.tier} placeholder="Assigned automatically" disabled />
        </label>
      </section>

      {editable && (
        <Panel title="Add products" description="Search the live catalogue, then add items to the quotation below.">
          <div className="catalogue-toolbar catalogue-toolbar--compact">
            <label className="filter-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product or SKU" /></label>
            <div className="category-tabs">
              {catalogueCategories.map((item) => (
                <button type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)} key={item}>{item}</button>
              ))}
            </div>
          </div>
          {catalogueLoading ? (
            <p className="empty-copy">Loading customers, products and pricing policy…</p>
          ) : catalogueError ? (
            <div className="inline-error">{catalogueError.message}</div>
          ) : (
            <div className="catalogue-compact-list">
              {filteredProducts.slice(0, 8).map((product) => (
                <article key={product.id}>
                  <div><strong>{product.name}</strong><small>{product.sku} · {product.category} · {product.stock} available</small></div>
                  <strong>{formatMoney(product.price)}</strong>
                  <button type="button" onClick={() => addProduct(quote.id, product)} disabled={product.stock === 0 && !product.recurring}>
                    <Plus size={14} /> Add
                  </button>
                </article>
              ))}
              {!filteredProducts.length && <p className="empty-copy">No products match this search.</p>}
            </div>
          )}
        </Panel>
      )}

      <Panel title="Products" description="Every line is checked live against its product discount limit.">
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Rep discount</th>
                <th>Limit</th>
                <th>Line total</th>
                <th>Status</th>
                {editable && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {calculation.lines.map((line) => (
                <tr key={line.id}>
                  <td><strong>{line.product.name}</strong><small>{line.product.sku} · {line.product.category}</small></td>
                  <td>
                    {editable ? (
                      <div className="quantity-control">
                        <button type="button" onClick={() => updateLine(quote.id, line.id, { quantity: Math.max(1, line.quantity - 1) })}><Minus size={13} /></button>
                        <strong>{line.quantity}</strong>
                        <button type="button" onClick={() => updateLine(quote.id, line.id, { quantity: line.quantity + 1 })}><Plus size={13} /></button>
                      </div>
                    ) : line.quantity}
                  </td>
                  <td>{formatMoney(line.product.price)}</td>
                  <td>
                    {editable ? (
                      <label className="table-discount-input"><input type="number" min="0" max="100" value={line.discount} onChange={(event) => updateLine(quote.id, line.id, { discount: Number(event.target.value) })} /><span>%</span></label>
                    ) : formatPercentage(line.discount)}
                  </td>
                  <td>{formatPercentage(line.allowedDiscount)}</td>
                  <td><strong>{formatMoney(line.net)}</strong></td>
                  <td><span className={`line-policy-status ${line.excess > 0 ? 'over' : 'ok'}`}>{line.excess > 0 ? `OVER (+${line.excess.toFixed(0)}pt)` : 'OK'}</span></td>
                  {editable && <td><button className="icon-button danger-hover" type="button" onClick={() => removeLine(quote.id, line.id)} aria-label={`Remove ${line.product.name}`}><Trash2 size={16} /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!calculation.lines.length && (
            <div className="empty-cart"><PackagePlus size={24} /><strong>No products added</strong><span>Choose products from the live catalogue above.</span></div>
          )}
        </div>
        <div className="discount-policy-note">
          <AlertTriangle size={17} />
          <span><strong>Discounts are checked live.</strong> Category, rep, customer-tier and order discounts are applied sequentially. A rep discount above its product limit makes the quote at least medium risk.</span>
        </div>
      </Panel>

      {editable && quote.lines.length > 0 && (
        <section className="quote-recommendations">
          <Panel title="Upsell suggestions" description="Related alternatives from the selected product categories.">
            <div className="quote-suggestion-list">
              {suggestions.upsell.map(renderSuggestion)}
              {!suggestions.upsell.length && <p className="empty-copy">No additional products in the selected categories.</p>}
            </div>
          </Panel>
          <Panel title="Cross-sell suggestions" description="Complementary products available in the catalogue.">
            <div className="quote-suggestion-list">
              {suggestions.crossSell.map(renderSuggestion)}
              {!suggestions.crossSell.length && <p className="empty-copy">No complementary products available.</p>}
            </div>
          </Panel>
        </section>
      )}

      <section className="quote-decision-bar">
        <div className="quote-totals">
          <span><small>Subtotal</small><strong>{formatMoney(calculation.gross)}</strong></span>
          <span><small>Tier discount</small><strong>{formatPercentage(calculation.tierDiscount)}</strong></span>
          {editable ? (
            <label><small>Order discount</small><span><input type="number" min="0" max="100" value={quote.orderDiscount} onChange={(event) => updateQuote(quote.id, { orderDiscount: Number(event.target.value) })} />%</span></label>
          ) : (
            <span><small>Order discount</small><strong>{formatPercentage(quote.orderDiscount)}</strong></span>
          )}
          <span><small>Total discount</small><strong>{formatPercentage(calculation.discountPercentage)}</strong></span>
          <span className="quote-grand-total"><small>Quotation total</small><strong>{formatMoney(calculation.total)}</strong></span>
        </div>
        <div className={`quote-risk-decision quote-risk-decision--${calculation.risk.toLowerCase()}`}>
          {calculation.risk === 'LOW' ? <Check size={18} /> : <AlertTriangle size={18} />}
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
      </section>
    </div>
  )
}
