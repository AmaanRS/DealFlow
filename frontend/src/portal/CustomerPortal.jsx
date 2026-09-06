import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  History,
  Inbox,
  LockKeyhole,
  LogOut,
  Mail,
  MessageSquareText,
  Moon,
  RefreshCw,
  Send,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast, Toaster } from 'sonner'
import { portalApi } from '../api/authApi.js'
import { formatMoney, formatPercentage } from '../workspace/dealMath.js'
import './CustomerPortal.css'

function PortalBrand() {
  return (
    <span className="portal-brand" aria-label="DealFlow customer quotations">
      <span className="portal-brand__mark" aria-hidden="true"><i /><i /></span>
      <span><strong>DealFlow</strong><small>Customer quotations</small></span>
    </span>
  )
}

function PortalThemeToggle({ theme, onToggle }) {
  const dark = theme === 'dark'
  return (
    <button
      className="portal-theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
      <span>{dark ? 'Light' : 'Dark'}</span>
    </button>
  )
}

function MagicLinkRequired({ error, theme, onThemeToggle }) {
  return (
    <main className="portal-page portal-page--gate">
      <PortalThemeToggle theme={theme} onToggle={onThemeToggle} />
      <section className="portal-gate">
        <PortalBrand />
        <span className="portal-gate__icon"><LockKeyhole size={25} /></span>
        <span className="portal-eyebrow">Restricted quotation access</span>
        <h1>Open the secure link in your quotation email.</h1>
        <p>Your personal link identifies your customer account and opens only the quotations assigned to your email. The link expires automatically.</p>
        {error && <div className="portal-error"><AlertTriangle size={15} /> {error}</div>}
        <div className="portal-security-note"><ShieldCheck size={17} /><span><strong>Your quotations stay private.</strong><small>Contact your sales representative if you need a fresh link.</small></span></div>
      </section>
    </main>
  )
}

function formatPortalDate(value, options = {}) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  }).format(date)
}

function statusPresentation(status) {
  if (status === 'COMPLETED') {
    return { label: 'Confirmed', tone: 'confirmed', description: 'Accepted by customer' }
  }
  if (status === 'NEGOTIATION') {
    return { label: 'Under negotiation', tone: 'negotiation', description: 'Sales review in progress' }
  }
  return { label: 'Sent for review', tone: 'sent', description: 'Waiting for your response' }
}

