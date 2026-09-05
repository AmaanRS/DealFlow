import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Check,
  ChevronRight,
  CircleDollarSign,
  Minus,
  PackagePlus,
  Plus,
  Search,
  Send,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { customerApi } from '../../api/customerApi.js'
import { productApi } from '../../api/productApi.js'
import { calculateQuote, formatMoney, formatPercentage } from '../dealMath.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { Panel, RiskGauge, StatusBadge } from '../components/Ui.jsx'

const categories = ['All', 'Hardware', 'Services', 'Subscriptions']

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
  const needsCatalogue = Boolean(quote && !quote.serverManaged)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [customers, setCustomers] = useState([])
  const [catalogueProducts, setCatalogueProducts] = useState([])
  const [catalogueLoading, setCatalogueLoading] = useState(true)
  const [catalogueError, setCatalogueError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!needsCatalogue) return undefined
    let active = true

    Promise.all([customerApi.list(), productApi.list()])
      .then(([customerResult, productResult]) => {
        if (!active) return
        setCustomers(customerResult.customers ?? [])
        setCatalogueProducts(productResult.products ?? [])
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
  }, [needsCatalogue])

  const calculation = useMemo(() => (quote ? calculateQuote(quote) : null), [quote])
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

  if (!quote || !calculation) {
    return (
      <div className="missing-state">
        <AlertTriangle size={28} />
        <h1>Quotation not found</h1>
        <button className="button button--primary" type="button" onClick={() => navigate('/quotations')}>Back to quotations</button>
      </div>
    )
  }

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

  async function submitForNextStep() {
    if (!quote.customer.id) {
      toast.error('Select a customer before continuing')
      return
    }
    if (!quote.lines.length) {
      toast.error('Add at least one product before continuing')
      return
    }

    setSubmitting(true)
    try {
      const result = await submitQuote(quote.id)
      toast.success('Quotation created and routed', {
        description: `Morning Star calculated ${result.quote.serverPricing.risk.toLowerCase()} commercial risk.`,
      })
      navigate(`/quotations/${result.quote.id}`)
    } catch (error) {
      toast.error(error.message ?? 'The quotation could not be created.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-stack quote-builder-page">
      <header className="quote-builder-header">
        <div>
          <button className="back-link" type="button" onClick={() => navigate('/quotations')}><ArrowLeft size={15} /> Quotations</button>
          <span className="quote-title-line"><h1>{quote.id}</h1><StatusBadge status={quote.stage} /></span>
          <p>Created {quote.createdAt}{!quote.serverManaged && ` · Valid until ${quote.validUntil}`} · Owner {quote.rep}</p>
        </div>
        <div className="quote-builder-header__actions">
          {quote.serverManaged ? (
            <button className="button button--quiet" type="button" onClick={refreshQuotes}>Refresh quotation</button>
          ) : (
            <button className="button button--primary" type="button" onClick={submitForNextStep} disabled={submitting || catalogueLoading}>
              <Send size={15} /> {submitting ? 'Creating…' : 'Create & route'}
            </button>
          )}
        </div>
      </header>

      <WorkflowSteps stage={quote.stage} />

      <section className="quote-customer-bar">
        <label>
          <span>Customer</span>
          {quote.serverManaged ? (
            <input value={quote.customer.name} disabled />
          ) : (
            <select value={quote.customer.id} onChange={(event) => changeCustomer(event.target.value)} disabled={catalogueLoading}>
              <option value="">Select a customer</option>
              {customers.map((customer) => (
                <option value={customer.id} key={customer.id}>{customer.fullName}</option>
              ))}
            </select>
          )}
        </label>
        <label>
          <span>Contact email</span>
          <input type="email" value={quote.customer.email} placeholder="Select a customer" disabled />
        </label>
        <label>
          <span>Price list</span>
          <input value={quote.customer.tier} placeholder="Assigned automatically" disabled />
        </label>
      </section>

      <div className="quote-builder-layout">
        <div className="quote-builder-main">
          {!quote.serverManaged && <Panel title="Product catalogue" description="Add hardware, services and recurring plans to this quotation.">
            <div className="catalogue-toolbar">
              <label className="filter-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products or SKU" /></label>
              <div className="category-tabs">
                {categories.map((item) => <button type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)} key={item}>{item}</button>)}
              </div>
            </div>
            <div className="product-grid">
              {catalogueLoading && <p className="empty-copy">Loading products and customers…</p>}
              {!catalogueLoading && catalogueError && <p className="empty-copy">{catalogueError.message}</p>}
              {filteredProducts.map((product) => (
                <article className="product-card" key={product.id}>
                  <span className={`product-card__icon product-card__icon--${product.category.toLowerCase()}`}>
                    {product.recurring ? <CircleDollarSign size={19} /> : <Boxes size={19} />}
                  </span>
                  <span className="product-card__meta">{product.category} · {product.sku}</span>
                  <h3>{product.name}</h3>
                  <p>{product.description}</p>
                  <footer>
                    <span><strong>{formatMoney(product.price)}</strong><small> / {product.unit}</small></span>
                    <button type="button" onClick={() => addProduct(quote.id, product)} disabled={product.stock === 0 && !product.recurring}><Plus size={15} /> Add</button>
                  </footer>
                </article>
              ))}
              {!catalogueLoading && !catalogueError && !filteredProducts.length && <p className="empty-copy">No products match this selection.</p>}
            </div>
          </Panel>}

          <Panel title="Quotation lines" description="Discount limits are evaluated per line and across the full deal.">
            <div className="quote-lines">
              {calculation.lines.map((line) => (
                <article className="quote-line" key={line.id}>
                  <div className="quote-line__product">
                    <span className={`product-card__icon product-card__icon--${line.product.category.toLowerCase()}`}><PackagePlus size={17} /></span>
                    <span><strong>{line.product.name}</strong><small>{line.product.sku} · {line.product.unit}</small></span>
                  </div>
                  <div className="quantity-control">
                    <button type="button" onClick={() => updateLine(quote.id, line.id, { quantity: Math.max(1, line.quantity - 1) })} disabled={quote.serverManaged}><Minus size={13} /></button>
                    <strong>{line.quantity}</strong>
                    <button type="button" onClick={() => updateLine(quote.id, line.id, { quantity: line.quantity + 1 })} disabled={quote.serverManaged}><Plus size={13} /></button>
                  </div>
                  <label className="discount-control"><span>Line discount</span><span><input type="number" min="0" max="60" value={line.discount} onChange={(event) => updateLine(quote.id, line.id, { discount: Number(event.target.value) })} disabled={quote.serverManaged} />%</span><small className={line.excess > 0 ? 'text-danger' : 'text-muted'}>Limit {line.allowedDiscount}%</small></label>
                  <div className="quote-line__total"><strong>{formatMoney(line.net)}</strong><small>{formatPercentage(line.marginPercent)} margin</small></div>
                  {!quote.serverManaged && <button className="icon-button danger-hover" type="button" onClick={() => removeLine(quote.id, line.id)} aria-label={`Remove ${line.product.name}`}><Trash2 size={16} /></button>}
                </article>
              ))}
              {!calculation.lines.length && <div className="empty-cart"><PackagePlus size={24} /><strong>Your quotation is empty</strong><span>Add products from the catalogue above.</span></div>}
            </div>
          </Panel>
        </div>

        <aside className="quote-builder-aside">
          <Panel title="Live commercial health" className="sticky-panel">
            <div className="health-summary">
              <RiskGauge score={calculation.riskScore} />
              <div className="health-summary__metrics">
                <span><small>Net value</small><strong>{formatMoney(calculation.total)}</strong></span>
                <span><small>Gross margin</small><strong className={Number.isFinite(calculation.marginPercent) && calculation.marginPercent < 25 ? 'text-danger' : 'text-success'}>{formatPercentage(calculation.marginPercent)}</strong></span>
                <span><small>Discount given</small><strong>{formatMoney(calculation.discountValue)}</strong></span>
              </div>
            </div>
            <label className="order-discount">
              <span>Order-level discount</span>
              <span><input type="number" min="0" max="40" value={quote.orderDiscount} onChange={(event) => updateQuote(quote.id, { orderDiscount: Number(event.target.value) })} disabled={quote.serverManaged} />%</span>
            </label>
            <div className={`policy-callout ${calculation.approvalLevel === 'NONE' ? 'success' : 'warning'}`}>
              {calculation.approvalLevel === 'NONE' ? <Check size={16} /> : <AlertTriangle size={16} />}
              <span><strong>{calculation.approvalLevel === 'NONE' ? 'Within policy' : 'Approval required'}</strong><small>{calculation.approvalLevel === 'MANAGER_AND_FINANCE' ? 'Sales Manager → Finance' : calculation.approvalLevel === 'MANAGER' ? 'Sales Manager' : 'Can proceed directly'}</small></span>
            </div>
            {!quote.serverManaged && <button className="button button--primary button--full" type="button" onClick={submitForNextStep} disabled={submitting || catalogueLoading}>{submitting ? 'Creating quotation…' : 'Create & route'} <ChevronRight size={15} /></button>}
          </Panel>
        </aside>
      </div>
    </div>
  )
}
