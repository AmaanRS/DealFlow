import {
  ArrowRight,
  Boxes,
  Check,
  CircleDollarSign,
  MapPin,
  PackageCheck,
  RefreshCcw,
  Route,
  Settings2,
  Truck,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { calculateQuote, formatMoney, getRecommendedSplit } from '../dealMath.js'
import { warehouseData } from '../seed.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, Panel, StatusBadge } from '../components/Ui.jsx'

export default function FulfillmentPage() {
  const { quotes, updateQuote } = useWorkspace()
  const eligible = quotes.filter((quote) => ['APPROVED', 'FULFILLMENT', 'CONFIRMED'].includes(quote.stage))
  const [quoteId, setQuoteId] = useState(eligible.find((quote) => quote.stage === 'FULFILLMENT')?.id || eligible[0]?.id)
  const quote = eligible.find((item) => item.id === quoteId)
  const [shipments, setShipments] = useState(() => (quote ? getRecommendedSplit(quote) : []))
  const [manual, setManual] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [backorderReady, setBackorderReady] = useState(true)

  function selectQuote(nextQuoteId) {
    const nextQuote = eligible.find((item) => item.id === nextQuoteId)
    setQuoteId(nextQuoteId)
    setShipments(nextQuote ? getRecommendedSplit(nextQuote) : [])
    setManual(false)
    setAccepted(false)
    setBackorderReady(true)
  }

  if (!quote) {
    return <div className="page-stack"><PageHeader eyebrow="Operations" title="Warehouse fulfillment" description="Approve a quotation before planning its stock allocation." /></div>
  }

  const shippingCost = shipments.reduce((sum, shipment) => sum + shipment.cost, 0)
  const backordered = shipments.reduce(
    (sum, shipment) => sum + (shipment.backorder ? shipment.lines.reduce((count, line) => count + line.quantity, 0) : 0),
    0,
  )
  const calculation = calculateQuote(quote)

  function acceptSplit() {
    setAccepted(true)
    updateQuote(quote.id, (current) => ({
      ...current,
      stage: 'FULFILLMENT',
      audit: [
        { id: `audit-${crypto.randomUUID()}`, actor: 'Operations desk', action: 'Warehouse split accepted', detail: `${shipments.length} shipment groups reserved at ${formatMoney(shippingCost)} estimated cost.`, time: 'Just now' },
        ...current.audit,
      ],
    }))
    toast.success('Inventory reservations created', { description: `${shipments.length} shipment groups are now planned.` })
  }

  function adjustQuantity(shipmentIndex, lineIndex, value) {
    setShipments((current) => current.map((shipment, currentShipmentIndex) =>
      currentShipmentIndex === shipmentIndex
        ? { ...shipment, lines: shipment.lines.map((line, currentLineIndex) => currentLineIndex === lineIndex ? { ...line, quantity: Math.max(0, Number(value)) } : line) }
        : shipment,
    ))
  }

  function consolidateBackorder() {
    setBackorderReady(false)
    setShipments((current) => current.filter((shipment) => !shipment.backorder))
    toast.success('Remaining backorder consolidated', { description: 'New stock was assigned to the Main Warehouse shipment.' })
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operations"
        title="Warehouse fulfillment"
        description="Minimize shipments while protecting live stock and the promised delivery date."
        actions={
          <label className="header-select">
            <span>Order</span>
            <select value={quoteId} onChange={(event) => selectQuote(event.target.value)}>
              {eligible.map((item) => <option value={item.id} key={item.id}>{item.id} · {item.customer.name}</option>)}
            </select>
          </label>
        }
      />

      <section className="operation-summary">
        <article><span><Boxes size={17} /></span><div><small>Order value</small><strong>{formatMoney(calculation.total)}</strong></div></article>
        <article><span><Truck size={17} /></span><div><small>Suggested shipments</small><strong>{shipments.filter((item) => !item.backorder).length}</strong></div></article>
        <article><span><CircleDollarSign size={17} /></span><div><small>Estimated shipping</small><strong>{formatMoney(shippingCost)}</strong></div></article>
        <article><span><PackageCheck size={17} /></span><div><small>Backordered units</small><strong>{backordered}</strong></div></article>
      </section>

      {backorderReady && (
        <section className="backorder-callout">
          <span><RefreshCcw size={19} /></span>
          <div><strong>New inventory can reduce this order to two shipments.</strong><p>Six ApexBook Pro units arrived at Main Warehouse after the original allocation.</p></div>
          <button className="button button--secondary" type="button" onClick={consolidateBackorder}>Consolidate remaining backorder</button>
        </section>
      )}

      <div className="fulfillment-layout">
        <div className="fulfillment-main">
          <Panel
            title="Recommended split"
            description="Optimized using stock availability, service level and shipping cost weighting."
            action={<span className="recommendation-chip"><Route size={14} /> Best route</span>}
          >
            <div className="shipment-list">
              {shipments.map((shipment, shipmentIndex) => (
                <article className={`shipment-card ${shipment.backorder ? 'shipment-card--backorder' : ''}`} key={shipment.warehouseId}>
                  <header>
                    <span className="shipment-number">{shipment.backorder ? '!' : shipmentIndex + 1}</span>
                    <div><strong>{shipment.warehouse}</strong><small><MapPin size={12} /> {shipment.city} · {shipment.serviceLevel}</small></div>
                    <span><small>Shipment cost</small><strong>{formatMoney(shipment.cost)}</strong></span>
                  </header>
                  <div className="shipment-lines">
                    {shipment.lines.map((line, lineIndex) => (
                      <div key={`${shipment.warehouseId}-${line.productId}`}>
                        <span><strong>{line.name}</strong><small>Reserved from live stock</small></span>
                        {manual ? <input type="number" min="0" value={line.quantity} onChange={(event) => adjustQuantity(shipmentIndex, lineIndex, event.target.value)} /> : <strong>{line.quantity} units</strong>}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="fulfillment-aside">
          <Panel title="Allocation decision" description="Review before reserving inventory.">
            <dl className="allocation-summary">
              <div><dt>Warehouses used</dt><dd>{shipments.filter((item) => !item.backorder).length}</dd></div>
              <div><dt>Available now</dt><dd>{backordered ? `${backordered} short` : '100%'}</dd></div>
              <div><dt>Delivery promise</dt><dd><span className="text-success">Protected</span></dd></div>
              <div><dt>Quote status</dt><dd><StatusBadge status={quote.stage} /></dd></div>
            </dl>
            <button className={`button button--full ${accepted ? 'button--success' : 'button--primary'}`} type="button" onClick={acceptSplit} disabled={accepted}>
              {accepted ? <><Check size={16} /> Split accepted</> : <>Accept suggested split <ArrowRight size={15} /></>}
            </button>
            <button className="button button--quiet button--full" type="button" onClick={() => setManual((value) => !value)}>
              <Settings2 size={15} /> {manual ? 'Use recommendation' : 'Manual override'}
            </button>
          </Panel>

          <Panel title="Warehouse capacity" description="Current utilization across configured locations.">
            <div className="capacity-list">
              {warehouseData.map((warehouse) => (
                <div key={warehouse.id}>
                  <span><strong>{warehouse.name}</strong><small>{warehouse.utilization}% used</small></span>
                  <i><b style={{ width: `${warehouse.utilization}%` }} /></i>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