function CustomerQuotation({ session, onLogout, theme, onThemeToggle }) {
  const [quotations, setQuotations] = useState([])
  const [quotation, setQuotation] = useState(null)
  const [history, setHistory] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [counterDiscount, setCounterDiscount] = useState('')
  const [changeRequest, setChangeRequest] = useState('')
  const [comments, setComments] = useState({})
  const [saving, setSaving] = useState('')

  async function loadSelectedQuotation(quotationId, { showLoader = true } = {}) {
    if (!quotationId) return
    if (showLoader) setDetailLoading(true)
    setLoadError('')
    try {
      const [quotationResult, historyResult] = await Promise.all([
        portalApi.getQuotation(quotationId),
        portalApi.getQuotationHistory(quotationId),
      ])
      setQuotation(quotationResult.quotation)
      setHistory(historyResult.revisions ?? [])
      setSelectedId(quotationResult.quotation.id)
    } catch (error) {
      setQuotation(null)
      setHistory([])
      setLoadError(error.message ?? 'The quotation could not be loaded.')
    } finally {
      if (showLoader) setDetailLoading(false)
    }
  }

  async function loadPortfolio(preferredId) {
    setLoading(true)
    setLoadError('')
    try {
      const result = await portalApi.listQuotations()
      const items = result.quotations ?? []
      setQuotations(items)
      if (!items.length) {
        setQuotation(null)
        setHistory([])
        setSelectedId('')
        return
      }
      const nextId = items.some((item) => item.id === preferredId)
        ? preferredId
        : items.some((item) => item.id === session.quotation?.id)
          ? session.quotation.id
          : items[0].id
      await loadSelectedQuotation(nextId, { showLoader: false })
    } catch (error) {
      setLoadError(error.message ?? 'Your quotations could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    portalApi.listQuotations()
      .then(async (result) => {
        if (!active) return
        const items = result.quotations ?? []
        setQuotations(items)
        if (!items.length) return
        const invitationId = session.quotation?.id
        const initialId = items.some((item) => item.id === invitationId)
          ? invitationId
          : items[0].id
        const [quotationResult, historyResult] = await Promise.all([
          portalApi.getQuotation(initialId),
          portalApi.getQuotationHistory(initialId),
        ])
        if (!active) return
        setQuotation(quotationResult.quotation)
        setHistory(historyResult.revisions ?? [])
        setSelectedId(quotationResult.quotation.id)
      })
      .catch((error) => {
        if (active) setLoadError(error.message ?? 'Your quotations could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [session.quotation?.id])

  const status = useMemo(
    () => statusPresentation(quotation?.status),
    [quotation?.status],
  )

  async function selectQuotation(quotationId) {
    if (quotationId === selectedId || detailLoading) return
    setComments({})
    setChangeRequest('')
    setCounterDiscount('')
    await loadSelectedQuotation(quotationId)
  }

  async function refreshAfterRevision(nextQuotation) {
    setQuotation(nextQuotation)
    setSelectedId(nextQuotation.id)
    const [listResult, historyResult] = await Promise.all([
      portalApi.listQuotations(),
      portalApi.getQuotationHistory(nextQuotation.id),
    ])
    setQuotations(listResult.quotations ?? [])
    setHistory(historyResult.revisions ?? [])
  }

  async function submitRequest() {
    const lineComments = Object.entries(comments)
      .map(([productId, comment]) => ({ productId, comment: comment.trim() }))
      .filter((comment) => comment.comment)
    if (!lineComments.length && !changeRequest.trim() && counterDiscount === '') {
      toast.error('Add a comment, change request or counter discount first')
      return
    }

    setSaving('negotiation')
    try {
      const result = await portalApi.submitNegotiation({
        quotationId: quotation.id,
        changeRequest: changeRequest.trim(),
        counterDiscount: counterDiscount === '' ? null : Number(counterDiscount),
        lineComments,
      })
      await refreshAfterRevision(result.quotation)
      setComments({})
      setChangeRequest('')
      setCounterDiscount('')
      toast.success('Your request was sent to the sales team', {
        description: `Revision ${result.quotation.revision?.version} is now your latest quotation.`,
      })
    } catch (error) {
      toast.error(error.message ?? 'Your request could not be submitted.')
      if (error.code === 'QUOTE_VERSION_CONFLICT') await loadPortfolio()
    } finally {
      setSaving('')
    }
  }

  async function confirmQuotation() {
    setSaving('confirm')
    try {
      const result = await portalApi.confirmQuotation(quotation.id)
      await refreshAfterRevision(result.quotation)
      toast.success('Quotation confirmed', {
        description: 'The accepted quotation is now recorded for fulfillment and billing.',
      })
    } catch (error) {
      toast.error(error.message ?? 'The quotation could not be confirmed.')
      if (error.code === 'QUOTE_VERSION_CONFLICT') await loadPortfolio()
    } finally {
      setSaving('')
    }
  }

  const accessLabel = session.accessMode === 'ACCOUNT'
    ? `Signed in as ${session.customer.email}`
    : 'Secure customer link'

  return (
    <main className="customer-workspace">
      <header className="customer-topbar">
        <PortalBrand />
        <div className="customer-topbar__secure"><LockKeyhole size={14} /> {accessLabel}</div>
        <div className="customer-topbar__actions">
          <PortalThemeToggle theme={theme} onToggle={onThemeToggle} />
          <button type="button" onClick={onLogout}><LogOut size={15} /> {session.accessMode === 'ACCOUNT' ? 'Log out' : 'Close session'}</button>
        </div>
      </header>

      <div className="customer-content">
        <section className="customer-portfolio-hero">
          <div>
            <span className="portal-eyebrow">Customer portal</span>
            <h1>Your quotations.</h1>
            <p>Review every current commercial proposal assigned to your account, negotiate terms, and track each revision.</p>
          </div>
          {!loading && !loadError && <span className="customer-quote-count">{quotations.length} current {quotations.length === 1 ? 'quote' : 'quotes'}</span>}
        </section>

        {loading ? (
          <section className="portal-quotation-state">
            <div className="portal-loading"><span /> Loading your quotations…</div>
          </section>
        ) : loadError && !quotation ? (
          <section className="portal-quotation-state portal-quotation-state--error">
            <AlertTriangle size={26} />
            <h2>We could not load your quotations.</h2>
            <p>{loadError}</p>
            <button type="button" onClick={() => loadPortfolio(selectedId)}><RefreshCw size={16} /> Try again</button>
          </section>
        ) : quotations.length === 0 ? (
          <section className="portal-quotation-state portal-quotation-state--empty">
            <span className="portal-empty-icon"><Inbox size={28} /></span>
            <h2>No quotations yet</h2>
            <p>There are no quotations assigned to {session.customer.email}. New proposals from your sales representative will appear here.</p>
          </section>
        ) : (
          <>
            <section className="customer-quote-list" aria-label="Your quotations">
              <header>
                <div><span className="portal-eyebrow">Current proposals</span><h2>All quotations</h2></div>
                <small>Only the latest revision of each negotiation is shown</small>
              </header>
              <div className="customer-quote-list__grid">
                {quotations.map((item) => {
                  const itemStatus = statusPresentation(item.status)
                  const selected = item.id === selectedId
                  return (
                    <button
                      className={selected ? 'customer-quote-tile is-selected' : 'customer-quote-tile'}
                      type="button"
                      key={item.id}
                      onClick={() => selectQuotation(item.id)}
                      aria-pressed={selected}
                    >
                      <span className="customer-quote-tile__top"><strong>{item.reference}</strong><span className={`customer-status customer-status--${itemStatus.tone}`}>{itemStatus.label}</span></span>
                      <span className="customer-quote-tile__total">{formatMoney(item.total)}</span>
                      <span className="customer-quote-tile__meta">Revision {item.revision?.version ?? 1} · {item.lineCount} {item.lineCount === 1 ? 'line' : 'lines'} · Updated {formatPortalDate(item.updatedAt)}</span>
                      <span className="customer-quote-tile__open">{selected ? 'Viewing latest quote' : 'Review quote'} <ArrowRight size={15} /></span>
                    </button>
                  )
                })}
              </div>
            </section>

            {detailLoading ? (
              <section className="portal-quotation-state portal-quotation-state--detail">
                <div className="portal-loading"><span /> Opening quotation…</div>
              </section>
            ) : quotation ? (
              <>
                <section className="customer-hero customer-hero--detail">
                  <div>
                    <span className="portal-eyebrow">Quotation {quotation.reference} · Revision {quotation.revision?.version ?? 1}</span>
                    <h2>Review your commercial proposal.</h2>
                    <p>This is the latest revision. Request changes line by line or confirm the current terms.</p>
                  </div>
                  <div className="customer-status-wrap">
                    <span className={`customer-status customer-status--${status.tone}`}>
                      {quotation.status === 'COMPLETED' ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
                      {status.label}
                    </span>
                    <small>{status.description}</small>
                  </div>
                </section>

                <section className="customer-facts" aria-label="Quotation overview">
                  <article><FileText size={18} /><span><small>Quotation total</small><strong>{formatMoney(quotation.pricing.total)}</strong></span></article>
                  <article><ShieldCheck size={18} /><span><small>Customer tier</small><strong>{quotation.customer.tier || 'Standard'}</strong></span></article>
                  <article><CalendarDays size={18} /><span><small>Last updated</small><strong>{formatPortalDate(quotation.updatedAt)}</strong></span></article>
                  <article><Mail size={18} /><span><small>Sales contact</small><strong>{quotation.salesContact}</strong></span></article>
                </section>

                {quotation.latestRequest && quotation.status !== 'COMPLETED' && (
                  <section className="customer-result-banner">
                    <Check size={18} />
                    <div>
                      <strong>Negotiation request submitted.</strong>
                      <span>Saved in revision {quotation.revision?.version}. Your sales representative can now review the requested changes.</span>
                    </div>
                  </section>
                )}

                <div className="customer-layout">
                  <div className="customer-main">
                    <section className="customer-card">
                      <header><div><span className="portal-eyebrow">Quotation lines</span><h2>Products and services</h2></div><span>{quotation.lines.length} lines</span></header>
                      <div className="customer-lines">
                        {quotation.lines.map((line) => (
                          <article key={line.id}>
                            <div className="customer-line__top">
                              <span><strong>{line.name}</strong><small>{line.category} · SKU/HSN {line.sku}</small></span>
                              <span className="customer-line__numbers"><small>{line.quantity} × {formatMoney(line.unitPrice)}</small><strong>{formatMoney(line.total)}</strong><small>{formatPercentage(line.discount)} rep discount · {formatPercentage(line.tax)} tax</small></span>
                            </div>
                            {quotation.capabilities.canNegotiate && (
                              <label><MessageSquareText size={16} /><input value={comments[line.id] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [line.id]: event.target.value }))} placeholder="Ask a line-level question or request a change" /></label>
                            )}
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="customer-card customer-negotiation-card">
                      <header><div><span className="portal-eyebrow">Negotiation</span><h2>Request revised terms</h2></div></header>
                      {quotation.capabilities.canNegotiate ? (
                        <div className="customer-negotiation-grid">
                          <label><span>Overall change request</span><textarea rows="4" value={changeRequest} onChange={(event) => setChangeRequest(event.target.value)} placeholder="For example: change delivery timing or include installation…" /></label>
                          <label><span>Counter discount proposal</span><span className="counter-input"><input type="number" min="0" max="100" value={counterDiscount} onChange={(event) => setCounterDiscount(event.target.value)} placeholder="0" /><b>%</b></span><small>This records a proposal. Current pricing changes only after sales review.</small></label>
                        </div>
                      ) : (
                        <div className="customer-confirmed-copy"><CheckCircle2 size={20} /><span><strong>Terms confirmed</strong><small>This quotation is now locked against further negotiation.</small></span></div>
                      )}
                    </section>

                    <section className="customer-card customer-history-card">
                      <header><div><span className="portal-eyebrow">Audit trail</span><h2>Revision history</h2></div><History size={18} /></header>
                      <div className="customer-revision-list">
                        {history.map((revision) => {
                          const revisionStatus = statusPresentation(revision.status)
                          return (
                            <article key={revision.quoteId}>
                              <span className="customer-revision-list__marker" />
                              <div><strong>Revision {revision.version}</strong><small>{formatPortalDate(revision.createdAt, { hour: 'numeric', minute: '2-digit' })}</small></div>
                              <span className={`customer-status customer-status--${revisionStatus.tone}`}>{revisionStatus.label}</span>
                              <strong>{formatMoney(revision.total)}</strong>
                              {revision.isLatest && <em>Current</em>}
                            </article>
                          )
                        })}
                      </div>
                    </section>
                  </div>

                  <aside className="customer-summary">
                    <section className="customer-card">
                      <span className="portal-eyebrow">Summary</span>
                      <h2>{quotation.customer.name || session.customer.name}</h2>
                      <p className="customer-summary-email">{quotation.customer.email}</p>
                      <dl>
                        <div><dt>Subtotal</dt><dd>{formatMoney(quotation.pricing.subtotal)}</dd></div>
                        <div><dt>Tier discount</dt><dd>{formatPercentage(quotation.pricing.tierDiscount)}</dd></div>
                        <div><dt>Order discount</dt><dd>{formatPercentage(quotation.pricing.orderDiscount)}</dd></div>
                        <div><dt>Total saving</dt><dd>− {formatMoney(quotation.pricing.discount)}</dd></div>
                        <div><dt>Tax</dt><dd>{formatMoney(quotation.pricing.tax)}</dd></div>
                        <div className="customer-total"><dt>Quotation total</dt><dd>{formatMoney(quotation.pricing.total)}</dd></div>
                      </dl>
                      <div className="customer-validity"><LockKeyhole size={16} /><span><strong>{session.accessMode === 'ACCOUNT' ? `Signed in as ${session.customer.email}` : `Secure link expires ${formatPortalDate(session.expiresAt, { hour: 'numeric', minute: '2-digit' })}`}</strong><small>Only quotations owned by this email are shown.</small></span></div>
                      {quotation.capabilities.canNegotiate && <button className="customer-primary" type="button" onClick={submitRequest} disabled={Boolean(saving)}><Send size={16} /> {saving === 'negotiation' ? 'Creating revision…' : 'Submit change request'}</button>}
                      {quotation.capabilities.canConfirm ? (
                        <button className="customer-confirm" type="button" onClick={confirmQuotation} disabled={Boolean(saving)}><CheckCircle2 size={16} /> {saving === 'confirm' ? 'Confirming…' : 'Confirm current quotation'}</button>
                      ) : (
                        <div className="customer-final-state"><CheckCircle2 size={18} /> Confirmed</div>
                      )}
                      <p className="portal-help">Every negotiation creates a new revision while older versions remain in the audit trail.</p>
                    </section>
                  </aside>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
      <Toaster position="top-right" theme={theme} richColors />
    </main>
  )
}

export default function CustomerPortal({
  theme,
  onThemeToggle,
  internalUser = null,
  onInternalLogout,
}) {
  const [session, setSession] = useState(() => internalUser ? {
    authenticated: true,
    accessMode: 'ACCOUNT',
    customer: { name: internalUser.fullName, email: internalUser.email },
    quotation: null,
    expiresAt: null,
  } : null)
  const [checking, setChecking] = useState(!internalUser)
  const [error, setError] = useState('')

  useEffect(() => {
    if (internalUser) return undefined
    let mounted = true
    const linkToken = new URLSearchParams(window.location.hash.slice(1)).get('token')

    async function restoreAccess() {
      try {
        const result = linkToken
          ? await portalApi.exchangeAccessToken(linkToken)
          : await portalApi.getSession()
        if (mounted && result.authenticated) {
          setSession({ ...result, accessMode: 'MAGIC_LINK' })
        }
      } catch (requestError) {
        if (mounted) setError(requestError.message ?? 'This quotation link is invalid or expired.')
      } finally {
        if (linkToken) window.history.replaceState({}, '', '/portal')
        if (mounted) setChecking(false)
      }
    }

    restoreAccess()
    return () => { mounted = false }
  }, [internalUser])

  async function closeSession() {
    if (internalUser) {
      await onInternalLogout?.()
      return
    }
    await portalApi.logout()
    setSession(null)
    setError('This secure session has been closed.')
  }

  if (checking) {
    return <main className="portal-page portal-page--gate"><PortalThemeToggle theme={theme} onToggle={onThemeToggle} /><section className="portal-gate"><PortalBrand /><div className="portal-loading"><span /> Opening your secure quotations…</div></section></main>
  }

  return session
    ? <CustomerQuotation session={session} onLogout={closeSession} theme={theme} onThemeToggle={onThemeToggle} />
    : <MagicLinkRequired error={error} theme={theme} onThemeToggle={onThemeToggle} />
}
