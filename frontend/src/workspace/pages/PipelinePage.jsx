import { ArrowUpRight, CircleDollarSign, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { calculateQuote, formatMoney } from '../dealMath.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, StatusBadge } from '../components/Ui.jsx'

const columns = [
  { id: 'DRAFT', title: 'Draft', description: 'Building terms' },
  { id: 'PENDING_APPROVAL', title: 'Approval', description: 'Pricing review' },
  { id: 'NEGOTIATION', title: 'Negotiation', description: 'Customer collaboration' },
  { id: 'FULFILLMENT', title: 'Fulfillment', description: 'Stock and delivery' },
]

export default function PipelinePage() {
  const { quotes, createQuote } = useWorkspace()
  const navigate = useNavigate()

  function startQuote() {
    navigate(`/quotations/${createQuote()}`)
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Visual pipeline"
        title="Move every deal forward."
        description="A live view of ownership, commercial value and the next required decision."
        actions={<button className="button button--primary" type="button" onClick={startQuote}><Plus size={16} /> Add deal</button>}
      />

      <section className="pipeline-board">
        {columns.map((column) => {
          const items = quotes.filter((quote) => quote.stage === column.id)
          const total = items.reduce((sum, quote) => sum + calculateQuote(quote).total, 0)
          return (
            <div className="pipeline-column" key={column.id}>
              <header>
                <span><i className={`pipeline-dot pipeline-dot--${column.id.toLowerCase()}`} /><strong>{column.title}</strong><b>{items.length}</b></span>
                <small>{column.description}</small>
                <div><CircleDollarSign size={14} /> {formatMoney(total, true)}</div>
              </header>
              <div className="pipeline-column__items">
                {items.map((quote) => {
                  const calculation = calculateQuote(quote)
                  return (
                    <button className="pipeline-card" type="button" key={quote.id} onClick={() => navigate(`/quotations/${quote.id}`)}>
                      <span><small>{quote.id}</small><ArrowUpRight size={14} /></span>
                      <strong>{quote.customer.name}</strong>
                      <p>{quote.customer.tier} price list · {quote.rep}</p>
                      <div><strong>{formatMoney(calculation.total)}</strong><StatusBadge status={quote.stage} /></div>
                      <footer><span>{calculation.marginPercent.toFixed(1)}% margin</span><span>Risk {calculation.riskScore}</span></footer>
                    </button>
                  )
                })}
                {!items.length && <div className="pipeline-empty">Drop the next deal here</div>}
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}

