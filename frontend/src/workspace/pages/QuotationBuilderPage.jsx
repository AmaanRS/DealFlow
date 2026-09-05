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
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { calculateQuote, formatMoney } from '../dealMath.js'
import { products, upsellSuggestions } from '../seed.js'
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
  } = useWorkspace()
  const quote = quotes.find((item) => item.id === quoteId)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [dismissed, setDismissed] = useState([])

  const calculation = useMemo(() => (quote ? calculateQuote(quote) : null), [quote])
  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return products.filter((product) => {
      const matchesCategory = category === 'All' || product.category === category
      const matchesQuery =
        !needle ||
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle)
      return matchesCategory && matchesQuery
    })
  }, [category, query])

  if (!quote || !calculation) {
    return (
      <div className="missing-state">
        <AlertTriangle size={28} />
        <h1>Quotation not found</h1>
        <button className="button button--primary" type="button" onClick={() => navigate('/quotations')}>Back to quotations</button>
      </div>
    )
  }

  function changeCustomer(field, value) {
    updateQuote(quote.id, (current) => ({
      ...current,
      customer: { ...current.customer, [field]: value },
    }))
  }

  function submitForNextStep() {
    if (!quote.lines.length) {
      toast.error('Add at least one product before continuing')
      return
    }
    const result = submitQuote(quote.id)
    if (result.stage === 'PENDING_APPROVAL') {
      toast.warning('Quotation routed automatically', {
        description: `${result.calculation.approvalLevel === 'MANAGER_AND_FINANCE' ? 'Manager and Finance' : 'Manager'} approval is required.`,
      })
      navigate(`/approvals/${quote.id}`)
    } else {
      toast.success('Pricing policy passed', { description: 'The order can move directly to fulfillment.' })
      navigate('/fulfillment')
    }
  }

  return (
    <div className="page-stack quote-builder-page">
      <header className="quote-builder-header">
        <div>
          <button className="back-link" type="button" onClick={() => navigate('/quotations')}><ArrowLeft size={15} /> Quotations</button>
          <span className="quote-title-line"><h1>{quote.id}</h1><StatusBadge status={quote.stage} /></span>
          <p>Created {quote.createdAt} · Valid until {quote.validUntil} · Owner {quote.rep}</p>
        </div>
        <div className="quote-builder-header__actions">
          <button className="button button--quiet" type="button" onClick={() => toast.success('Draft saved')}>Save draft</button>
          <button className="button button--primary" type="button" onClick={submitForNextStep}><Send size={15} /> Confirm & route</button>
        </div>
      </header>

      <WorkflowSteps stage={quote.stage} />

      <section className="quote-customer-bar">
        <label>
          <span>Customer</span>
          <input value={quote.customer.name} onChange={(event) => changeCustomer('name', event.target.value)} />
        </label>
        <label>
          <span>Contact email</span>
          <input type="email" value={quote.customer.email} onChange={(event) => changeCustomer('email', event.target.value)} placeholder="buyer@company.com" />
        </label>
        <label>
          <span>Price list</span>
          <select value={quote.customer.tier} onChange={(event) => changeCustomer('tier', event.target.value)}>
            <option>Bronze</option><option>Silver</option><option>Gold</option>
          </select>
        </label>
      </section>

      <div className="quote-builder-layout">
        <div className="quote-builder-main">
          <Panel title="Product catalogue" description="Add hardware, services and recurring plans to this quotation.">
            <div className="catalogue-toolbar">
              <label className="filter-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products or SKU" /></label>
              <div className="category-tabs">
                {categories.map((item) => <button type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)} key={item}>{item}</button>)}
              </div>
            </div>
            <div className="product-grid">
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
                    <button type="button" onClick={() => addProduct(quote.id, product.id)}><Plus size={15} /> Add</button>
                  </footer>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title="Quotation lines" description="Discount limits are evaluated per line and across the full deal.">
            <div className="quote-lines">
              {calculation.lines.map((line) => (
                <article className="quote-line" key={line.id}>
                  <div className="quote-line__product">
                    <span className={`product-card__icon product-card__icon--${line.product.category.toLowerCase()}`}><PackagePlus size={17} /></span>
                    <span><strong>{line.product.name}</strong><small>{line.product.sku} · {line.product.unit}</small></span>
                  </div>
                  <div className="quantity-control">
                    <button type="button" onClick={() => updateLine(quote.id, line.id, { quantity: Math.max(1, line.quantity - 1) })}><Minus size={13} /></button>
                    <strong>{line.quantity}</strong>
                    <button type="button" onClick={() => updateLine(quote.id, line.id, { quantity: line.quantity + 1 })}><Plus size={13} /></button>
                  </div>
                  <label className="discount-control"><span>Line discount</span><span><input type="number" min="0" max="60" value={line.discount} onChange={(event) => updateLine(quote.id, line.id, { discount: Number(event.target.value) })} />%</span><small className={line.excess > 0 ? 'text-danger' : 'text-muted'}>Limit {line.allowedDiscount}%</small></label>
                  <div className="quote-line__total"><strong>{formatMoney(line.net)}</strong><small>{line.marginPercent.toFixed(1)}% margin</small></div>
                  <button className="icon-button danger-hover" type="button" onClick={() => removeLine(quote.id, line.id)} aria-label={`Remove ${line.product.name}`}><Trash2 size={16} /></button>
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
                <span><small>Gross margin</small><strong className={calculation.marginPercent < 25 ? 'text-danger' : 'text-success'}>{calculation.marginPercent.toFixed(1)}%</strong></span>
                <span><small>Discount given</small><strong>{formatMoney(calculation.discountValue)}</strong></span>
              </div>
            </div>
            <label className="order-discount">
              <span>Order-level discount</span>
              <span><input type="number" min="0" max="40" value={quote.orderDiscount} onChange={(event) => updateQuote(quote.id, { orderDiscount: Number(event.target.value) })} />%</span>
            </label>
            <div className={`policy-callout ${calculation.approvalLevel === 'NONE' ? 'success' : 'warning'}`}>
              {calculation.approvalLevel === 'NONE' ? <Check size={16} /> : <AlertTriangle size={16} />}
              <span><strong>{calculation.approvalLevel === 'NONE' ? 'Within policy' : 'Approval required'}</strong><small>{calculation.approvalLevel === 'MANAGER_AND_FINANCE' ? 'Sales Manager → Finance' : calculation.approvalLevel === 'MANAGER' ? 'Sales Manager' : 'Can proceed directly'}</small></span>
            </div>
            <button className="button button--primary button--full" type="button" onClick={submitForNextStep}>Confirm & continue <ChevronRight size={15} /></button>
          </Panel>

          <Panel title="Smart suggestions" description="Ranked by co-purchase fit and healthy margin." className="suggestions-panel" action={<Sparkles size={16} className="text-blue" />}>
            <div className="suggestion-list">
              {upsellSuggestions.filter((item) => !dismissed.includes(item.id) && !quote.lines.some((line) => line.productId === item.productId)).map((suggestion) => {
                const product = products.find((item) => item.id === suggestion.productId)
                return (
                  <article className="suggestion-card" key={suggestion.id}>
                    <div><span>{suggestion.promoted && <b>Promoted</b>}<small>+{formatMoney(suggestion.marginDelta)} margin</small></span><strong>{product.name}</strong><p>{suggestion.reason}</p></div>
                    <footer><button type="button" onClick={() => { addProduct(quote.id, product.id); toast.success(`${product.name} added`) }}><Plus size={13} /> Add to quote</button><button type="button" onClick={() => setDismissed((items) => [...items, suggestion.id])}><X size={13} /> Dismiss</button></footer>
                  </article>
                )
              })}
              {!upsellSuggestions.some((item) => !dismissed.includes(item.id) && !quote.lines.some((line) => line.productId === item.productId)) && <p className="empty-copy">All relevant suggestions have been reviewed.</p>}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
