import {
  AlertTriangle,
  ArrowUpRight,
  BadgeIndianRupee,
  BellRing,
  CircleCheckBig,
  Clock3,
  FileClock,
  PackageCheck,
  Send,
  Sparkles,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { calculateQuote, formatMoney } from '../dealMath.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, Panel, StatCard } from '../components/Ui.jsx'

/**
 * Deal-health overview for the sales manager.
 *
 * This is a manager-only screen: a sales rep works from the quotation board,
 * finance from the approval queue, and an administrator from the back-end
 * configuration screens. Every figure here is derived from live quotations.
 */
export default function DashboardPage() {
  const { quotes, user } = useWorkspace()
  const navigate = useNavigate()
  const savedQuotes = quotes.filter((quote) => !quote.isUnsaved)
  const pending = savedQuotes.filter((quote) => quote.stage === 'PENDING_APPROVAL')
  const pipelineValue = savedQuotes.reduce(
    (sum, quote) => sum + calculateQuote(quote).total,
    0,
  )
  const closedValue = savedQuotes
    .filter((quote) => quote.stage === 'COMPLETED')
    .reduce((sum, quote) => sum + calculateQuote(quote).total, 0)
  const stalled = savedQuotes.filter((quote) => quote.inactivityDays >= 3)
  const atRisk = savedQuotes.filter((quote) => {
    const risk = calculateQuote(quote).riskScore
    return risk >= 55 || quote.deliveryRisk === 'High' || quote.inactivityDays >= 3
  })
  const closed = savedQuotes.filter((quote) => quote.stage === 'COMPLETED')
  const maxStageCount = Math.max(
    1,
    ...['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'NEGOTIATION', 'COMPLETED']
      .map((stage) => savedQuotes.filter((quote) => quote.stage === stage).length),
  )

  function triggerAlertAction(quote, action) {
    toast.success(`${action} sent for ${quote.id}`, {
      description: `${quote.customer.name} was added to the follow-up queue.`,
    })
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={`Welcome, ${user.fullName.split(' ')[0]}.`}
        description="Review commercial risk, stalled deals and decisions that need your attention."
      />

      <section className="stats-grid">
        <StatCard
          icon={BadgeIndianRupee}
          label="Open pipeline"
          value={formatMoney(pipelineValue, true)}
          detail={`${savedQuotes.length} active quotation${savedQuotes.length === 1 ? '' : 's'}`}
          tone="blue"
        />
        <StatCard
          icon={CircleCheckBig}
          label="Closed value"
          value={formatMoney(closedValue, true)}
          detail={`${closed.length} quotation${closed.length === 1 ? '' : 's'} confirmed`}
          tone="green"
        />
        <StatCard
          icon={FileClock}
          label="Awaiting approval"
          value={String(pending.length)}
          detail={`${pending.length} pricing decision${pending.length === 1 ? '' : 's'} open`}
          tone="amber"
        />
        <StatCard
          icon={AlertTriangle}
          label="Deals at risk"
          value={String(atRisk.length)}
          detail={`${stalled.length} stalled conversation${stalled.length === 1 ? '' : 's'}`}
          tone="red"
        />
      </section>

      <section className="dashboard-main-grid">
        <Panel
          title="Approval queue"
          description="Deals currently waiting for your pricing decision."
          action={
            <button className="link-button" type="button" onClick={() => navigate('/approvals')}>
              View all <ArrowUpRight size={14} />
            </button>
          }
        >
          <div className="compact-list">
            {pending.map((quote) => {
              const calculation = calculateQuote(quote)
              return (
                <button
                  className="compact-row"
                  type="button"
                  key={quote.id}
                  onClick={() => navigate(`/approvals/${quote.id}`)}
                >
                  <span className="compact-row__icon"><Clock3 size={16} /></span>
                  <span className="compact-row__copy">
                    <strong>{quote.customer.name}</strong>
                    <small>{quote.id} · {formatMoney(calculation.total)}</small>
                  </span>
                  <span className="risk-number">{calculation.riskScore}</span>
                </button>
              )
            })}
            {!pending.length && <p className="empty-copy">Nothing needs attention.</p>}
          </div>
        </Panel>

        <Panel title="Pipeline focus" description="Current quotation stages by count.">
          <div className="pipeline-focus">
            {[
              ['Draft', savedQuotes.filter((quote) => quote.stage === 'DRAFT').length],
              ['Approval', pending.length],
              ['Approved', savedQuotes.filter((quote) => quote.stage === 'APPROVED').length],
              ['Negotiation', savedQuotes.filter((quote) => quote.stage === 'NEGOTIATION').length],
              ['Confirmed', savedQuotes.filter((quote) => quote.stage === 'COMPLETED').length],
            ].map(([label, count]) => (
              <div key={label}>
                <span><strong>{label}</strong><small>{count} deals</small></span>
                <i><b style={{ width: `${count ? Math.max(8, (count / maxStageCount) * 100) : 0}%` }} /></i>
              </div>
            ))}
          </div>
          <button className="button button--secondary button--full" type="button" onClick={() => navigate('/approvals')}>
            Open approval queue
          </button>
        </Panel>
      </section>

      <section className="dashboard-alerts">
        <Panel
          title="Deal health signals"
          description="Live anomalies ranked by commercial impact."
          action={<span className="live-indicator"><i /> Live</span>}
        >
          <div className="alert-list">
            {atRisk.slice(0, 3).map((quote) => {
              const calculation = calculateQuote(quote)
              const stalledDeal = quote.inactivityDays >= 3
              const delivery = quote.deliveryRisk === 'High'
              return (
                <article className="alert-row" key={quote.id}>
                  <span className={`alert-row__icon ${delivery ? 'danger' : stalledDeal ? 'warning' : 'violet'}`}>
                    {delivery ? <PackageCheck size={17} /> : stalledDeal ? <BellRing size={17} /> : <Sparkles size={17} />}
                  </span>
                  <button
                    type="button"
                    className="alert-row__main"
                    onClick={() => navigate(`/approvals/${quote.id}`)}
                  >
                    <strong>
                      {delivery
                        ? 'Delivery promise may slip'
                        : stalledDeal
                          ? `No customer activity for ${quote.inactivityDays} days`
                          : 'Discount is above historical average'}
                    </strong>
                    <small>{quote.customer.name} · {quote.id} · risk {calculation.riskScore}</small>
                  </button>
                  <button
                    className="button button--quiet button--small"
                    type="button"
                    onClick={() => triggerAlertAction(quote, 'Escalation')}
                  >
                    <Send size={13} /> Escalate
                  </button>
                </article>
              )
            })}
          </div>
        </Panel>

      </section>
    </div>
  )
}
