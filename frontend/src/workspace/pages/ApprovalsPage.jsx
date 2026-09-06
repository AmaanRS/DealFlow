import {
  AlertOctagon,
  Check,
  CheckCircle2,
  Clock3,
  FileCheck2,
  ShieldAlert,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { USER_ROLES } from '../../contracts/auth.js'
import { calculateQuote, formatMoney, formatPercentage } from '../dealMath.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, Panel, RiskGauge, StatusBadge } from '../components/Ui.jsx'

export default function ApprovalsPage() {
  const { quoteId } = useParams()
  const { quotes, reviewQuote, user } = useWorkspace()
  const reviewerRole = user.role === USER_ROLES.MANAGER ? 'Sales manager' : 'Finance'
  const approvalQuotes = quotes.filter((quote) =>
    ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(quote.stage) &&
    quote.approvalSteps.some((step) => step.role === reviewerRole),
  )
  const [selectedId, setSelectedId] = useState(quoteId || approvalQuotes[0]?.id)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const activeSelectedId = approvalQuotes.some((item) => item.id === selectedId)
    ? selectedId
    : approvalQuotes[0]?.id
  const quote = approvalQuotes.find((item) => item.id === activeSelectedId)

  async function decide(decision) {
    if (decision === 'REJECT' && reason.trim().length < 3) {
      toast.error('Add a reason before rejecting the quotation')
      return
    }
    setSaving(true)
    try {
      const result = await reviewQuote(quote.id, decision, reason.trim())
      setReason('')
      setSelectedId(result.quote.id)
      toast.success(
        decision === 'REJECT'
          ? 'Quotation rejected'
          : result.approval?.next_reviewer
            ? 'Manager approval recorded and sent to Finance'
            : 'Quotation approved',
      )
    } catch (error) {
      toast.error(error.message || 'The approval decision could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (!quote) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Pricing governance" title="Discount approvals" description="No quotation currently requires a pricing decision." />
      </div>
    )
  }

  const calculation = calculateQuote(quote)
  const activeStep = quote.approvalSteps.find((step) => step.status === 'PENDING')
  const canAct = quote.stage === 'PENDING_APPROVAL' && activeStep?.role === reviewerRole

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Pricing governance"
        title="Discount approvals"
        description="Review the blended commercial risk, approval path and complete audit history."
      />

      <div className="approval-layout">
        <Panel title="Review queue" description={`${approvalQuotes.filter((item) => item.approvalSteps.some((step) => step.role === reviewerRole && step.status === 'PENDING')).length} decisions are waiting for ${reviewerRole}.`} className="approval-queue-panel">
          <div className="approval-queue">
            {approvalQuotes.map((item) => {
              const itemCalculation = calculateQuote(item)
              return (
                <button className={activeSelectedId === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => setSelectedId(item.id)}>
                  <span><strong>{item.customer.name}</strong><small>{item.id} · {formatMoney(itemCalculation.total)}</small></span>
                  <span><StatusBadge status={item.stage} /><b>{itemCalculation.riskScore}</b></span>
                </button>
              )
            })}
          </div>
        </Panel>

        <div className="approval-detail">
          <section className="approval-hero">
            <div>
              <span className="page-eyebrow">{quote.id}</span>
              <h2>{quote.customer.name}</h2>
              <p>{quote.customer.tier} customer · {formatMoney(calculation.total)} net value · {formatPercentage(calculation.marginPercent)} margin</p>
              <StatusBadge status={quote.stage} />
            </div>
            <RiskGauge score={calculation.riskScore} />
          </section>

          <section className="approval-summary-grid">
            <article><span><ShieldAlert size={16} /> Maximum variance</span><strong>{calculation.maxExcess.toFixed(1)} pts</strong><small>Above a line-specific ceiling</small></article>
            <article><span><AlertOctagon size={16} /> Blended excess</span><strong>{calculation.weightedExcess.toFixed(1)} pts</strong><small>Weighted across the order</small></article>
            <article><span><FileCheck2 size={16} /> Required path</span><strong>{calculation.approvalLevel === 'MANAGER_AND_FINANCE' ? '2 steps' : calculation.approvalLevel === 'MANAGER' ? '1 step' : 'No review'}</strong><small>{calculation.approvalLevel.replaceAll('_', ' ').toLowerCase()}</small></article>
          </section>

          <Panel title="Policy breakdown" description="Each line is checked against the lower of its customer-tier and category ceiling.">
            <div className="policy-table-wrap">
              <table className="data-table policy-table">
                <thead><tr><th>Line</th><th>Value</th><th>Given</th><th>Allowed</th><th>Variance</th><th>Margin</th></tr></thead>
                <tbody>
                  {calculation.lines.map((line) => (
                    <tr key={line.id}>
                      <td><strong>{line.product.name}</strong><small>{line.product.category}</small></td>
                      <td>{formatMoney(line.net)}</td>
                      <td>{line.discount.toFixed(1)}%</td>
                      <td>{line.allowedDiscount}%</td>
                      <td><span className={line.excess > 0 ? 'variance-pill variance-pill--danger' : 'variance-pill'}>{line.excess > 0 ? `+${line.excess.toFixed(1)} pts` : 'Within limit'}</span></td>
                      <td>{formatPercentage(line.marginPercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="approval-bottom-grid">
            <Panel title="Approval path" description="Only required reviewers are included.">
              <div className="approval-steps">
                {quote.approvalSteps.map((step, index) => (
                  <article className={`approval-step approval-step--${step.status.toLowerCase()}`} key={step.id}>
                    <span>{step.status === 'APPROVED' ? <Check size={15} /> : step.status === 'PENDING' ? <Clock3 size={15} /> : index + 1}</span>
                    <div><strong>{step.role}</strong><small>{step.assignee}</small></div>
                    <b>{step.status.toLowerCase()}</b>
                  </article>
                ))}
                {!quote.approvalSteps.length && <p className="empty-copy">No approval steps were required.</p>}
              </div>
            </Panel>

            <Panel title="Decision" description="A reason is mandatory when rejecting.">
              <textarea className="decision-reason" rows="4" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Add decision context for the audit trail…" disabled={!canAct || saving} />
              <div className="decision-actions">
                <button className="button button--danger" type="button" onClick={() => decide('REJECT')} disabled={!canAct || saving}><X size={15} /> {saving ? 'Saving…' : 'Reject'}</button>
                <button className="button button--success" type="button" onClick={() => decide('APPROVE')} disabled={!canAct || saving}><CheckCircle2 size={15} /> {saving ? 'Saving…' : 'Approve'}</button>
              </div>
              {!canAct && (
                <p className="decision-complete">
                  <Clock3 size={14} />
                  {activeStep
                    ? `Waiting for ${activeStep.role} review.`
                    : 'This quotation has no open reviewer action.'}
                </p>
              )}
            </Panel>
          </div>

          <Panel title="Audit trail" description="Every policy event, edit and reviewer decision is retained.">
            <div className="audit-timeline">
              {quote.audit.map((event) => (
                <article key={event.id}>
                  <i />
                  <div><span><strong>{event.action}</strong><small>{event.time}</small></span><p>{event.detail}</p><small>by {event.actor}</small></div>
                </article>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
