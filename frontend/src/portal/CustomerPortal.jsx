import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  MessageSquareText,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast, Toaster } from 'sonner'
import { portalApi } from '../api/authApi.js'
import { calculateQuote, formatMoney } from '../workspace/dealMath.js'
import { initialQuotes } from '../workspace/seed.js'
import './CustomerPortal.css'

function PortalBrand() {
  return (
    <span className="portal-brand" aria-label="DealFlow customer quotations">
      <span className="portal-brand__mark" aria-hidden="true"><i /><i /></span>
      <span><strong>DealFlow</strong><small>Customer quotations</small></span>
    </span>
  )
}

function MagicLinkRequired({ error }) {
  return (
    <main className="portal-page portal-page--gate">
      <section className="portal-gate">
        <PortalBrand />
        <span className="portal-gate__icon"><LockKeyhole size={25} /></span>
        <span className="portal-eyebrow">Restricted quotation access</span>
        <h1>Open the secure link in your quotation email.</h1>
        <p>This portal has no public sign-in form. Your personal link identifies the quotation you are allowed to review and expires automatically.</p>
        {error && <div className="portal-error"><AlertTriangle size={15} /> {error}</div>}
        <div className="portal-security-note"><ShieldCheck size={17} /><span><strong>Your access stays quotation-specific.</strong><small>Contact your sales representative if you need a fresh link.</small></span></div>
      </section>
    </main>
  )
}

