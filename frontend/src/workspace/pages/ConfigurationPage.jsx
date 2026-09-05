import {
  BadgePercent,
  Boxes,
  Check,
  Plus,
  RefreshCw,
  Save,
  Search,
  Users,
  Warehouse,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { authApi } from '../../api/authApi.js'
import { getRoleLabel, SIGNUP_ROLE_OPTIONS } from '../../contracts/auth.js'
import { productApi } from '../../api/productApi.js'
import { storeApi } from '../../api/storeApi.js'
import { discountRules as seededDiscountRules } from '../seed.js'
import { useWorkspace } from '../WorkspaceContext.jsx'
import { PageHeader, Panel, StatusBadge } from '../components/Ui.jsx'

/**
 * Copy for each configuration surface. Every section is now its own sidebar
 * entry and its own route, so this page renders exactly one of them at a time
 * and no longer owns a tab strip.
 */
const CONFIGURATION_SECTIONS = Object.freeze({
  products: {
    eyebrow: 'Catalogue',
    title: 'Products & inventory',
    description:
      'Create physical SKUs and top up sellable stock per fulfillment store.',
  },
  subscriptions: {
    eyebrow: 'Catalogue',
    title: 'Subscriptions',
    description:
      'A subscription is a product tagged SUBSCRIPTION. Its billing cycle and recurring price live on the subscription record.',
  },
  discounts: {
    eyebrow: 'Pricing policy',
    title: 'Discount policy',
    description:
      'Customer-tier and product-category ceilings. Quote risk is scored against the lower of the two.',
  },
  stores: {
    eyebrow: 'Fulfillment',
    title: 'Stores',
    description:
      'Fulfillment locations. Coordinates drive the nearest-store allocation used when an order is split.',
  },
  risk: {
    eyebrow: 'Pricing policy',
    title: 'Risk thresholds',
    description:
      'Order-level discount thresholds that decide whether a quotation is scored LOW, MEDIUM or HIGH risk.',
  },
  access: {
    eyebrow: 'Administration',
    title: 'Access requests',
    description:
      'Public registration requests a role. Only an administrator can grant it.',
  },
})

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

/**
 * One catalogue view with two modes.
 *
 * A subscription is not a separate entity: it is a product carrying the
 * SUBSCRIPTION category, whose recurring price and cycle are read from the
 * subscription record. So both surfaces share the same create call and the same
 * listing, and differ only in which category they write and which rows they show.
 */
function ProductsConfiguration({ mode = 'physical' }) {
  const subscriptionMode = mode === 'subscription'
  const [products, setProducts] = useState([])
  const [stores, setStores] = useState([])
  const [catalogueState, setCatalogueState] = useState({ loading: true, error: '' })
  const [form, setForm] = useState(() => ({
    ...emptyProductForm,
    category: subscriptionMode ? 'SUBSCRIPTION' : 'HARDWARE',
  }))
  const [creating, setCreating] = useState(false)
  const [preparedHsn, setPreparedHsn] = useState('')
  const [inventoryDraft, setInventoryDraft] = useState(null)
  const [addingInventory, setAddingInventory] = useState(false)
  const isSubscription = form.category === 'SUBSCRIPTION'
  const visibleProducts = products.filter(
    (product) => Boolean(product.recurring) === subscriptionMode,
  )

  useEffect(() => {
    let mounted = true
    const requests = subscriptionMode
      ? [productApi.list()]
      : [productApi.list(), storeApi.list()]

    Promise.all(requests)
      .then(([productResult, storeResult]) => {
        if (!mounted) return
        setProducts(productResult.products ?? [])
        setStores(storeResult?.stores ?? [])
        setCatalogueState({ loading: false, error: '' })
      })
      .catch((error) => {
        if (mounted) setCatalogueState({ loading: false, error: error.message })
      })

    return () => { mounted = false }
  }, [subscriptionMode])

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
      setForm({
        ...emptyProductForm,
        category: subscriptionMode ? 'SUBSCRIPTION' : 'HARDWARE',
      })
      setPreparedHsn('')
      toast.success(`${result.product.name} created`, {
        description: subscriptionMode
          ? `${form.sku.trim()} is billed ${form.cycle.toLowerCase()}.`
          : `${form.sku.trim()} was created with zero inventory.`,
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
        title={subscriptionMode ? 'Create subscription' : 'Create product'}
        description={subscriptionMode
          ? 'Creates a product tagged SUBSCRIPTION. It carries no store and no tracked inventory.'
          : 'Create a product and SKU independently of store and inventory setup.'}
      >
        <form className="product-create-form" onSubmit={createProduct}>
          <div className="product-create-grid">
            <label>
              <span>{subscriptionMode ? 'Subscription name' : 'Product name'}</span>
              <input required maxLength={120} placeholder={subscriptionMode ? 'Managed support plan' : 'Ergonomic office chair'} value={form.name} onChange={(event) => updateField('name', event.target.value)} />
            </label>
            {!subscriptionMode && (
              <label>
                <span>Category</span>
                <select value={form.category} onChange={(event) => updateField('category', event.target.value)}>
                  <option value="HARDWARE">Hardware</option>
                  <option value="SERVICES">Service</option>
                </select>
              </label>
            )}
            <label>
              <span>SKU / seller identifier</span>
              <input required maxLength={100} placeholder={subscriptionMode ? 'SUB-SUPPORT-01' : 'CHAIR-ERG-01'} value={form.sku} onChange={(event) => updateField('sku', event.target.value)} />
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
            <small>{subscriptionMode
              ? 'Store, inventory and product discount stay fixed at zero for subscription articles.'
              : 'New physical SKUs start unassigned with zero inventory. Add stock per store below.'}</small>
            <button className="button button--primary" type="submit" disabled={creating || catalogueState.loading}>
              <Plus size={15} /> {creating
                ? (subscriptionMode ? 'Creating subscription…' : 'Creating product…')
                : (subscriptionMode ? 'Create subscription' : 'Create product')}
            </button>
          </footer>
        </form>
      </Panel>

      <Panel
        title={subscriptionMode ? 'Active subscriptions' : 'Product catalogue'}
        description={subscriptionMode
          ? 'Subscription SKUs available to sales representatives when building a quotation.'
          : 'Manage inventory independently for each physical SKU.'}
      >
        <div className="data-table-wrap data-table-wrap--nested">
          <table className="data-table product-catalogue-table">
            <thead>
              {subscriptionMode ? (
                <tr><th>Subscription</th><th>Reporting HSN</th><th>Recurring price</th><th>Billing cycle</th></tr>
              ) : (
                <tr><th>Product</th><th>Category</th><th>Reporting HSN</th><th>Price</th><th>Stock</th><th>Discount limit</th><th>Fulfillment</th><th>Action</th></tr>
              )}
            </thead>
            <tbody>
              {visibleProducts.map((product) => (subscriptionMode ? (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong><small>{product.sku}</small></td>
                  <td>{product.reportingHsn}</td>
                  <td>₹{Number(product.price).toLocaleString('en-IN')}</td>
                  <td>{product.unit}</td>
                </tr>
              ) : (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong><small>{product.sku}</small></td>
                  <td>{product.category}</td>
                  <td>{product.reportingHsn}</td>
                  <td>₹{Number(product.price).toLocaleString('en-IN')}</td>
                  <td>{product.stock}</td>
                  <td>{product.discountLimit}%</td>
                  <td>{stores.find((store) => String(store._id) === product.storeId)?.name ?? 'Not assigned'}</td>
                  <td>
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
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
          {catalogueState.loading && <p className="empty-copy empty-copy--large">Loading {subscriptionMode ? 'subscriptions' : 'products'}…</p>}
          {catalogueState.error && <div className="inline-error">{catalogueState.error}</div>}
          {!catalogueState.loading && !catalogueState.error && !visibleProducts.length && (
            <p className="empty-copy empty-copy--large">
              {subscriptionMode
                ? 'No subscriptions yet. Create the first one above.'
                : 'No products yet. Create the first SKU above.'}
            </p>
          )}
        </div>
        {!subscriptionMode && !catalogueState.loading && visibleProducts.length > 0 && !stores.length && (
          <div className="product-form-warning">Create a store from the Stores screen before adding physical inventory.</div>
        )}

        {!subscriptionMode && inventoryDraft && (
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
  categoryPersisted,
  policyState,
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
      {policyState.loading && <div className="discount-policy-status">Loading saved discount policy…</div>}
      {policyState.error && <div className="inline-error">{policyState.error}</div>}

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
                    disabled={!canManage || policyState.loading || Boolean(policyState.error)}
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
                  disabled={!canManage || policyState.loading || Boolean(policyState.error) || savingTier === rule.tier}
                  onClick={() => onCreateTier(rule)}
                >
                  <Save size={13} /> {savingTier === rule.tier
                    ? `${rule.persisted ? 'Updating' : 'Creating'}…`
                    : `${rule.persisted ? 'Update' : 'Create'} ${rule.tier}`}
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
            disabled={!canManage || policyState.loading || Boolean(policyState.error) || savingCategory}
            onClick={onCreateCategory}
          >
            <Save size={14} /> {savingCategory
              ? `${categoryPersisted ? 'Updating' : 'Creating'} policy…`
              : `${categoryPersisted ? 'Update' : 'Create'} category policy`}
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
                    disabled={!canManage || policyState.loading || Boolean(policyState.error) || locked}
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

/**
 * Thresholds consumed by Morning Star when it scores a quotation. The line-item
 * rule is deliberately shown as read-only: any line discounted past its own
 * product ceiling forces at least MEDIUM regardless of these numbers, and that
 * rule is not configurable server side.
 */
function RiskConfiguration() {
  const [riskData, setRiskData] = useState(null)
  const [draft, setDraft] = useState({ medium: '', high: '' })
  const [riskState, setRiskState] = useState({ loading: true, error: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    authApi.getRiskData()
      .then((result) => {
        if (!mounted) return
        setRiskData(result.risk_data)
        setDraft({
          medium: String(result.risk_data.medium_risk_threshold),
          high: String(result.risk_data.high_risk_threshold),
        })
        setRiskState({ loading: false, error: '' })
      })
      .catch((error) => {
        if (mounted) setRiskState({ loading: false, error: error.message })
      })

    return () => { mounted = false }
  }, [])

  const medium = Number(draft.medium)
  const high = Number(draft.high)
  const invalidOrder =
    Number.isFinite(medium) && Number.isFinite(high) && medium >= high

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const result = await authApi.configureRisk({
        medium_risk_threshold: medium,
        high_risk_threshold: high,
      })
      setRiskData(result.risk_data)
      toast.success('Risk thresholds saved', {
        description: `MEDIUM above ${result.risk_data.medium_risk_threshold}%, HIGH above ${result.risk_data.high_risk_threshold}%.`,
      })
    } catch (error) {
      toast.error(error.message ?? 'The thresholds could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (riskState.loading) {
    return <Panel title="Risk thresholds"><p className="empty-copy empty-copy--large">Loading risk configuration…</p></Panel>
  }

  if (riskState.error) {
    return <Panel title="Risk thresholds"><div className="inline-error">{riskState.error}</div></Panel>
  }

  return (
    <div className="configuration-product-stack">
      <Panel
        title="Order discount thresholds"
        description="Measured on the total discount applied across the whole quotation."
        action={<StatusBadge status={riskData.configured ? 'APPROVED' : 'DRAFT'} label={riskData.configured ? 'Configured' : 'Using defaults'} />}
      >
        <form className="product-create-form" onSubmit={save}>
          <div className="product-create-grid store-create-grid">
            <label>
              <span>MEDIUM above</span>
              <span className="product-number-control">
                <input required type="number" min="0" max="100" step="0.01" value={draft.medium} onChange={(event) => setDraft((current) => ({ ...current, medium: event.target.value }))} />
                <i>%</i>
              </span>
            </label>
            <label>
              <span>HIGH above</span>
              <span className="product-number-control">
                <input required type="number" min="0" max="100" step="0.01" value={draft.high} onChange={(event) => setDraft((current) => ({ ...current, high: event.target.value }))} />
                <i>%</i>
              </span>
            </label>
          </div>

          {invalidOrder && (
            <div className="product-form-warning">The HIGH threshold must be greater than the MEDIUM threshold.</div>
          )}

          <footer className="product-create-actions">
            <small>
              {riskData.updatedAt
                ? `Last changed ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(riskData.updatedAt))}.`
                : 'No override saved yet, so Morning Star is using its built-in defaults.'}
            </small>
            <button className="button button--primary" type="submit" disabled={saving || invalidOrder}>
              <Save size={15} /> {saving ? 'Saving thresholds…' : 'Save thresholds'}
            </button>
          </footer>
        </form>
      </Panel>

      <Panel title="Line-item rule" description="Applied before the thresholds above and not configurable.">
        <dl className="allocation-summary">
          <div><dt>Condition</dt><dd><code>{riskData.line_item_rule.condition}</code></dd></div>
          <div><dt>Minimum risk when triggered</dt><dd>{riskData.line_item_rule.minimum_risk}</dd></div>
        </dl>
        <p className="empty-copy">
          Any single line discounted beyond its own product ceiling raises the whole
          quotation to at least {riskData.line_item_rule.minimum_risk}, even when the
          order-level discount stays under the MEDIUM threshold.
        </p>
      </Panel>
    </div>
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
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('ALL')
  const filteredRequests = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return requests.filter((request) => {
      const matchesRole = role === 'ALL' || request.requestedRole === role
      const matchesQuery =
        !needle ||
        request.fullName.toLowerCase().includes(needle) ||
        request.email.toLowerCase().includes(needle)
      return matchesRole && matchesQuery
    })
  }, [query, requests, role])

  return (
    <Panel title="Account approval requests" description="Review customer registrations and internal role requests before granting access.">
      {loading ? <p className="empty-copy">Loading access requests…</p> : error ? <div className="inline-error">{error}</div> : (
        <>
          <div className="access-request-toolbar">
            <label className="filter-search">
              <Search size={15} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or email"
              />
            </label>
            <label className="access-role-filter">
              <span>Role</span>
              <select value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="ALL">All roles</option>
                {SIGNUP_ROLE_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <small>{filteredRequests.length} of {requests.length} requests</small>
          </div>

          <div className="access-request-list">
          {filteredRequests.map((request) => {
            const isRejecting = rejectionDraft?.id === request.id

            return (
              <article key={request.id} className={isRejecting ? 'is-rejecting' : ''}>
                <span className="request-avatar">{request.fullName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
                <div><strong>{request.fullName}</strong><small>{request.email}</small></div>
                <span><small>Requested role · {request.is_verified ? 'Verified' : 'Unverified'}</small><strong>{getRoleLabel(request.requestedRole)}</strong></span>
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
          {!filteredRequests.length && (
            <p className="empty-copy">
              {requests.length
                ? 'No approval requests match these filters.'
                : 'No pending access requests.'}
            </p>
          )}
          </div>
        </>
      )}
    </Panel>
  )
}

/**
 * Renders one configuration surface, chosen by `section`. Each section is its
 * own route and its own sidebar entry, so this component no longer decides
 * navigation — WorkspaceApp does, and it only reaches here for a section the
 * signed-in role is allowed to open.
 */
export default function ConfigurationPage({ section = 'products' }) {
  const { user } = useWorkspace()
  const activeTab = section
  const copy = CONFIGURATION_SECTIONS[section] ?? CONFIGURATION_SECTIONS.products
  const [rules, setRules] = useState(() => seededDiscountRules.map((rule) => ({
    ...rule,
    persisted: false,
  })))
  const [categoryRules, setCategoryRules] = useState({
    hardware: 15,
    service: 10,
    subscription: 0,
  })
  const [categoryPersisted, setCategoryPersisted] = useState(false)
  const [policyState, setPolicyState] = useState({
    loading: section === 'discounts',
    error: '',
  })
  const [savingTier, setSavingTier] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)
  const [requests, setRequests] = useState([])
  const [requestState, setRequestState] = useState({
    loading: section === 'access',
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

  useEffect(() => {
    if (activeTab !== 'discounts') return
    let mounted = true

    authApi.getDiscountPolicy()
      .then((result) => {
        if (!mounted) return
        const persistedTiers = new Map(
          (result.tier_discounts ?? []).map((item) => [item.tier.toUpperCase(), item]),
        )
        setRules(seededDiscountRules.map((rule) => {
          const saved = persistedTiers.get(rule.tier.toUpperCase())
          return {
            ...rule,
            ceiling: saved?.discount ?? rule.ceiling,
            persisted: Boolean(saved),
          }
        }))

        const savedCategory = result.category_discount
        if (savedCategory) {
          setCategoryRules({
            hardware: savedCategory.hardware,
            service: savedCategory.service,
            subscription: savedCategory.subscription,
          })
          setCategoryPersisted(true)
        } else {
          setCategoryPersisted(false)
        }
        setPolicyState({ loading: false, error: '' })
      })
      .catch((error) => {
        if (mounted) setPolicyState({ loading: false, error: error.message })
      })

    return () => { mounted = false }
  }, [activeTab])

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
      const payload = {
        tier: rule.tier.toUpperCase(),
        discount: rule.ceiling,
      }
      const result = rule.persisted
        ? await authApi.updateTierDiscount(payload)
        : await authApi.createTierDiscount(payload)
      setRules((current) => current.map((item) => item.tier === rule.tier
        ? { ...item, ceiling: result.tier_discount.discount, persisted: true }
        : item))
      toast.success(`${result.tier_discount.tier} tier ${rule.persisted ? 'updated' : 'created'}`, {
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
      const result = categoryPersisted
        ? await authApi.updateCategoryDiscount(categoryRules)
        : await authApi.createCategoryDiscount(categoryRules)
      setCategoryRules({
        hardware: result.category_discount.hardware,
        service: result.category_discount.service,
        subscription: result.category_discount.subscription,
      })
      setCategoryPersisted(true)
      toast.success(`Category discount policy ${categoryPersisted ? 'updated' : 'created'}`)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSavingCategory(false)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
      />

      {activeTab === 'products' && <ProductsConfiguration mode="physical" />}
      {activeTab === 'subscriptions' && <ProductsConfiguration mode="subscription" />}
      {activeTab === 'risk' && <RiskConfiguration />}
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
          categoryPersisted={categoryPersisted}
          policyState={policyState}
        />
      )}
      {activeTab === 'stores' && <WarehouseConfiguration />}
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
