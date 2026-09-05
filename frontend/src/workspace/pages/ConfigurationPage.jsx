import {
  BadgePercent,
  Boxes,
  Check,
  ChevronRight,
  CircleDollarSign,
  Layers3,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Warehouse,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authApi } from '../../api/authApi.js'
import { formatMoney } from '../dealMath.js'
import {
  discountRules as seededDiscountRules,
  products as seededProducts,
  subscriptionPlans as seededPlans,
  upsellSuggestions,
  warehouseData as seededWarehouses,
} from '../seed.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, Panel, StatusBadge } from '../components/Ui.jsx'

const tabs = [
  { id: 'products', label: 'Products & prices', icon: PackagePlus },
  { id: 'discounts', label: 'Discount policy', icon: BadgePercent },
  { id: 'warehouses', label: 'Warehouses', icon: Warehouse },
  { id: 'plans', label: 'Recurring plans', icon: RefreshCw },
  { id: 'recommendations', label: 'Recommendations', icon: Sparkles },
  { id: 'access', label: 'Access requests', icon: Users },
]

function ProductsConfiguration({ products, setProducts }) {
  function updatePrice(id, value) {
    setProducts((current) => current.map((item) => item.id === id ? { ...item, price: Number(value) } : item))
  }

  return (
    <Panel title="Product catalogue" description="Core commercial details, variants and price-list coverage." action={<button className="button button--primary button--small" type="button" onClick={() => toast.info('Product form is ready for API wiring')}><Plus size={14} /> Add product</button>}>
      <div className="configuration-summary">
        <span><Boxes size={17} /><strong>{products.length}</strong><small>Active products</small></span>
        <span><Layers3 size={17} /><strong>3</strong><small>Customer price lists</small></span>
        <span><CircleDollarSign size={17} /><strong>INR</strong><small>Base currency</small></span>
      </div>
      <div className="data-table-wrap data-table-wrap--nested">
        <table className="data-table">
          <thead><tr><th>Product</th><th>Category</th><th>Unit</th><th>Tax</th><th>Base price</th><th>Variant / plan</th></tr></thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td><strong>{product.name}</strong><small>{product.sku}</small></td>
                <td>{product.category}</td>
                <td>{product.unit}</td>
                <td>{product.tax}%</td>
                <td><label className="inline-money">₹<input type="number" value={product.price} onChange={(event) => updatePrice(product.id, event.target.value)} /></label></td>
                <td>{product.plan ?? (product.category === 'Hardware' ? 'Standard' : 'Base service')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function DiscountConfiguration({
  rules,
  setRules,
  categoryRules,
  setCategoryRules,
  onCreateTier,
  onCreateCategory,
  savingTier,
  savingCategory,
  canManage,
}) {
  function updateRule(tier, field, value) {
    setRules((current) => current.map((rule) => rule.tier === tier ? { ...rule, [field]: Number(value) } : rule))
  }

  function updateCategory(category, value) {
    setCategoryRules((current) => ({ ...current, [category]: Number(value) }))
  }

  return (
    <div className="configuration-grid">
      <Panel title="Customer-tier ceilings" description="The first pricing boundary applied to every line.">
        <div className="discount-tier-list">
          {rules.map((rule) => (
            <article key={rule.tier}>
              <span className={`tier-medal tier-medal--${rule.tier.toLowerCase()}`}>{rule.tier[0]}</span>
              <div><strong>{rule.tier}</strong><small>Standard discretionary discount</small></div>
              <span className="discount-rule-actions">
                <label><input type="number" min="0" value={rule.ceiling} onChange={(event) => updateRule(rule.tier, 'ceiling', event.target.value)} />%</label>
                <button
                  className="button button--quiet button--small"
                  type="button"
                  disabled={!canManage || savingTier === rule.tier}
                  onClick={() => onCreateTier(rule)}
                >
                  {savingTier === rule.tier ? 'Creating…' : 'Create'}
                </button>
              </span>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Approval chain" description="The highest triggered step governs the full blended quotation.">
        <div className="approval-chain-config">
          <article><span><Check size={14} /></span><div><strong>Within ceiling</strong><small>Proceed without manual approval</small></div></article>
          <ChevronRight size={16} />
          <article><span>1</span><div><strong>Sales Manager</strong><small>Any category or tier exception</small></div></article>
          <ChevronRight size={16} />
          <article><span>2</span><div><strong>Finance</strong><small>Risk ≥ 65 or variance ≥ 8 pts</small></div></article>
        </div>
      </Panel>

      <Panel
        title="Category ceilings"
        description="A stricter category cap overrides the customer-tier allowance."
        className="configuration-span"
        action={(
          <button
            className="button button--primary button--small"
            type="button"
            disabled={!canManage || savingCategory}
            onClick={onCreateCategory}
          >
            <Save size={13} /> {savingCategory ? 'Creating…' : 'Create category policy'}
          </button>
        )}
      >
        <div className="category-rule-grid">
          {[
            ['hardware', 'Hardware', 'Healthy unit margins'],
            ['service', 'Services', 'Labour margin protected'],
            ['subscription', 'Subscriptions', 'Fixed at zero by policy'],
          ].map(([key, name, detail]) => (
            <article key={key}><span><strong>{name}</strong><small>{detail}</small></span><label><input value={categoryRules[key]} type="number" min="0" disabled={key === 'subscription'} onChange={(event) => updateCategory(key, event.target.value)} />%</label></article>
          ))}
        </div>
        <div className="formula-note"><ShieldCheck size={18} /><span><strong>Blended risk is calculated, not hardcoded.</strong><small>Each line variance is weighted by line value, combined with the maximum breach and low-margin penalty.</small></span></div>
      </Panel>
    </div>
  )
}

function WarehouseConfiguration({ warehouses }) {
  return (
    <Panel title="Warehouse network" description="Stock, replenishment and cost weighting used by auto-split logic." action={<button className="button button--primary button--small" type="button" onClick={() => toast.info('Warehouse form opened')}><Plus size={14} /> Add warehouse</button>}>
      <div className="warehouse-config-grid">
        {warehouses.map((warehouse) => (
          <article key={warehouse.id}>
            <header><span><Warehouse size={18} /></span><div><strong>{warehouse.name}</strong><small>{warehouse.city} · {warehouse.serviceLevel}</small></div><StatusBadge status="APPROVED" label="Active" /></header>
            <dl><div><dt>Utilization</dt><dd>{warehouse.utilization}%</dd></div><div><dt>Shipping weight</dt><dd>{warehouse.shippingWeight.toFixed(2)}×</dd></div><div><dt>Tracked SKUs</dt><dd>{Object.keys(warehouse.stock).length}</dd></div></dl>
            <div className="warehouse-utilization"><i><b style={{ width: `${warehouse.utilization}%` }} /></i><small>Replenishment rules healthy</small></div>
            <button className="button button--quiet button--full" type="button" onClick={() => toast.info(`${warehouse.name} configuration opened`)}><Settings2 size={14} /> Manage stock rules</button>
          </article>
        ))}
      </div>
    </Panel>
  )
}

function PlanConfiguration({ plans }) {
  return (
    <Panel title="Subscription plans" description="Cadence, proration, cancellation and refund behavior." action={<button className="button button--primary button--small" type="button" onClick={() => toast.info('Recurring plan form opened')}><Plus size={14} /> New plan</button>}>
      <div className="plan-config-list">
        {plans.map((plan) => (
          <article key={plan.id}><span className="plan-icon"><RefreshCw size={17} /></span><div><span><strong>{plan.name}</strong><StatusBadge status="APPROVED" label="Active" /></span><small>{plan.activeProducts} linked products</small></div><dl><div><dt>Cadence</dt><dd>{plan.cadence}</dd></div><div><dt>Proration</dt><dd>{plan.proration}</dd></div><div><dt>Cancellation</dt><dd>{plan.cancellation}</dd></div></dl><button className="icon-button" type="button" aria-label={`Edit ${plan.name}`}><Settings2 size={16} /></button></article>
        ))}
      </div>
    </Panel>
  )
}

function RecommendationConfiguration() {
  return (
    <Panel title="Upsell & cross-sell rules" description="Only relevant pairings above the configured margin threshold surface to reps.">
      <div className="recommendation-config-list">
        {upsellSuggestions.map((suggestion) => (
          <article key={suggestion.id}><span><Sparkles size={17} /></span><div><strong>{suggestion.reason}</strong><small>Minimum margin contribution {formatMoney(suggestion.marginDelta)}</small></div><label className="switch"><input type="checkbox" defaultChecked /><i /></label></article>
        ))}
      </div>
      <label className="threshold-control"><span><strong>Global minimum margin delta</strong><small>Suggestions below this contribution stay hidden.</small></span><span>₹<input type="number" defaultValue="5000" /></span></label>
    </Panel>
  )
}

function AccessRequests({
  requests,
  loading,
  error,
  reviewing,
  rejectionDraft,
  onBeginRejection,
  onCancelRejection,
  onReasonChange,
  onReview,
}) {
  return (
    <Panel title="Internal access requests" description="Public registration requests a role; only an administrator can grant it.">
      {loading ? <p className="empty-copy">Loading access requests…</p> : error ? <div className="inline-error">{error}</div> : (
        <div className="access-request-list">
          {requests.map((request) => {
            const isRejecting = rejectionDraft?.id === request.id

            return (
              <article key={request.id} className={isRejecting ? 'is-rejecting' : ''}>
                <span className="request-avatar">{request.fullName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
                <div><strong>{request.fullName}</strong><small>{request.email}</small></div>
                <span><small>Requested role · {request.is_verified ? 'Verified' : 'Unverified'}</small><strong>{request.requestedRole.replaceAll('_', ' ')}</strong></span>
                <div className="access-request-actions">
                  <button
                    className="button button--danger button--small"
                    type="button"
                    disabled={Boolean(reviewing)}
                    onClick={() => isRejecting ? onCancelRejection() : onBeginRejection(request.id)}
                  >
                    <X size={13} /> {isRejecting ? 'Cancel' : 'Reject'}
                  </button>
                  <button
                    className="button button--success button--small"
                    type="button"
                    disabled={Boolean(reviewing)}
                    onClick={() => onReview(request.id, 'APPROVE')}
                  >
                    <Check size={13} /> {reviewing?.id === request.id && reviewing.decision === 'APPROVE' ? 'Approving…' : 'Approve'}
                  </button>
                </div>

                {isRejecting && (
                  <form
                    className="access-rejection-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      onReview(request.id, 'REJECT', rejectionDraft.reason.trim())
                    }}
                  >
                    <label>
                      <span>Reason shown to the user</span>
                      <textarea
                        autoFocus
                        maxLength={500}
                        minLength={3}
                        placeholder="Explain why this registration was rejected…"
                        required
                        value={rejectionDraft.reason}
                        onChange={(event) => onReasonChange(event.target.value)}
                      />
                    </label>
                    <button
                      className="button button--danger button--small"
                      type="submit"
                      disabled={Boolean(reviewing) || rejectionDraft.reason.trim().length < 3}
                    >
                      <X size={13} /> {reviewing?.id === request.id ? 'Rejecting…' : 'Confirm rejection'}
                    </button>
                  </form>
                )}
              </article>
            )
          })}
          {!requests.length && <p className="empty-copy">No pending access requests.</p>}
        </div>
      )}
    </Panel>
  )
}

export default function ConfigurationPage({ initialTab = 'products' }) {
  const { user } = useWorkspace()
  const [activeTab, setActiveTab] = useState(initialTab)
  const [products, setProducts] = useState(seededProducts)
  const [rules, setRules] = useState(seededDiscountRules)
  const [categoryRules, setCategoryRules] = useState({
    hardware: 15,
    service: 10,
    subscription: 0,
  })
  const [savingTier, setSavingTier] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)
  const [warehouses] = useState(seededWarehouses)
  const [plans] = useState(seededPlans)
  const [requests, setRequests] = useState([])
  const [requestState, setRequestState] = useState({
    loading: initialTab === 'access',
    error: '',
  })
  const [reviewing, setReviewing] = useState(null)
  const [rejectionDraft, setRejectionDraft] = useState(null)

  useEffect(() => {
    if (activeTab !== 'access' || user.role !== 'ADMIN') return
    let mounted = true
    authApi.listRegistrationRequests()
      .then((result) => {
        if (mounted) {
          setRequests(result.items)
          setRequestState({ loading: false, error: '' })
        }
      })
      .catch((error) => {
        if (mounted) setRequestState({ loading: false, error: error.message })
      })
    return () => { mounted = false }
  }, [activeTab, user.role])

  async function reviewRegistration(requestId, decision, reason = null) {
    if (reviewing) return
    setReviewing({ id: requestId, decision })
    try {
      if (decision === 'APPROVE') {
        await authApi.approveUser(requestId)
      } else {
        await authApi.reviewRegistration(requestId, {
          decision,
          reason,
        })
      }
      setRequests((current) => current.filter((item) => item.id !== requestId))
      setRejectionDraft(null)
      toast.success(decision === 'APPROVE' ? 'Workspace access approved' : 'Access request rejected')
    } catch (error) {
      if (error.status === 404 || error.status === 409) {
        setRequests((current) => current.filter((item) => item.id !== requestId))
        setRejectionDraft(null)
      }
      toast.error(error.message)
    } finally {
      setReviewing(null)
    }
  }

  async function createTierDiscount(rule) {
    setSavingTier(rule.tier)
    try {
      const result = await authApi.createTierDiscount({
        tier: rule.tier.toUpperCase(),
        discount: rule.ceiling,
      })
      toast.success(`${result.tier_discount.tier} tier created`, {
        description: `${result.tier_discount.discount}% customer discount`,
      })
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSavingTier('')
    }
  }

  async function createCategoryDiscount() {
    setSavingCategory(true)
    try {
      await authApi.createCategoryDiscount(categoryRules)
      toast.success('Category discount policy created')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSavingCategory(false)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Sales back-end"
        title="Configuration"
        description="Control the data and policies that govern pricing, approvals, fulfillment and recurring billing."
        actions={activeTab === 'discounts' ? null : <button className="button button--primary" type="button" onClick={() => toast.success('Configuration saved')}><Save size={15} /> Save changes</button>}
      />

      <section className="configuration-tabs">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            className={activeTab === id ? 'active' : ''}
            type="button"
            key={id}
            onClick={() => {
              setActiveTab(id)
              if (id === 'access' && user.role === 'ADMIN') setRequestState({ loading: true, error: '' })
            }}
          ><Icon size={15} /> {label}</button>
        ))}
      </section>

      {activeTab === 'products' && <ProductsConfiguration products={products} setProducts={setProducts} />}
      {activeTab === 'discounts' && (
        <DiscountConfiguration
          rules={rules}
          setRules={setRules}
          categoryRules={categoryRules}
          setCategoryRules={setCategoryRules}
          onCreateTier={createTierDiscount}
          onCreateCategory={createCategoryDiscount}
          savingTier={savingTier}
          savingCategory={savingCategory}
          canManage={user.role === 'ADMIN'}
        />
      )}
      {activeTab === 'warehouses' && <WarehouseConfiguration warehouses={warehouses} />}
      {activeTab === 'plans' && <PlanConfiguration plans={plans} />}
      {activeTab === 'recommendations' && <RecommendationConfiguration />}
      {activeTab === 'access' && (
        <AccessRequests
          requests={requests}
          loading={requestState.loading}
          error={user.role === 'ADMIN' ? requestState.error : 'Administrator access is required to review registrations.'}
          reviewing={reviewing}
          rejectionDraft={rejectionDraft}
          onBeginRejection={(id) => setRejectionDraft({ id, reason: '' })}
          onCancelRejection={() => setRejectionDraft(null)}
          onReasonChange={(reason) => setRejectionDraft((current) => current ? { ...current, reason } : current)}
          onReview={reviewRegistration}
        />
      )}
    </div>
  )
}
