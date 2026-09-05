import {
  BadgePercent,
  Boxes,
  Check,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Users,
  Warehouse,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authApi } from '../../api/authApi.js'
import { productApi } from '../../api/productApi.js'
import { storeApi } from '../../api/storeApi.js'
import {
  discountRules as seededDiscountRules,
  subscriptionPlans as seededPlans,
} from '../seed.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, Panel, StatusBadge } from '../components/Ui.jsx'

const tabs = [
  { id: 'products', label: 'Products & prices', icon: PackagePlus, roles: ['ADMIN'] },
  { id: 'discounts', label: 'Discount policy', icon: BadgePercent, roles: ['ADMIN', 'MANAGER'] },
  { id: 'warehouses', label: 'Warehouses', icon: Warehouse, roles: ['ADMIN'] },
  { id: 'plans', label: 'Recurring plans', icon: RefreshCw, roles: ['ADMIN'] },
  { id: 'access', label: 'Access requests', icon: Users, roles: ['ADMIN'] },
]

const emptyProductForm = {
  name: '',
  category: 'HARDWARE',
  hsnCode: '',
  gst: '18',
  sku: '',
  price: '',
  restockPoint: '',
  discount: '0',
  cycle: 'MONTHLY',
}

const emptyStoreForm = {
  name: '',
  lat: '',
  long: '',
}

