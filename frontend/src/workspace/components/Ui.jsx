import { ChevronRight } from 'lucide-react'
import { stageMeta } from '../seed.js'

export function StatusBadge({ status, label }) {
  const meta = stageMeta[status] ?? { label: label ?? status, tone: 'neutral' }
  return <span className={`status-badge status-badge--${meta.tone}`}>{label ?? meta.label}</span>
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <span className="page-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Panel({ title, description, action, children, className = '' }) {
  return (
    <section className={`workspace-panel ${className}`}>
      {(title || action) && (
        <header className="panel-heading">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function StatCard({ icon: Icon, label, value, detail, tone = 'blue' }) {
  return (
    <article className="stat-card">
      <span className={`stat-card__icon stat-card__icon--${tone}`}><Icon size={18} /></span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  )
}

export function RowLink({ children, onClick, ariaLabel }) {
  return (
    <button className="row-link" type="button" onClick={onClick} aria-label={ariaLabel}>
      {children}
      <ChevronRight size={17} aria-hidden="true" />
    </button>
  )
}

export function RiskGauge({ score, size = 'large' }) {
  const tone = score >= 65 ? 'danger' : score >= 30 ? 'warning' : 'success'
  return (
    <div
      className={`risk-gauge risk-gauge--${size} risk-gauge--${tone}`}
      style={{ '--risk-value': `${score * 3.6}deg` }}
      aria-label={`Risk score ${score} out of 100`}
    >
      <span>
        <strong>{score}</strong>
        <small>Risk score</small>
      </span>
    </div>
  )
}

export function Avatar({ name }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
  return <span className="workspace-avatar" aria-hidden="true">{initials}</span>
}