function CustomerQuotation({ session, onLogout }) {
  const quote = useMemo(
    () => initialQuotes.find((item) => item.customer.email === session.customer.email) ?? initialQuotes[0],
    [session.customer.email],
  )
  const calculation = useMemo(() => calculateQuote(quote), [quote])
  const [status, setStatus] = useState('SENT')
  const [counterDiscount, setCounterDiscount] = useState('')
  const [changeRequest, setChangeRequest] = useState('')
  const [comments, setComments] = useState({})
  const [submitted, setSubmitted] = useState(false)

  function submitRequest() {
    const hasLineComment = Object.values(comments).some((value) => value.trim())
    if (!hasLineComment && !changeRequest.trim() && !counterDiscount) {
      toast.error('Add a comment, change request or counter discount first')
      return
    }
    setStatus('NEGOTIATION')
    setSubmitted(true)
    toast.success('Your request was sent to the sales team', {
      description: Number(counterDiscount) > 15
        ? 'The new discount crosses policy limits and has re-entered approval automatically.'
        : 'The quotation is now under negotiation.',
    })
  }

  function confirmQuotation() {
    setStatus('CONFIRMED')
    toast.success('Quotation confirmed', { description: 'The order can now proceed to fulfillment and billing.' })
  }

  const statusLabel = status === 'CONFIRMED' ? 'Confirmed' : status === 'NEGOTIATION' ? 'Under negotiation' : 'Sent'

  return (
    <main className="customer-workspace">
      <header className="customer-topbar">
        <PortalBrand />
        <div className="customer-topbar__secure"><LockKeyhole size={14} /> Secure customer view</div>
        <button type="button" onClick={onLogout}>Close session</button>
      </header>

      <div className="customer-content">
        <section className="customer-hero">
          <div>
            <span className="portal-eyebrow">Quotation {session.quotation.reference}</span>
            <h1>Your commercial proposal from DealFlow.</h1>
            <p>Review every line, ask questions or confirm the final terms without returning to email.</p>
          </div>
          <span className={`customer-status customer-status--${status.toLowerCase()}`}>
            {status === 'CONFIRMED' ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
            {statusLabel}
          </span>
        </section>

        {submitted && (
          <section className="customer-result-banner">
            <Check size={17} />
            <div><strong>Negotiation request submitted.</strong><span>{Number(counterDiscount) > 15 ? 'The proposed terms require fresh manager approval.' : 'Your sales representative has been notified.'}</span></div>
          </section>
        )}

        <div className="customer-layout">
          <div className="customer-main">
            <section className="customer-card">
              <header><div><span className="portal-eyebrow">Quotation lines</span><h2>Products and services</h2></div><span>{calculation.lines.length} lines</span></header>
              <div className="customer-lines">
                {calculation.lines.map((line) => (
                  <article key={line.id}>
                    <div className="customer-line__top">
                      <span><strong>{line.product.name}</strong><small>{line.product.category} · Qty {line.quantity} · {line.product.unit}</small></span>
                      <span><strong>{formatMoney(line.net)}</strong><small>{line.discount.toFixed(1)}% discount</small></span>
                    </div>
                    <label><MessageSquareText size={15} /><input value={comments[line.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [line.id]: event.target.value }))} placeholder="Ask a line-level question or request a change" disabled={status === 'CONFIRMED'} /></label>
                  </article>
                ))}
              </div>
            </section>

            <section className="customer-card customer-negotiation-card">
              <header><div><span className="portal-eyebrow">Negotiation</span><h2>Request revised terms</h2></div></header>
              <div className="customer-negotiation-grid">
                <label><span>Overall change request</span><textarea rows="4" value={changeRequest} onChange={(event) => setChangeRequest(event.target.value)} placeholder="For example: move delivery to 18 September and include installation…" disabled={status === 'CONFIRMED'} /></label>
                <label><span>Counter discount proposal</span><span className="counter-input"><input type="number" min="0" max="50" value={counterDiscount} onChange={(event) => setCounterDiscount(event.target.value)} placeholder="0" disabled={status === 'CONFIRMED'} /><b>%</b></span><small>A higher proposal may automatically trigger a new approval.</small></label>
              </div>
            </section>
          </div>

          <aside className="customer-summary">
            <section className="customer-card">
              <span className="portal-eyebrow">Summary</span>
              <h2>{session.customer.name}</h2>
              <dl>
                <div><dt>Subtotal</dt><dd>{formatMoney(calculation.gross)}</dd></div>
                <div><dt>Discount</dt><dd>− {formatMoney(calculation.discountValue)}</dd></div>
                <div><dt>Tax</dt><dd>Calculated on invoice</dd></div>
                <div className="customer-total"><dt>Quotation total</dt><dd>{formatMoney(calculation.total)}</dd></div>
              </dl>
              <div className="customer-validity"><Clock3 size={15} /><span><strong>Valid until {quote.validUntil}</strong><small>Prices and stock are live until this date.</small></span></div>
              <button className="customer-primary" type="button" onClick={submitRequest} disabled={status === 'CONFIRMED'}><Send size={15} /> Submit request</button>
              <button className="customer-confirm" type="button" onClick={confirmQuotation} disabled={status === 'CONFIRMED'}><CheckCircle2 size={15} /> {status === 'CONFIRMED' ? 'Quotation confirmed' : 'Confirm quotation'}</button>
              <p className="portal-help">Confirmation records the final terms in the audit trail.</p>
            </section>
          </aside>
        </div>
      </div>
      <Toaster position="top-right" theme="dark" richColors />
    </main>
  )
}

export default function CustomerPortal() {
  const [session, setSession] = useState(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const linkToken = new URLSearchParams(window.location.hash.slice(1)).get('token')

    async function restoreAccess() {
      try {
        const result = linkToken
          ? await portalApi.exchangeAccessToken(linkToken)
          : await portalApi.getSession()
        if (mounted && result.authenticated) setSession(result)
      } catch (requestError) {
        if (mounted) setError(requestError.message ?? 'This quotation link is invalid or expired.')
      } finally {
        if (linkToken) window.history.replaceState({}, '', '/portal')
        if (mounted) setChecking(false)
      }
    }

    restoreAccess()
    return () => { mounted = false }
  }, [])

  async function closeSession() {
    await portalApi.logout()
    setSession(null)
    setError('This secure session has been closed.')
  }

  if (checking) {
    return <main className="portal-page portal-page--gate"><section className="portal-gate"><PortalBrand /><div className="portal-loading"><span /> Opening your secure quotation…</div></section></main>
  }

  return session ? <CustomerQuotation session={session} onLogout={closeSession} /> : <MagicLinkRequired error={error} />
}

