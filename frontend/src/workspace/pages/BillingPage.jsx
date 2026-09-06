import {
  BadgeIndianRupee,
  CheckCircle2,
  Download,
  FileText,
  ReceiptIndianRupee,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { quoteApi } from '../../api/quoteApi.js'
import { calculateQuote, formatMoney } from '../dealMath.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, Panel, StatusBadge } from '../components/Ui.jsx'

function formatDate(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function referencedId(value) {
  if (value && typeof value === 'object') {
    return String(value._id ?? value.id ?? '')
  }
  return value ? String(value) : ''
}

const emptyInvoiceState = {
  quoteId: '',
  invoice: null,
  quoteDetails: null,
  error: null,
}

export default function BillingPage() {
  const { quotes, quotesLoading, quotesError } = useWorkspace()
  const billable = useMemo(
    () => quotes.filter(
      (quote) =>
        quote.stage === 'COMPLETED' &&
        quote.lines.some((line) => line.product.recurring),
    ),
    [quotes],
  )
  const [selectedQuoteId, setSelectedQuoteId] = useState('')
  const [invoiceState, setInvoiceState] = useState(emptyInvoiceState)
  const quoteId = billable.some((quote) => quote.id === selectedQuoteId)
    ? selectedQuoteId
    : billable[0]?.id ?? ''

  useEffect(() => {
    if (!quoteId) {
      return undefined
    }

    let active = true
    Promise.all([
      quoteApi.getInvoice(quoteId),
      quoteApi.get(quoteId),
    ])
      .then(([invoiceResult, quoteResult]) => {
        if (!active) return
        setInvoiceState({
          quoteId,
          invoice: invoiceResult.invoice,
          quoteDetails: quoteResult.quote,
          error: null,
        })
      })
      .catch((error) => {
        if (!active) return
        setInvoiceState({
          quoteId,
          invoice: null,
          quoteDetails: null,
          error,
        })
      })

    return () => {
      active = false
    }
  }, [quoteId])

  const quote = billable.find((item) => item.id === quoteId)
  const calculation = quote ? calculateQuote(quote) : null
  const recurringLines = calculation?.lines.filter((line) => line.product.recurring) ?? []
  const oneTimeLines = calculation?.lines.filter((line) => !line.product.recurring) ?? []
  const currentInvoiceState = invoiceState.quoteId === quoteId
    ? invoiceState
    : emptyInvoiceState
  const invoiceLoading = Boolean(quoteId) && invoiceState.quoteId !== quoteId
  const subscriptionRecords = currentInvoiceState.quoteDetails?.subscription_details ?? []
  const invoice = currentInvoiceState.invoice
  const pdfUrl = invoice?.data
    ? `data:${invoice.content_type || 'application/pdf'};base64,${invoice.data}`
    : ''

  function subscriptionFor(line) {
    return subscriptionRecords.find(
      (subscription) => referencedId(subscription.article_id) === line.product.articleId,
    )
  }

  function downloadInvoice() {
    if (!pdfUrl || !invoice) return
    const link = document.createElement('a')
    link.href = pdfUrl
    link.download = `${invoice.invoice_number.replaceAll('/', '-')}.pdf`
    document.body.append(link)
    link.click()
    link.remove()
  }

  if (quotesLoading) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Finance operations" title="Billing & invoices" />
        <div className="workspace-loading workspace-loading--panel"><span /></div>
      </div>
    )
  }

  if (quotesError) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Finance operations" title="Billing & invoices" />
        <Panel className="billing-empty-state">
          <FileText size={28} />
          <h2>Billing data could not be loaded</h2>
          <p>{quotesError.message}</p>
        </Panel>
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Finance operations"
          title="Billing & invoices"
          description="Invoices appear here after a subscription quotation is completed."
        />
        <Panel className="billing-empty-state">
          <ReceiptIndianRupee size={28} />
          <h2>No completed subscription invoices yet</h2>
          <p>Add a subscription to a quotation and complete the customer confirmation. The generated invoice will then appear here.</p>
          <div className="billing-lifecycle" aria-label="Invoice lifecycle">
            <span>Subscription added</span><i /><span>Quote completed</span><i /><span>Invoice available</span>
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Finance operations"
        title="Billing & invoices"
        description="Review completed subscription orders and download their generated tax invoices."
        actions={
          <label className="header-select">
            <span>Completed order</span>
            <select value={quoteId} onChange={(event) => setSelectedQuoteId(event.target.value)}>
              {billable.map((item) => (
                <option value={item.id} key={item.id}>{item.id} · {item.customer.name}</option>
              ))}
            </select>
          </label>
        }
      />

      <section className="billing-hero">
        <div>
          <span className="page-eyebrow">Completed subscription order</span>
          <h2>{quote.customer.name}</h2>
          <p>{quote.id} · {quote.customer.tier} tier · {recurringLines.length} subscription item{recurringLines.length === 1 ? '' : 's'}</p>
        </div>
        <div>
          <span><small>Quotation value</small><strong>{formatMoney(calculation.total)}</strong></span>
          <i />
          <span><small>Invoice total</small><strong>{invoice ? formatMoney(invoice.final_amt) : 'Loading…'}</strong></span>
        </div>
      </section>

      {currentInvoiceState.error && (
        <div className="billing-inline-error" role="alert">
          <FileText size={18} />
          <span><strong>Invoice unavailable</strong><small>{currentInvoiceState.error.message}</small></span>
        </div>
      )}

      <div className="billing-layout">
        <div className="billing-main">
          <Panel
            title="Tax invoice"
            description="The final PDF generated for this completed quotation."
            action={<StatusBadge status="APPROVED" label="Generated" />}
          >
            {invoiceLoading ? (
              <div className="workspace-loading workspace-loading--panel"><span /></div>
            ) : invoice ? (
              <>
                <div className="invoice-header">
                  <span>
                    <ReceiptIndianRupee size={20} />
                    <span>
                      <strong>{invoice.invoice_number}</strong>
                      <small>Issued {formatDate(invoice.created_at)} · Quote {invoice.quote_id}</small>
                    </span>
                  </span>
                  <span className="invoice-header__amount">
                    <small>Invoice total</small>
                    <strong>{formatMoney(invoice.final_amt)}</strong>
                  </span>
                </div>
                <iframe className="invoice-preview" src={pdfUrl} title={`Invoice ${invoice.invoice_number}`} />
                <footer className="invoice-footer">
                  <span><small>Stored invoice document</small><strong>PDF · Ready to download</strong></span>
                  <button className="button button--primary" type="button" onClick={downloadInvoice}>
                    <Download size={15} /> Download PDF
                  </button>
                </footer>
              </>
            ) : (
              <p className="empty-copy">No invoice document is available for this quotation.</p>
            )}
          </Panel>

          <Panel
            title="Activated subscriptions"
            description="Subscription records created when the approved quote entered negotiation."
          >
            <div className="subscription-list">
              {recurringLines.map((line) => {
                const subscription = subscriptionFor(line)
                return (
                  <article className="subscription-card" key={line.id}>
                    <span className="subscription-card__icon"><RefreshCw size={18} /></span>
                    <div>
                      <span>
                        <strong>{line.product.name}</strong>
                        <StatusBadge
                          status={subscription?.status === 'ACTIVE' ? 'APPROVED' : 'DRAFT'}
                          label={subscription?.status ?? 'Record pending'}
                        />
                      </span>
                      <p>{line.quantity} unit{line.quantity === 1 ? '' : 's'} · HSN {subscription?.hsn ?? line.product.sku}</p>
                      <small>{subscription ? `Activated ${formatDate(subscription.createdAt)}` : 'Subscription details are not available'}</small>
                    </div>
                    <strong>{formatMoney(subscription?.selling_price ?? line.net)}<small> subscription charge</small></strong>
                  </article>
                )
              })}
            </div>
          </Panel>

          {oneTimeLines.length > 0 && (
            <Panel title="Quotation items" description="One-time products included in the same completed commercial order.">
              <div className="billing-lines">
                {oneTimeLines.map((line) => (
                  <div key={line.id}>
                    <span>
                      <strong>{line.product.name}</strong>
                      <small>{line.quantity} × {formatMoney(line.product.price)} · {line.discount.toFixed(1)}% effective discount</small>
                    </span>
                    <strong>{formatMoney(line.net)}</strong>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        <aside className="billing-aside">
          <Panel title="Order summary" description="The persisted amounts associated with this invoice.">
            <dl className="billing-summary-list">
              <div><dt>Quote status</dt><dd><CheckCircle2 size={14} /> Completed</dd></div>
              <div><dt>Subscription records</dt><dd>{subscriptionRecords.length}</dd></div>
              <div><dt>Quote value</dt><dd>{formatMoney(calculation.total)}</dd></div>
              <div><dt>Final invoiced amount</dt><dd>{invoice ? formatMoney(invoice.final_amt) : '—'}</dd></div>
            </dl>
          </Panel>

          <Panel title="Billing lifecycle" description="Every state shown here comes from the live quote workflow.">
            <div className="billing-event-list">
              <span><BadgeIndianRupee size={16} /><span><strong>Subscriptions created</strong><small>{subscriptionRecords.length} active record{subscriptionRecords.length === 1 ? '' : 's'}</small></span></span>
              <span><CheckCircle2 size={16} /><span><strong>Customer confirmed</strong><small>Quotation status is completed</small></span></span>
              <span><FileText size={16} /><span><strong>Invoice generated</strong><small>{invoice?.invoice_number ?? 'Loading document…'}</small></span></span>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
