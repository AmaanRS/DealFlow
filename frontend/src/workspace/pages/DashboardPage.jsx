import {
  AlertTriangle,
  ArrowUpRight,
  BadgeIndianRupee,
  BellRing,
  CircleCheckBig,
  Clock3,
  FileClock,
  PackageCheck,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { USER_ROLES } from '../../contracts/auth.js'
import { calculateQuote, formatMoney } from '../dealMath.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, Panel, StatCard } from '../components/Ui.jsx'

export default function DashboardPage() {
  const { quotes, user, createQuote } = useWorkspace()
  const navigate = useNavigate()
  const savedQuotes = quotes.filter((quote) => !quote.isUnsaved)
  const isSalesRep = user.role === USER_ROLES.SALES_REP
  const isManager = user.role === USER_ROLES.MANAGER
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

  function newQuote() {
    navigate(`/quotations/${createQuote()}`)
  }

  function triggerAlertAction(quote, action) {
    toast.success(`${action} sent for ${quote.id}`, {
      description: `${quote.customer.name} was added to the follow-up queue.`,
    })
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={isManager ? 'Deal health' : 'Sales workspace'}
        title={`Welcome, ${user.fullName.split(' ')[0]}.`}
        description={isManager
            ? 'Review commercial risk, stalled deals and decisions that need your attention.'
            : 'Build quotations and follow each deal through approval and fulfillment.'}
        actions={isSalesRep ? (
          <button type="button" className="button button--primary" onClick={newQuote}>
            <Plus size={16} /> New quotation
          </button>
        ) : null}
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
          title={isManager ? 'Approval queue' : 'Recent quotations'}
          description={isManager
            ? 'Deals currently waiting for your pricing decision.'
            : 'Your latest deals and their next required step.'}
          action={
            <button className="link-button" type="button" onClick={() => navigate(isManager ? '/approvals' : '/quotations')}>
              View all <ArrowUpRight size={14} />
            </button>
          }
        >
          <div className="compact-list">
            {(isManager ? pending : savedQuotes.slice(0, 4)).map((quote) => {
              const calculation = calculateQuote(quote)
              return (
                <button
                  className="compact-row"
                  type="button"
                  key={quote.id}
                  onClick={() => navigate(isManager ? `/approvals/${quote.id}` : `/quotations/${quote.id}`)}
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
            {!(isManager ? pending : savedQuotes).length && <p className="empty-copy">Nothing needs attention.</p>}
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
          <button className="button button--secondary button--full" type="button" onClick={() => navigate(isManager ? '/approvals' : '/quotations')}>
            {isManager ? 'Open approval queue' : 'Open the quotation board'}
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
                    onClick={() => navigate(isManager ? `/approvals/${quote.id}` : `/quotations/${quote.id}`)}
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
                    onClick={() => triggerAlertAction(quote, stalledDeal && !isManager ? 'Nudge' : 'Escalation')}
                  >
                    <Send size={13} /> {stalledDeal && !isManager ? 'Nudge' : 'Escalate'}
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
