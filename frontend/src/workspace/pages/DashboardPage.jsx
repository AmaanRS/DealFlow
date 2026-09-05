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
  TrendingUp,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import { USER_ROLES } from '../../contracts/auth.js'
import { calculateQuote, formatMoney } from '../dealMath.js'
import { dashboardTrend } from '../seed.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, Panel, StatCard } from '../components/Ui.jsx'

const chartTooltipStyle = {
  background: 'var(--ws-panel)',
  border: '1px solid var(--ws-line)',
  borderRadius: 10,
  color: 'var(--ws-text)',
  fontSize: 11,
}

export default function DashboardPage() {
  const { quotes, user, createQuote } = useWorkspace()
  const navigate = useNavigate()
  const isSalesRep = user.role === USER_ROLES.SALES_REP
  const isManager = user.role === USER_ROLES.MANAGER
  const isAdmin = user.role === USER_ROLES.ADMIN
  const pending = quotes.filter((quote) => quote.stage === 'PENDING_APPROVAL')
  const pipelineValue = quotes.reduce(
    (sum, quote) => sum + calculateQuote(quote).total,
    0,
  )
  const confirmedValue = quotes
    .filter((quote) => ['CONFIRMED', 'FULFILLMENT'].includes(quote.stage))
    .reduce((sum, quote) => sum + calculateQuote(quote).total, 0)
  const stalled = quotes.filter((quote) => quote.inactivityDays >= 3)
  const atRisk = quotes.filter((quote) => {
    const risk = calculateQuote(quote).riskScore
    return risk >= 55 || quote.deliveryRisk === 'High' || quote.inactivityDays >= 3
  })
  const fulfilled = quotes.filter((quote) => ['CONFIRMED', 'FULFILLMENT'].includes(quote.stage))
  const maxStageCount = Math.max(
    1,
    ...['DRAFT', 'PENDING_APPROVAL', 'NEGOTIATION', 'FULFILLMENT']
      .map((stage) => quotes.filter((quote) => quote.stage === stage).length),
  )
  const trendPercent = dashboardTrend.length > 1
    ? ((dashboardTrend.at(-1).revenue - dashboardTrend[0].revenue) / dashboardTrend[0].revenue) * 100
    : 0

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
        eyebrow={isAdmin ? 'Platform overview' : isManager ? 'Deal health' : 'Sales workspace'}
        title={`Welcome, ${user.fullName.split(' ')[0]}.`}
        description={isAdmin
          ? 'Monitor sales performance and keep the platform configuration ready for the team.'
          : isManager
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
          detail={`${quotes.length} active quotation${quotes.length === 1 ? '' : 's'}`}
          tone="blue"
        />
        <StatCard
          icon={CircleCheckBig}
          label="Confirmed value"
          value={formatMoney(confirmedValue, true)}
          detail={`${fulfilled.length} order${fulfilled.length === 1 ? '' : 's'} confirmed or fulfilling`}
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
          title="Revenue momentum"
          description="Quoted revenue and blended margin over the last seven days."
          action={<span className="panel-chip"><TrendingUp size={14} /> {trendPercent >= 0 ? '+' : ''}{trendPercent.toFixed(1)}%</span>}
          className="dashboard-chart-panel"
        >
          <div className="chart-legend">
            <span><i className="legend-dot legend-dot--blue" /> Quoted revenue (₹k)</span>
            <span><i className="legend-dot legend-dot--green" /> Margin %</span>
          </div>
          <div className="dashboard-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dashboardTrend} margin={{ top: 10, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5d9bff" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="#5d9bff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(174,196,230,.09)" />
                <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: '#71829d', fontSize: 10 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#71829d', fontSize: 10 }} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Area type="monotone" dataKey="revenue" stroke="#6da4ff" fill="url(#revenueFill)" strokeWidth={2.2} />
                <Area type="monotone" dataKey="margin" stroke="#56d39b" fill="transparent" strokeWidth={1.8} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          title={isManager ? 'Approval queue' : isAdmin ? 'Reporting snapshot' : 'Recent quotations'}
          description={isManager
            ? 'Deals currently waiting for your pricing decision.'
            : isAdmin
              ? 'Current commercial activity available in organization reports.'
              : 'Your latest deals and their next required step.'}
          action={
            <button className="link-button" type="button" onClick={() => navigate(isManager ? '/approvals' : isAdmin ? '/reports' : '/quotations')}>
              View all <ArrowUpRight size={14} />
            </button>
          }
        >
          <div className="compact-list">
            {(isManager ? pending : quotes.slice(0, 4)).map((quote) => {
              const calculation = calculateQuote(quote)
              return (
                <button
                  className="compact-row"
                  type="button"
                  key={quote.id}
                  onClick={() => navigate(isManager ? `/approvals/${quote.id}` : isAdmin ? '/reports' : `/quotations/${quote.id}`)}
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
            {!(isManager ? pending : quotes).length && <p className="empty-copy">Nothing needs attention.</p>}
          </div>
        </Panel>
      </section>

      <section className="dashboard-bottom-grid">
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
                    onClick={() => navigate(isManager ? `/approvals/${quote.id}` : isAdmin ? '/reports' : `/quotations/${quote.id}`)}
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
                  {!isAdmin && (
                    <button
                      className="button button--quiet button--small"
                      type="button"
                      onClick={() => triggerAlertAction(quote, stalledDeal && !isManager ? 'Nudge' : 'Escalation')}
                    >
                      <Send size={13} /> {stalledDeal && !isManager ? 'Nudge' : 'Escalate'}
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        </Panel>

        <Panel title="Pipeline focus" description="Current quotation stages by count.">
          <div className="pipeline-focus">
            {[
              ['Draft', quotes.filter((quote) => quote.stage === 'DRAFT').length],
              ['Approval', pending.length],
              ['Negotiation', quotes.filter((quote) => quote.stage === 'NEGOTIATION').length],
              ['Fulfillment', quotes.filter((quote) => quote.stage === 'FULFILLMENT').length],
            ].map(([label, count]) => (
              <div key={label}>
                <span><strong>{label}</strong><small>{count} deals</small></span>
                <i><b style={{ width: `${count ? Math.max(8, (count / maxStageCount) * 100) : 0}%` }} /></i>
              </div>
            ))}
          </div>
          <button className="button button--secondary button--full" type="button" onClick={() => navigate(isAdmin ? '/reports' : isManager ? '/approvals' : '/pipeline')}>
            {isAdmin ? 'Open organization reports' : isManager ? 'Open approval queue' : 'Open Kanban pipeline'}
          </button>
        </Panel>
      </section>
    </div>
  )
}
