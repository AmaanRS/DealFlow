import { GripVertical, LayoutGrid, List, Lock, Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { calculateQuote, formatMoney } from '../dealMath.js'
import { BOARD_COLUMNS, MOVABLE_STAGES } from '../quoteStages.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, StatusBadge } from '../components/Ui.jsx'

/** Sentinel that asks for the next page once it scrolls into view. */
function InfiniteScrollSentinel({ onReach, active, busy }) {
  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node || !active) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onReach()
      },
      { rootMargin: '240px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [active, onReach])

  if (!active) return null

  return (
    <div className="scroll-sentinel" ref={ref} aria-hidden={!busy}>
      <span className="spinner" /> Loading more quotations…
    </div>
  )
}

export default function QuotationsPage() {
  const {
    quotes,
    createQuote,
    moveQuote,
    quotesError,
    quotesLoading,
    quotesLoadingMore,
    hasMoreQuotes,
    loadMoreQuotes,
    refreshQuotes,
  } = useWorkspace()
  const navigate = useNavigate()
  const [view, setView] = useState('board')
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const savedQuotes = quotes.filter((quote) => !quote.isUnsaved)
    if (!needle) return savedQuotes
    return savedQuotes.filter((quote) =>
      quote.id.toLowerCase().includes(needle) ||
      quote.customer.name.toLowerCase().includes(needle) ||
      quote.rep.toLowerCase().includes(needle),
    )
  }, [query, quotes])

  const openQuote = useCallback((quoteId) => navigate(`/quotations/${quoteId}`), [navigate])

  function startQuote() {
    navigate(`/quotations/${createQuote()}`)
  }

  /**
   * A drop is offered only when the server would accept the write: the card has
   * been saved, the column is one a sales rep owns, and it is not where the card
   * already sits.
   */
  function columnAcceptsDrop(columnId) {
    if (!dragging) return false
    if (!dragging.serverManaged) return false
    if (dragging.stage === columnId) return false
    return MOVABLE_STAGES.includes(columnId)
  }

  function handleDragStart(event, quote) {
    setDragging({ id: quote.id, stage: quote.stage, serverManaged: quote.serverManaged })
    event.dataTransfer.effectAllowed = 'move'
    // Firefox will not start a drag without payload on the transfer object.
    event.dataTransfer.setData('text/plain', quote.id)
  }

  function handleDragEnd() {
    setDragging(null)
    setDropTarget(null)
  }

  async function handleDrop(event, columnId) {
    event.preventDefault()
    const dropped = dragging
    setDragging(null)
    setDropTarget(null)
    if (!dropped || !columnAcceptsDrop(columnId)) return

    const column = BOARD_COLUMNS.find((item) => item.id === columnId)
    try {
      await moveQuote(dropped.id, columnId)
      toast.success(`Moved to ${column.title}`, {
        description: columnId === 'PENDING_APPROVAL'
          ? 'The quotation was repriced and routed to a sales manager.'
          : 'The quotation is editable again as a draft.',
      })
    } catch (error) {
      toast.error(error.message ?? 'The quotation could not be moved.')
    }
  }

  const unavailable = quotesLoading || quotesError

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Sales workspace"
        title="Quotations"
        description="Every quotation in the system. Drag a card between Draft and Pending Approval, or select one to open it."
      />

      {unavailable ? (
        <section className="data-table-wrap">
          <p className="empty-copy empty-copy--large">
            {quotesLoading ? 'Loading quotations…' : quotesError.message}
            {!quotesLoading && quotesError && (
              <> <button className="link-button" type="button" onClick={refreshQuotes}>Try again</button></>
            )}
          </p>
        </section>
      ) : view === 'board' ? (
        <>
          <section className="pipeline-board pipeline-board--five">
            {BOARD_COLUMNS.map((column) => {
              const items = filtered.filter((quote) => quote.stage === column.id)
              const droppable = columnAcceptsDrop(column.id)
              const blocked = Boolean(dragging) && !droppable && dragging.stage !== column.id

              return (
                <div
                  className={`pipeline-column${droppable ? ' is-droppable' : ''}${dropTarget === column.id && droppable ? ' is-drop-target' : ''}${blocked ? ' is-blocked' : ''}`}
                  key={column.id}
                  onDragOver={(event) => {
                    if (!droppable) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDropTarget(column.id)
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return
                    setDropTarget((current) => (current === column.id ? null : current))
                  }}
                  onDrop={(event) => handleDrop(event, column.id)}
                >
                  <header>
                    <span>
                      <i className={`pipeline-dot pipeline-dot--${column.id.toLowerCase()}`} />
                      <strong>{column.title}</strong>
                      <b>{items.length}</b>
                      {!MOVABLE_STAGES.includes(column.id) && (
                        <Lock size={11} className="column-lock" aria-label="Not a stage you can move a quotation into" />
                      )}
                    </span>
                    <small>{column.description}</small>
                  </header>

                  <div className="pipeline-column__items">
                    {items.map((quote) => (
                      <div
                        className={`quote-board-card${dragging?.id === quote.id ? ' is-dragging' : ''}`}
                        key={quote.id}
                        draggable={quote.serverManaged}
                        onDragStart={(event) => handleDragStart(event, quote)}
                        onDragEnd={handleDragEnd}
                        onClick={() => openQuote(quote.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openQuote(quote.id)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        {quote.serverManaged && (
                          <GripVertical size={13} className="quote-board-card__grip" aria-hidden="true" />
                        )}
                        <strong>{quote.customer.name}</strong>
                        <span>{formatMoney(calculateQuote(quote).total)}</span>
                      </div>
                    ))}
                    {!items.length && <div className="pipeline-empty">No deals in this stage</div>}
                  </div>
                </div>
              )
            })}
          </section>

          <InfiniteScrollSentinel
            active={hasMoreQuotes && !query}
            busy={quotesLoadingMore}
            onReach={loadMoreQuotes}
          />
        </>
      ) : (
        <>
          <section className="list-toolbar">
            <label className="filter-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search customer, quote or owner"
              />
            </label>
          </section>

          <section className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Quotation</th>
                  <th>Customer</th>
                  <th>Owner</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((quote) => (
                  <tr key={quote.id} onClick={() => openQuote(quote.id)}>
                    <td><strong>{quote.id}</strong></td>
                    <td><strong>{quote.customer.name}</strong><small>{quote.customer.tier}</small></td>
                    <td>{quote.rep}</td>
                    <td><strong>{formatMoney(calculateQuote(quote).total)}</strong></td>
                    <td><StatusBadge status={quote.stage} /></td>
                    <td>{quote.inactivityDays ? `${quote.inactivityDays}d ago` : 'Today'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <p className="empty-copy empty-copy--large">No quotations match this search.</p>}
          </section>

          <InfiniteScrollSentinel
            active={hasMoreQuotes && !query}
            busy={quotesLoadingMore}
            onReach={loadMoreQuotes}
          />
        </>
      )}

      <section className="quote-list-actions">
        <button className="button button--primary" type="button" onClick={startQuote}>
          <Plus size={16} /> New Quotation
        </button>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setView((current) => (current === 'board' ? 'table' : 'board'))}
        >
          {view === 'board' ? <><List size={15} /> Switch to Table View</> : <><LayoutGrid size={15} /> Switch to Board View</>}
        </button>
      </section>
    </div>
  )
}
