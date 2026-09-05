import {
  BadgeIndianRupee,
  CalendarClock,
  Check,
  CreditCard,
  FileMinus2,
  ReceiptIndianRupee,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { calculateQuote, formatMoney, getRecurringSchedule } from '../dealMath.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, Panel, StatusBadge } from '../components/Ui.jsx'

export default function BillingPage() {
  const { quotes } = useWorkspace()
  const billable = quotes.filter((quote) => quote.lines.length)
  const [quoteId, setQuoteId] = useState(billable.find((quote) => quote.stage === 'FULFILLMENT')?.id || billable[0]?.id)
  const [invoiceStatus, setInvoiceStatus] = useState('PAYMENT_DUE')
  const [subscriptionDelta, setSubscriptionDelta] = useState(0)
  const [subscriptionState, setSubscriptionState] = useState('ACTIVE')
  const quote = billable.find((item) => item.id === quoteId)
  const calculation = calculateQuote(quote)
  const oneTime = calculation.lines.filter((line) => !line.product.recurring)
  const recurring = calculation.lines.filter((line) => line.product.recurring)
  const schedule = getRecurringSchedule(quote)
  const oneTimeTotal = oneTime.reduce((sum, line) => sum + line.net, 0)
  const recurringTotal = recurring.reduce((sum, line) => sum + line.net, 0)
  const dailyProration = recurringTotal / 30
  const proration = dailyProration * 17 * subscriptionDelta

  function recordPayment() {
    setInvoiceStatus('PAID')
    toast.success('Payment recorded', { description: `${formatMoney(oneTimeTotal)} reconciled against INV-2026-0184.` })
  }

  function applySubscriptionChange() {
    if (!subscriptionDelta) return
    toast.success('Subscription change scheduled', {
      description: `${subscriptionDelta > 0 ? 'Charge' : 'Credit note'} of ${formatMoney(Math.abs(proration))} calculated for 17 remaining days.`,
    })
    setSubscriptionDelta(0)
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Finance operations"
        title="Subscriptions & billing"
        description="Reconcile one-time invoices and recurring schedules on the same commercial order."
        actions={
          <label className="header-select">
            <span>Order</span>
            <select value={quoteId} onChange={(event) => { setQuoteId(event.target.value); setInvoiceStatus('PAYMENT_DUE') }}>
              {billable.map((item) => <option value={item.id} key={item.id}>{item.id} · {item.customer.name}</option>)}
            </select>
          </label>
        }
      />

      <section className="billing-hero">
        <div><span className="page-eyebrow">Hybrid order</span><h2>{quote.customer.name}</h2><p>{quote.id} · {quote.customer.tier} terms · {formatMoney(calculation.total)} combined value</p></div>
        <div><span><small>One-time</small><strong>{formatMoney(oneTimeTotal)}</strong></span><i /><span><small>Recurring / cycle</small><strong>{formatMoney(recurringTotal)}</strong></span></div>
      </section>

      <div className="billing-layout">
        <div className="billing-main">
          <Panel title="One-time invoice" description="Hardware and services are invoiced once after fulfillment." action={<StatusBadge status={invoiceStatus === 'PAID' ? 'CONFIRMED' : 'PENDING_APPROVAL'} label={invoiceStatus === 'PAID' ? 'Paid' : 'Payment due'} />}>
            <div className="invoice-header"><span><ReceiptIndianRupee size={20} /><span><strong>INV-2026-0184</strong><small>Issued 5 Sep · Due 12 Sep 2026</small></span></span><strong>{formatMoney(oneTimeTotal)}</strong></div>
            <div className="billing-lines">
              {oneTime.map((line) => <div key={line.id}><span><strong>{line.product.name}</strong><small>{line.quantity} × {formatMoney(line.product.price)} · {line.discount.toFixed(1)}% discount</small></span><strong>{formatMoney(line.net)}</strong></div>)}
              {!oneTime.length && <p className="empty-copy">No one-time items on this order.</p>}
            </div>
            <footer className="invoice-footer"><span><small>Tax calculated at invoice posting</small><strong>Net payable {formatMoney(oneTimeTotal)}</strong></span><button className={`button ${invoiceStatus === 'PAID' ? 'button--success' : 'button--primary'}`} type="button" onClick={recordPayment} disabled={invoiceStatus === 'PAID'}>{invoiceStatus === 'PAID' ? <><Check size={15} /> Payment reconciled</> : <><CreditCard size={15} /> Record payment</>}</button></footer>
          </Panel>

          <Panel title="Recurring subscriptions" description="Recurring lines have their own schedules, proration and cancellation policy.">
            <div className="subscription-list">
              {recurring.map((line) => (
                <article className="subscription-card" key={line.id}>
                  <span className="subscription-card__icon"><RefreshCw size={18} /></span>
                  <div><span><strong>{line.product.name}</strong><StatusBadge status={subscriptionState === 'ACTIVE' ? 'APPROVED' : 'REVISION'} label={subscriptionState === 'ACTIVE' ? 'Active' : 'Cancellation pending'} /></span><p>{line.quantity} seats · {line.product.plan} cadence · Daily proration</p><small>Next renewal 5 Oct 2026</small></div>
                  <strong>{formatMoney(line.net)}<small> / cycle</small></strong>
                </article>
              ))}
              {!recurring.length && <p className="empty-copy">No recurring items on this order.</p>}
            </div>
          </Panel>

          <Panel title="Upcoming billing schedule" description="One order, independently traceable billing events.">
            <div className="billing-schedule">
              {schedule.map((item, index) => (
                <article key={item.id}>
                  <span>{index === 0 ? <BadgeIndianRupee size={16} /> : <CalendarClock size={16} />}</span>
                  <div><strong>{item.date}</strong><small>{index === 0 ? 'Current recurring invoice' : `Cycle ${index + 1} scheduled`}</small></div>
                  <strong>{formatMoney(item.amount)}</strong>
                  <StatusBadge status={index === 0 ? 'PENDING_APPROVAL' : 'DRAFT'} label={item.status.toLowerCase()} />
                </article>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="billing-aside">
          <Panel title="Mid-cycle change" description="Preview the charge or credit before changing quantity.">
            <label className="quantity-change"><span>Seat change</span><span><button type="button" onClick={() => setSubscriptionDelta((value) => value - 1)}>−</button><strong>{subscriptionDelta > 0 ? `+${subscriptionDelta}` : subscriptionDelta}</strong><button type="button" onClick={() => setSubscriptionDelta((value) => value + 1)}>+</button></span></label>
            <dl className="proration-summary">
              <div><dt>Days remaining</dt><dd>17 / 30</dd></div>
              <div><dt>Daily rate</dt><dd>{formatMoney(dailyProration)}</dd></div>
              <div><dt>{proration < 0 ? 'Credit note' : 'Prorated charge'}</dt><dd className={proration < 0 ? 'text-success' : ''}>{formatMoney(Math.abs(proration))}</dd></div>
            </dl>
            <button className="button button--primary button--full" type="button" onClick={applySubscriptionChange} disabled={!subscriptionDelta}>Apply quantity change</button>
          </Panel>

          <Panel title="Subscription controls" description="Policy consequences are generated automatically.">
            <button className="control-action" type="button" onClick={() => toast.info('Plan change preview opened')}><RotateCcw size={16} /><span><strong>Modify plan</strong><small>Recalculate the next schedule</small></span></button>
            <button className="control-action control-action--danger" type="button" onClick={() => { setSubscriptionState('CANCELLATION_PENDING'); toast.warning('Credit note review created') }}><FileMinus2 size={16} /><span><strong>Cancel subscription</strong><small>Trigger partial refund policy</small></span></button>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
