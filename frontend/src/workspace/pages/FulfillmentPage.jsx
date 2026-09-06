import {
  AlertTriangle,
  Boxes,
  Check,
  MapPin,
  PackageCheck,
  PackageX,
  RefreshCcw,
  Route,
  Truck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { productApi } from '../../api/productApi.js'
import { quoteApi } from '../../api/quoteApi.js'
import { storeApi } from '../../api/storeApi.js'
import { formatMoney } from '../dealMath.js'
import { PageHeader, Panel, StatusBadge } from '../components/Ui.jsx'

/** Metres are the allocator's unit; kilometres are what a human reads. */
function formatDistance(metres) {
  if (!Number.isFinite(metres)) return 'Distance unavailable'
  if (metres < 1000) return `${Math.round(metres)} m away`
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km away`
}

/**
 * Collapse the per-line allocation into one group per store.
 *
 * A shipment is a store, not a line: two lines pulled from the same warehouse
 * travel together, which is exactly the count the allocator is trying to keep
 * down. Distance is a property of the store, so it is the same on every line
 * within a group.
 */
function groupByStore(articles) {
  const groups = new Map()

  for (const article of articles) {
    const store = article.store_id
    // A subscription line carries no store and is not shipped.
    if (!store || typeof store !== 'object') continue

    const storeId = String(store._id)
    const group = groups.get(storeId) ?? {
      storeId,
      name: store.name,
      lat: store.lat,
      long: store.long,
      distanceMetres: article.distance_meters,
      units: 0,
      lines: [],
    }

    group.units += article.inv ?? 0
    group.lines.push({
      id: String(article._id),
      sku: article.seller_identifier,
      quantity: article.inv ?? 0,
      sellable: article.inventory?.sellable ?? 0,
    })
    if (Number.isFinite(article.distance_meters)) {
      group.distanceMetres = article.distance_meters
    }
    groups.set(storeId, group)
  }

  return [...groups.values()].sort((left, right) => {
    const leftDistance = Number.isFinite(left.distanceMetres) ? left.distanceMetres : Infinity
    const rightDistance = Number.isFinite(right.distanceMetres) ? right.distanceMetres : Infinity
    return leftDistance - rightDistance || left.name.localeCompare(right.name)
  })
}

/**
 * A quotation line that has no store yet. Until the allocation runs, or when no
 * store holds enough stock, these are the lines blocking the order.
 */
function unallocatedLines(articles) {
  return articles
    .filter((article) => !article.store_id || typeof article.store_id !== 'object')
    .map((article) => ({
      id: String(article._id),
      sku: article.seller_identifier,
      quantity: article.inv ?? 0,
      sellable: article.inventory?.sellable ?? 0,
    }))
}

export default function FulfillmentPage() {
  const [orders, setOrders] = useState([])
  const [ordersState, setOrdersState] = useState({ loading: true, error: '' })
  const [quoteId, setQuoteId] = useState('')
  const [allocation, setAllocation] = useState(null)
  const [allocationState, setAllocationState] = useState({ loading: false, error: '' })
  const [shortage, setShortage] = useState(null)
  const [storeCount, setStoreCount] = useState(null)
  const [allocating, setAllocating] = useState(false)

  useEffect(() => {
    let mounted = true

    Promise.all([quoteApi.listApproved(), storeApi.list()])
      .then(([quoteResult, storeResult]) => {
        if (!mounted) return
        const approved = quoteResult.quotes ?? []
        setOrders(approved)
        setStoreCount((storeResult.stores ?? []).length)
        setQuoteId((current) => current || String(approved[0]?._id ?? ''))
        setOrdersState({ loading: false, error: '' })
      })
      .catch((error) => {
        if (mounted) setOrdersState({ loading: false, error: error.message })
      })

    return () => { mounted = false }
  }, [])

  /**
   * Fetch where each line of `targetQuoteId` is currently allocated. The first
   * state write is deferred by a microtask so this stays safe to call straight
   * from an effect without triggering a cascading render.
   */
  const loadAllocation = useCallback((targetQuoteId) => {
    if (!targetQuoteId) return undefined
    let mounted = true

    Promise.resolve()
      .then(() => {
        if (!mounted) return null
        setAllocationState({ loading: true, error: '' })
        return productApi.quoteInventory(targetQuoteId)
      })
      .then((result) => {
        if (!mounted || !result) return
        setAllocation(result.articles ?? [])
        setAllocationState({ loading: false, error: '' })
      })
      .catch((error) => {
        if (mounted) setAllocationState({ loading: false, error: error.message })
      })

    return () => { mounted = false }
  }, [])

  useEffect(() => loadAllocation(quoteId), [loadAllocation, quoteId])

  /** A shortage belongs to one order, so switching orders clears it. */
  function selectOrder(nextQuoteId) {
    setShortage(null)
    setQuoteId(nextQuoteId)
  }

  const order = orders.find((item) => String(item._id) === quoteId)
  const groups = useMemo(() => groupByStore(allocation ?? []), [allocation])
  const pending = useMemo(() => unallocatedLines(allocation ?? []), [allocation])
  const allocatedUnits = groups.reduce((sum, group) => sum + group.units, 0)
  const pendingUnits = pending.reduce((sum, line) => sum + line.quantity, 0)
  const furthest = groups.reduce(
    (max, group) => (Number.isFinite(group.distanceMetres) ? Math.max(max, group.distanceMetres) : max),
    0,
  )

  /**
   * Runs the allocator and persists the result. Night Sky returns 409
   * NO_ELIGIBLE_STORE when no single store can cover a line, which is the
   * backorder case: the order stays as it was and the shortage is surfaced so
   * the rep can retry once stock lands.
   */
  async function acceptSuggestedSplit() {
    setAllocating(true)
    setShortage(null)
    try {
      const result = await storeApi.split(quoteId)
      loadAllocation(quoteId)
      const shipments = new Set(
        (result.store_split ?? []).map((assignment) => assignment.store_id),
      ).size
      toast.success('Allocation accepted', {
        description: `${result.store_split?.length ?? 0} line${result.store_split?.length === 1 ? '' : 's'} reserved across ${shipments} shipment${shipments === 1 ? '' : 's'}.`,
      })
    } catch (error) {
      if (error.code === 'NO_ELIGIBLE_STORE') {
        setShortage(error)
        toast.warning('Not enough stock in any one store', {
          description: 'The order stays unallocated until inventory is topped up.',
        })
      } else {
        toast.error(error.message ?? 'The allocation could not be completed.')
      }
    } finally {
      setAllocating(false)
    }
  }

  if (ordersState.loading) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Operations" title="Warehouse fulfillment" />
        <Panel><p className="empty-copy empty-copy--large">Loading approved orders…</p></Panel>
      </div>
    )
  }

  if (ordersState.error) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Operations" title="Warehouse fulfillment" />
        <Panel><div className="inline-error">{ordersState.error}</div></Panel>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Operations"
          title="Warehouse fulfillment"
          description="Approved orders are allocated to the nearest store holding enough stock."
        />
        <Panel>
          <div className="empty-cart">
            <PackageCheck size={24} />
            <strong>No approved orders yet</strong>
            <span>A quotation appears here once it has been approved.</span>
          </div>
        </Panel>
      </div>
    )
  }

  const busy = allocating || allocationState.loading

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operations"
        title="Warehouse fulfillment"
        description="Each line is pulled from the nearest store that holds enough sellable stock, so the order ships in as few parcels as possible."
        actions={
          <label className="header-select">
            <span>Order</span>
            <select value={quoteId} onChange={(event) => selectOrder(event.target.value)}>
              {orders.map((item) => (
                <option value={String(item._id)} key={String(item._id)}>
                  {item.customer?.fullName ?? 'Customer'} · {formatMoney(item.selling_price)}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <section className="operation-summary">
        <article>
          <span><Boxes size={17} /></span>
          <div><small>Order value</small><strong>{formatMoney(order.selling_price)}</strong></div>
        </article>
        <article>
          <span><Truck size={17} /></span>
          <div><small>Shipments</small><strong>{groups.length}</strong></div>
        </article>
        <article>
          <span><Route size={17} /></span>
          <div>
            <small>Furthest store</small>
            <strong>{groups.length ? formatDistance(furthest) : '—'}</strong>
          </div>
        </article>
        <article>
          <span><PackageX size={17} /></span>
          <div><small>Unallocated units</small><strong>{pendingUnits}</strong></div>
        </article>
      </section>

      {shortage && (
        <section className="backorder-callout">
          <span><RefreshCcw size={19} /></span>
          <div>
            <strong>No single store can cover every line.</strong>
            <p>
              {shortage.details?.requested_inv
                ? `${shortage.details.requested_inv} unit${shortage.details.requested_inv === 1 ? '' : 's'} were requested for one line and no store holds that much sellable stock.`
                : shortage.message}{' '}
              Add inventory from the back-end, then run the allocation again to
              consolidate the remaining lines.
            </p>
          </div>
          <button className="button button--secondary" type="button" onClick={acceptSuggestedSplit} disabled={busy}>
            Retry allocation
          </button>
        </section>
      )}

      <div className="fulfillment-layout">
        <div className="fulfillment-main">
          <Panel
            title="Shipment plan"
            description="One group per store. Lines from the same store travel together."
            action={groups.length ? <span className="recommendation-chip"><Route size={14} /> Nearest eligible store</span> : null}
          >
            {allocationState.loading ? (
              <p className="empty-copy empty-copy--large">Loading allocation…</p>
            ) : allocationState.error ? (
              <div className="inline-error">{allocationState.error}</div>
            ) : (
              <div className="shipment-list">
                {groups.map((group, index) => (
                  <article className="shipment-card" key={group.storeId}>
                    <header>
                      <span className="shipment-number">{index + 1}</span>
                      <div>
                        <strong>{group.name}</strong>
                        <small><MapPin size={12} /> {formatDistance(group.distanceMetres)}</small>
                      </div>
                      <span>
                        <small>Units</small>
                        <strong>{group.units}</strong>
                      </span>
                    </header>
                    <div className="shipment-lines">
                      {group.lines.map((line) => (
                        <div key={line.id}>
                          <span>
                            <strong>{line.sku}</strong>
                            <small>{line.sellable} sellable at this store</small>
                          </span>
                          <strong>{line.quantity} units</strong>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}

                {pending.length > 0 && (
                  <article className="shipment-card shipment-card--backorder">
                    <header>
                      <span className="shipment-number">!</span>
                      <div>
                        <strong>Awaiting allocation</strong>
                        <small><AlertTriangle size={12} /> No store assigned yet</small>
                      </div>
                      <span>
                        <small>Units</small>
                        <strong>{pendingUnits}</strong>
                      </span>
                    </header>
                    <div className="shipment-lines">
                      {pending.map((line) => (
                        <div key={line.id}>
                          <span>
                            <strong>{line.sku}</strong>
                            <small>{line.sellable} sellable on the quoted article</small>
                          </span>
                          <strong>{line.quantity} units</strong>
                        </div>
                      ))}
                    </div>
                  </article>
                )}

                {!groups.length && !pending.length && (
                  <div className="empty-cart">
                    <PackageCheck size={24} />
                    <strong>Nothing to ship</strong>
                    <span>This order has no physical lines. Subscriptions are not allocated to a store.</span>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>

        <aside className="fulfillment-aside">
          <Panel title="Allocation" description="Accepting reserves each line against the chosen store.">
            <dl className="allocation-summary">
              <div><dt>Stores used</dt><dd>{groups.length}</dd></div>
              <div><dt>Units allocated</dt><dd>{allocatedUnits}</dd></div>
              <div>
                <dt>Coverage</dt>
                <dd className={pendingUnits ? 'text-danger' : 'text-success'}>
                  {pendingUnits ? `${pendingUnits} short` : 'Complete'}
                </dd>
              </div>
              <div><dt>Order status</dt><dd><StatusBadge status={order.status} /></dd></div>
            </dl>

            <button
              className={`button button--full ${pendingUnits ? 'button--primary' : 'button--success'}`}
              type="button"
              onClick={acceptSuggestedSplit}
              disabled={busy || !storeCount}
            >
              {allocating
                ? 'Allocating…'
                : pendingUnits
                  ? <>Accept suggested split</>
                  : <><Check size={16} /> Re-run allocation</>}
            </button>

            {!storeCount && (
              <p className="empty-copy">
                No stores exist yet. An administrator has to create one before an
                order can be allocated.
              </p>
            )}
          </Panel>

        </aside>
      </div>
    </div>
  )
}