function ProductsConfiguration() {
  const [products, setProducts] = useState([])
  const [stores, setStores] = useState([])
  const [catalogueState, setCatalogueState] = useState({ loading: true, error: '' })
  const [form, setForm] = useState({ ...emptyProductForm })
  const [creating, setCreating] = useState(false)
  const [preparedHsn, setPreparedHsn] = useState('')
  const [inventoryDraft, setInventoryDraft] = useState(null)
  const [addingInventory, setAddingInventory] = useState(false)
  const isSubscription = form.category === 'SUBSCRIPTION'

  useEffect(() => {
    let mounted = true
    Promise.all([productApi.list(), storeApi.list()])
      .then(([productResult, storeResult]) => {
        if (!mounted) return
        const availableStores = storeResult.stores ?? []
        setProducts(productResult.products ?? [])
        setStores(availableStores)
        setCatalogueState({ loading: false, error: '' })
      })
      .catch((error) => {
        if (mounted) setCatalogueState({ loading: false, error: error.message })
      })

    return () => { mounted = false }
  }, [])

  function updateField(field, value) {
    if (field === 'hsnCode' || field === 'gst') setPreparedHsn('')
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function createProduct(event) {
    event.preventDefault()
    setCreating(true)
    try {
      let reportingHsn = preparedHsn
      if (!reportingHsn) {
        const hsnResult = await productApi.createHsn({
          hsn_code: form.hsnCode.trim(),
          gst: Number(form.gst),
        })
        reportingHsn = hsnResult.reporting_hsn?.reporting_hsn
        if (!reportingHsn) throw new Error('Night Sky did not return a reporting HSN.')
        setPreparedHsn(reportingHsn)
      }

      const result = await productApi.create({
        name: form.name.trim(),
        reporting_hsn: reportingHsn,
        categories: [form.category],
        cycle: isSubscription ? form.cycle : null,
        articles: [{
          seller_identifier: form.sku.trim(),
          price: Number(form.price),
          inventory: {
            sellable: 0,
            reserved: 0,
          },
          store_id: null,
          discount: isSubscription ? 0 : Number(form.discount),
          restock_point: isSubscription ? 0 : Number(form.restockPoint),
        }],
      })
      const refreshed = await productApi.list()
      setProducts(refreshed.products ?? [])
      setForm({ ...emptyProductForm })
      setPreparedHsn('')
      toast.success(`${result.product.name} created`, {
        description: `${form.sku.trim()} was created with zero inventory.`,
      })
    } catch (error) {
      toast.error(error.message ?? 'The product could not be created.')
    } finally {
      setCreating(false)
    }
  }

  async function addInventory(event) {
    event.preventDefault()
    const sellable = Number(inventoryDraft.sellable || 0)
    const reserved = Number(inventoryDraft.reserved || 0)
    if (!inventoryDraft.storeId) {
      toast.error('Select a store for this inventory.')
      return
    }
    if (sellable <= 0 && reserved <= 0) {
      toast.error('Enter inventory greater than zero.')
      return
    }

    setAddingInventory(true)
    try {
      await productApi.addInventory({
        article_id: inventoryDraft.articleId,
        store_id: inventoryDraft.storeId,
        inventory: { sellable, reserved },
      })
      const refreshed = await productApi.list()
      setProducts(refreshed.products ?? [])
      toast.success(`Inventory added to ${inventoryDraft.name}`, {
        description: `${sellable} sellable and ${reserved} reserved units added.`,
      })
      setInventoryDraft(null)
    } catch (error) {
      toast.error(error.message ?? 'Inventory could not be added.')
    } finally {
      setAddingInventory(false)
    }
  }

  return (
    <div className="configuration-product-stack">
      <Panel
        title="Create product"
        description="Create a product and SKU independently of store and inventory setup."
      >
        <form className="product-create-form" onSubmit={createProduct}>
          <div className="product-create-grid">
            <label>
              <span>Product name</span>
              <input required maxLength={120} placeholder="Ergonomic office chair" value={form.name} onChange={(event) => updateField('name', event.target.value)} />
            </label>
            <label>
              <span>Category</span>
              <select value={form.category} onChange={(event) => updateField('category', event.target.value)}>
                <option value="HARDWARE">Hardware</option>
                <option value="SERVICES">Service</option>
                <option value="SUBSCRIPTION">Subscription</option>
              </select>
            </label>
            <label>
              <span>SKU / seller identifier</span>
              <input required maxLength={100} placeholder="CHAIR-ERG-01" value={form.sku} onChange={(event) => updateField('sku', event.target.value)} />
            </label>

            <label>
              <span>HSN code</span>
              <input required maxLength={30} placeholder="9401" value={form.hsnCode} onChange={(event) => updateField('hsnCode', event.target.value)} />
            </label>
            <label>
              <span>GST</span>
              <span className="product-number-control"><input required type="number" min="0" max="100" step="0.01" value={form.gst} onChange={(event) => updateField('gst', event.target.value)} /><i>%</i></span>
            </label>
            <label>
              <span>{isSubscription ? 'Subscription price' : 'Unit price'}</span>
              <span className="product-number-control"><i>₹</i><input required type="number" min="0" step="1" value={form.price} onChange={(event) => updateField('price', event.target.value)} /></span>
            </label>

            {isSubscription ? (
              <label className="product-create-span">
                <span>Billing cycle</span>
                <select value={form.cycle} onChange={(event) => updateField('cycle', event.target.value)}>
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              </label>
            ) : (
              <>
                <label>
                  <span>Restock at</span>
                  <input required type="number" min="0" step="1" value={form.restockPoint} onChange={(event) => updateField('restockPoint', event.target.value)} />
                </label>
                <label>
                  <span>Maximum product discount</span>
                  <span className="product-number-control"><input required type="number" min="0" max="100" step="0.01" value={form.discount} onChange={(event) => updateField('discount', event.target.value)} /><i>%</i></span>
                </label>
              </>
            )}
          </div>

          {catalogueState.error && <div className="inline-error">{catalogueState.error}</div>}

          <footer className="product-create-actions">
            <small>New physical SKUs start unassigned with zero inventory. Subscription store, inventory and product discount remain fixed at zero.</small>
            <button className="button button--primary" type="submit" disabled={creating || catalogueState.loading}>
              <Plus size={15} /> {creating ? 'Creating product…' : 'Create product'}
            </button>
          </footer>
        </form>
      </Panel>

      <Panel title="Product catalogue" description="Manage inventory independently for each physical SKU.">
        {/* <div className="configuration-summary">
          <span><Boxes size={17} /><strong>{products.length}</strong><small>Product SKUs</small></span>
          <span><Layers3 size={17} /><strong>3</strong><small>Supported categories</small></span>
          <span><CircleDollarSign size={17} /><strong>INR</strong><small>Base currency</small></span>
        </div> */}
        <div className="data-table-wrap data-table-wrap--nested">
          <table className="data-table product-catalogue-table">
            <thead><tr><th>Product</th><th>Category</th><th>Reporting HSN</th><th>Price</th><th>Stock</th><th>Discount limit</th><th>Fulfillment</th><th>Action</th></tr></thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong><small>{product.sku}</small></td>
                  <td>{product.category}</td>
                  <td>{product.reportingHsn}</td>
                  <td>₹{Number(product.price).toLocaleString('en-IN')}</td>
                  <td>{product.recurring ? 'Not tracked' : product.stock}</td>
                  <td>{product.discountLimit}%</td>
                  <td>{product.recurring ? product.unit : stores.find((store) => String(store._id) === product.storeId)?.name ?? 'Not assigned'}</td>
                  <td>
                    {product.recurring ? (
                      <span className="text-muted">Not tracked</span>
                    ) : (
                      <button
                        className="button button--quiet button--small"
                        type="button"
                        onClick={() => setInventoryDraft({
                          articleId: product.articleId,
                          name: product.name,
                          sku: product.sku,
                          storeId: product.storeId || String(stores[0]?._id ?? ''),
                          storeLocked: Boolean(product.storeId),
                          sellable: '',
                          reserved: '',
                        })}
                        disabled={!stores.length}
                      >
                        <Plus size={13} /> Add inventory
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {catalogueState.loading && <p className="empty-copy empty-copy--large">Loading products…</p>}
          {!catalogueState.loading && !catalogueState.error && !products.length && <p className="empty-copy empty-copy--large">No products yet. Create the first SKU above.</p>}
        </div>
        {!catalogueState.loading && products.some((product) => !product.recurring) && !stores.length && (
          <div className="product-form-warning">Create a store from the Warehouses tab before adding physical inventory.</div>
        )}

        {inventoryDraft && (
          <form className="inventory-add-form" onSubmit={addInventory}>
            <div>
              <strong>Add inventory</strong>
              <small>{inventoryDraft.name} · {inventoryDraft.sku}</small>
            </div>
            <label>
              <span>Store</span>
              <select required disabled={inventoryDraft.storeLocked} value={inventoryDraft.storeId} onChange={(event) => setInventoryDraft((current) => ({ ...current, storeId: event.target.value }))}>
                <option value="">Select a store</option>
                {stores.map((store) => <option value={store._id} key={store._id}>{store.name}</option>)}
              </select>
            </label>
            <label>
              <span>Sellable units to add</span>
              <input autoFocus type="number" min="0" step="1" value={inventoryDraft.sellable} onChange={(event) => setInventoryDraft((current) => ({ ...current, sellable: event.target.value }))} />
            </label>
            <label>
              <span>Reserved units to add</span>
              <input type="number" min="0" step="1" value={inventoryDraft.reserved} onChange={(event) => setInventoryDraft((current) => ({ ...current, reserved: event.target.value }))} />
            </label>
            <div className="inventory-add-actions">
              <button className="button button--quiet button--small" type="button" disabled={addingInventory} onClick={() => setInventoryDraft(null)}>Cancel</button>
              <button className="button button--primary button--small" type="submit" disabled={addingInventory}><Plus size={13} /> {addingInventory ? 'Adding…' : 'Add inventory'}</button>
            </div>
          </form>
        )}
      </Panel>
    </div>
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
  const tierDetails = {
    Bronze: 'New and entry-level customer accounts',
    Silver: 'Established customers with regular orders',
    Gold: 'Strategic customers with the highest allowance',
  }

  const categories = [
    { key: 'hardware', name: 'Hardware', detail: 'Protect physical product margins', icon: Boxes },
    { key: 'service', name: 'Services', detail: 'Protect delivery and labour margins', icon: Users },
    { key: 'subscription', name: 'Subscriptions', detail: 'Fixed at zero by pricing policy', icon: RefreshCw, locked: true },
  ]

  function updateRule(tier, field, value) {
    setRules((current) => current.map((rule) => rule.tier === tier ? { ...rule, [field]: Number(value) } : rule))
  }

  function updateCategory(category, value) {
    setCategoryRules((current) => ({ ...current, [category]: Number(value) }))
  }

  return (
    <div className="discount-policy-layout">
      <section className="discount-policy-intro" aria-label="How discount limits are applied">
        <span className="discount-policy-intro__icon"><ShieldCheck size={23} /></span>
        <div className="discount-policy-intro__copy">
          <span>Pricing guardrail</span>
          <strong>The lower discount ceiling always wins</strong>
          <p>Every quote line is checked against both the customer tier and product category before it can proceed.</p>
        </div>
        <div className="discount-policy-formula" aria-label="Customer tier ceiling and category ceiling determine the applied ceiling">
          <span><small>Customer tier</small><strong>Account limit</strong></span>
          <i>+</i>
          <span><small>Product category</small><strong>Line limit</strong></span>
          <i>→</i>
          <span className="discount-policy-formula__result"><small>Applied ceiling</small><strong>Lower value</strong></span>
        </div>
      </section>

      <Panel
        title="Customer tier limits"
        description="Set the maximum discretionary discount available for each customer tier."
        className="discount-policy-panel"
      >
        <div className="discount-tier-grid">
          {rules.map((rule) => (
            <article className={`discount-tier-card discount-tier-card--${rule.tier.toLowerCase()}`} key={rule.tier}>
              <header>
                <span className={`tier-medal tier-medal--${rule.tier.toLowerCase()}`}>{rule.tier[0]}</span>
                <div><strong>{rule.tier}</strong><small>{tierDetails[rule.tier] ?? 'Customer discount tier'}</small></div>
              </header>
              <label className="discount-limit-field" htmlFor={`tier-${rule.tier.toLowerCase()}`}>
                <span>Maximum discount</span>
                <span className="discount-percentage-input">
                  <input
                    id={`tier-${rule.tier.toLowerCase()}`}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={rule.ceiling}
                    disabled={!canManage}
                    onChange={(event) => updateRule(rule.tier, 'ceiling', event.target.value)}
                  />
                  <i>%</i>
                </span>
              </label>
              <footer>
                <small>Used as the account-level ceiling on every quotation.</small>
                <button
                  className="button button--quiet button--small"
                  type="button"
                  disabled={!canManage || savingTier === rule.tier}
                  onClick={() => onCreateTier(rule)}
                >
                  <Save size={13} /> {savingTier === rule.tier ? 'Applying…' : `Apply ${rule.tier}`}
                </button>
              </footer>
            </article>
          ))}
        </div>
      </Panel>

      <Panel
        title="Product category limits"
        description="Protect margins by setting a separate ceiling for each type of product."
        className="discount-policy-panel"
        action={(
          <button
            className="button button--primary"
            type="button"
            disabled={!canManage || savingCategory}
            onClick={onCreateCategory}
          >
            <Save size={14} /> {savingCategory ? 'Applying policy…' : 'Apply category policy'}
          </button>
        )}
      >
        <div className="category-rule-grid">
          {categories.map(({ key, name, detail, icon: Icon, locked }) => (
            <article className={`category-rule-card category-rule-card--${key}`} key={key}>
              <header>
                <span className="category-rule-card__icon"><Icon size={19} /></span>
                <div><strong>{name}</strong><small>{detail}</small></div>
                {locked && <span className="category-rule-card__lock">Fixed</span>}
              </header>
              <label className="discount-limit-field" htmlFor={`category-${key}`}>
                <span>Maximum discount</span>
                <span className="discount-percentage-input">
                  <input
                    id={`category-${key}`}
                    value={categoryRules[key]}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    disabled={!canManage || locked}
                    onChange={(event) => updateCategory(key, event.target.value)}
                  />
                  <i>%</i>
                </span>
              </label>
            </article>
          ))}
        </div>
        <div className="discount-policy-note">
          <BadgePercent size={18} />
          <p><strong>Example:</strong> a Gold customer with a 15% tier limit buying a Service capped at 10% can receive at most 10% on that line.</p>
        </div>
      </Panel>
    </div>
  )
}

function WarehouseConfiguration() {
  const [stores, setStores] = useState([])
  const [storeForm, setStoreForm] = useState({ ...emptyStoreForm })
  const [storeState, setStoreState] = useState({ loading: true, error: '' })
  const [creatingStore, setCreatingStore] = useState(false)

  useEffect(() => {
    let mounted = true
    storeApi.list()
      .then((result) => {
        if (!mounted) return
        setStores(result.stores ?? [])
        setStoreState({ loading: false, error: '' })
      })
      .catch((error) => {
        if (mounted) setStoreState({ loading: false, error: error.message })
      })

    return () => { mounted = false }
  }, [])

  async function createStore(event) {
    event.preventDefault()
    setCreatingStore(true)
    try {
      const result = await storeApi.create({
        name: storeForm.name.trim(),
        lat: Number(storeForm.lat),
        long: Number(storeForm.long),
      })
      setStores((current) => [...current, result.store].sort((left, right) => left.name.localeCompare(right.name)))
      setStoreForm({ ...emptyStoreForm })
      toast.success(`${result.store.name} created`, {
        description: 'The store is now available for inventory assignment.',
      })
    } catch (error) {
      toast.error(error.message ?? 'The store could not be created.')
    } finally {
      setCreatingStore(false)
    }
  }

  return (
    <div className="configuration-product-stack">
      <Panel title="Create store" description="Create a fulfillment location independently of products and inventory.">
        <form className="product-create-form" onSubmit={createStore}>
          <div className="product-create-grid store-create-grid">
            <label>
              <span>Store name</span>
              <input required maxLength={120} placeholder="Mumbai Central Warehouse" value={storeForm.name} onChange={(event) => setStoreForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label>
              <span>Latitude</span>
              <input required type="number" min="-90" max="90" step="any" placeholder="19.0760" value={storeForm.lat} onChange={(event) => setStoreForm((current) => ({ ...current, lat: event.target.value }))} />
            </label>
            <label>
              <span>Longitude</span>
              <input required type="number" min="-180" max="180" step="any" placeholder="72.8777" value={storeForm.long} onChange={(event) => setStoreForm((current) => ({ ...current, long: event.target.value }))} />
            </label>
          </div>
          {storeState.error && <div className="inline-error">{storeState.error}</div>}
          <footer className="product-create-actions">
            <small>Coordinates are used later when the system selects the nearest eligible fulfillment store.</small>
            <button className="button button--primary" type="submit" disabled={creatingStore}>
              <Plus size={15} /> {creatingStore ? 'Creating store…' : 'Create store'}
            </button>
          </footer>
        </form>
      </Panel>

      <Panel title="Stores" description="Fulfillment locations currently available for inventory assignment.">
        {storeState.loading ? <p className="empty-copy empty-copy--large">Loading stores…</p> : (
          <div className="warehouse-config-grid">
            {stores.map((store) => (
              <article key={store._id}>
                <header><span><Warehouse size={18} /></span><div><strong>{store.name}</strong><small>Store ID · {String(store._id).slice(-6).toUpperCase()}</small></div><StatusBadge status="APPROVED" label="Active" /></header>
                <dl><div><dt>Latitude</dt><dd>{store.lat}</dd></div><div><dt>Longitude</dt><dd>{store.long}</dd></div></dl>
              </article>
            ))}
            {!stores.length && <p className="empty-copy empty-copy--large">No stores created yet.</p>}
          </div>
        )}
      </Panel>
    </div>
  )
}

function PlanConfiguration({ plans }) {
  return (
    <Panel title="Subscription plans" description="Cadence, proration, cancellation and refund behavior.">
      <div className="plan-config-list">
        {plans.map((plan) => (
          <article key={plan.id}><span className="plan-icon"><RefreshCw size={17} /></span><div><span><strong>{plan.name}</strong><StatusBadge status="APPROVED" label="Active" /></span><small>{plan.activeProducts} linked products</small></div><dl><div><dt>Cadence</dt><dd>{plan.cadence}</dd></div><div><dt>Proration</dt><dd>{plan.proration}</dd></div><div><dt>Cancellation</dt><dd>{plan.cancellation}</dd></div></dl></article>
        ))}
      </div>
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
  const visibleTabs = tabs.filter((tab) => tab.roles.includes(user.role))
  const defaultTab = visibleTabs.some((tab) => tab.id === initialTab)
    ? initialTab
    : visibleTabs[0]?.id
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [rules, setRules] = useState(seededDiscountRules)
  const [categoryRules, setCategoryRules] = useState({
    hardware: 15,
    service: 10,
    subscription: 0,
  })
  const [savingTier, setSavingTier] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)
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
        title={user.role === 'MANAGER' ? 'Pricing policy' : 'Configuration'}
        description={user.role === 'MANAGER'
          ? 'Set customer-tier and category discount ceilings used by automatic approval routing.'
          : 'Control products, pricing, fulfillment, recurring billing and internal access.'}
      />

      <section className="configuration-tabs">
        {visibleTabs.map(({ id, label, icon: Icon }) => (
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

      {activeTab === 'products' && <ProductsConfiguration />}
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
          canManage={['ADMIN', 'MANAGER'].includes(user.role)}
        />
      )}
      {activeTab === 'warehouses' && <WarehouseConfiguration />}
      {activeTab === 'plans' && <PlanConfiguration plans={plans} />}
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
