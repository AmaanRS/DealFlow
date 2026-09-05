import { Filter, LayoutGrid, List, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { calculateQuote, formatMoney } from '../dealMath.js'
import { stageMeta } from '../seed.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, StatusBadge } from '../components/Ui.jsx'

export default function QuotationsPage() {
  const { quotes, createQuote } = useWorkspace()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [view, setView] = useState('table')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return quotes.filter((quote) => {
      const matchesStatus = status === 'ALL' || quote.stage === status
      const matchesSearch =
        !needle ||
        quote.id.toLowerCase().includes(needle) ||
        quote.customer.name.toLowerCase().includes(needle) ||
        quote.rep.toLowerCase().includes(needle)
      return matchesStatus && matchesSearch
    })
  }, [query, quotes, status])

  function startQuote() {
    navigate(`/quotations/${createQuote()}`)
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Sales workspace"
        title="Quotations"
        description="Build, govern and follow every commercial proposal from draft to confirmation."
        actions={
          <button className="button button--primary" type="button" onClick={startQuote}>
            <Plus size={16} /> New quotation
          </button>
        }
      />

      <section className="list-toolbar">
        <label className="filter-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search customer, quote or owner"
          />
        </label>
        <label className="select-control">
          <Filter size={15} />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">All statuses</option>
            {Object.entries(stageMeta).map(([value, meta]) => (
              <option value={value} key={value}>{meta.label}</option>
            ))}
          </select>
        </label>
        <button className="button button--quiet" type="button">
          <SlidersHorizontal size={15} /> More filters
        </button>
        <div className="view-toggle" aria-label="Quotation view">
          <button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} aria-label="Table view"><List size={16} /></button>
          <button type="button" className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')} aria-label="Card view"><LayoutGrid size={16} /></button>
        </div>
      </section>

      {view === 'table' ? (
        <section className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Quotation</th>
                <th>Customer</th>
                <th>Owner</th>
                <th>Value</th>
                <th>Margin</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((quote) => {
                const calculation = calculateQuote(quote)
                return (
                  <tr key={quote.id} onClick={() => navigate(`/quotations/${quote.id}`)}>
                    <td><strong>{quote.id}</strong><small>Valid until {quote.validUntil}</small></td>
                    <td><strong>{quote.customer.name}</strong><small>{quote.customer.tier} price list</small></td>
                    <td>{quote.rep}</td>
                    <td><strong>{formatMoney(calculation.total)}</strong></td>
                    <td><span className={calculation.marginPercent < 25 ? 'text-danger' : 'text-success'}>{calculation.marginPercent.toFixed(1)}%</span></td>
                    <td><StatusBadge status={quote.stage} /></td>
                    <td>{quote.inactivityDays ? `${quote.inactivityDays}d ago` : 'Today'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!filtered.length && <p className="empty-copy empty-copy--large">No quotations match these filters.</p>}
        </section>
      ) : (
        <section className="quotation-card-grid">
          {filtered.map((quote) => {
            const calculation = calculateQuote(quote)
            return (
              <button className="quotation-card" type="button" key={quote.id} onClick={() => navigate(`/quotations/${quote.id}`)}>
                <span className="quotation-card__top"><StatusBadge status={quote.stage} /><small>{quote.id}</small></span>
                <strong>{quote.customer.name}</strong>
                <span>{quote.customer.tier} customer · {quote.rep}</span>
                <div><strong>{formatMoney(calculation.total)}</strong><small>{calculation.marginPercent.toFixed(1)}% margin</small></div>
              </button>
            )
          })}
        </section>
      )}
    </div>
  )
}

