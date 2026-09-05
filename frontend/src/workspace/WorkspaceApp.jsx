import { lazy, Suspense, useState } from 'react'
import {
  BadgeIndianRupee,
  Boxes,
  Building2,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardCheck,
  FileChartColumn,
  FileText,
  KanbanSquare,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  UserRoundCheck,
  X,
} from 'lucide-react'
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { Toaster, toast } from 'sonner'
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext.jsx'
import { Avatar } from './components/Ui.jsx'
import './Workspace.css'

const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage.jsx'))
const BillingPage = lazy(() => import('./pages/BillingPage.jsx'))
const ConfigurationPage = lazy(() => import('./pages/ConfigurationPage.jsx'))
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'))
const FulfillmentPage = lazy(() => import('./pages/FulfillmentPage.jsx'))
const PipelinePage = lazy(() => import('./pages/PipelinePage.jsx'))
const QuotationBuilderPage = lazy(() => import('./pages/QuotationBuilderPage.jsx'))
const QuotationsPage = lazy(() => import('./pages/QuotationsPage.jsx'))
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'))

const navigation = [
  {
    label: 'Overview',
    links: [{ to: '/dashboard', label: 'Deal health', icon: ChartNoAxesCombined }],
  },
  {
    label: 'Sales workspace',
    links: [
      { to: '/quotations', label: 'Quotations', icon: FileText },
      { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
      { to: '/approvals', label: 'Approvals', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Operations',
    links: [
      { to: '/fulfillment', label: 'Fulfillment', icon: Boxes },
      { to: '/billing', label: 'Billing', icon: BadgeIndianRupee },
    ],
  },
  {
    label: 'Manage',
    links: [
      { to: '/configuration', label: 'Configuration', icon: Settings2 },
      { to: '/reports', label: 'Reports', icon: FileChartColumn },
    ],
  },
  {
    label: 'Administration',
    links: [
      {
        to: '/admin/users',
        label: 'User approvals',
        icon: UserRoundCheck,
        roles: ['ADMIN'],
      },
    ],
  },
]

const routeTitles = {
  dashboard: 'Deal health',
  quotations: 'Quotations',
  pipeline: 'Sales pipeline',
  approvals: 'Discount approvals',
  fulfillment: 'Warehouse fulfillment',
  billing: 'Subscriptions & billing',
  configuration: 'Back-end configuration',
  admin: 'User administration',
  reports: 'Sales reporting',
}

function BrandMark() {
  return (
    <span className="workspace-brand__mark" aria-hidden="true">
      <i />
      <i />
      <b />
    </span>
  )
}

function WorkspaceShell({ onLogout }) {
  const { user, createQuote } = useWorkspace()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const section = location.pathname.split('/')[1] || 'dashboard'

  function startQuote() {
    const id = createQuote()
    navigate(`/quotations/${id}`)
    toast.success('Quotation draft created')
  }

  function syncData() {
    toast.success('Pricing, stock and approval data are up to date', {
      description: 'Last synchronized just now.',
    })
  }

  async function closeWorkspace() {
    await onLogout()
    navigate('/')
  }

  return (
    <div className="workspace-root">
      <aside className={`workspace-sidebar ${mobileNavOpen ? 'is-open' : ''}`}>
        <div className="workspace-sidebar__top">
          <a className="workspace-brand" href="/dashboard">
            <BrandMark />
            <span>
              <strong>DealFlow</strong>
              <small>Sales operations</small>
            </span>
          </a>
          <button
            type="button"
            className="icon-button workspace-sidebar__close"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={19} />
          </button>
        </div>

        <nav className="workspace-nav" aria-label="Main navigation">
          {navigation.map((group) => {
            const visibleLinks = group.links.filter(
              ({ roles }) => !roles || roles.includes(user.role),
            )
            if (!visibleLinks.length) return null

            return (
              <div className="workspace-nav__group" key={group.label}>
                <span>{group.label}</span>
                {visibleLinks.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => (isActive ? 'active' : '')}
                    onClick={() => setMobileNavOpen(false)}
                  >
                    <Icon size={17} strokeWidth={1.9} />
                    {label}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="workspace-sidebar__actions">
          {/* <button type="button" onClick={()=> setCount(counts + 1)}>
           +
          </button>
          <span>Count {counts}</span>
          <button type="button" onClick={()=> setCount(counts - 1)}>
           -
          </button> */}
          <button type="button" onClick={syncData}>
            <RefreshCw size={16} />
            Reload data
          </button>
          <button type="button" onClick={() => navigate('/configuration')}>
            <Building2 size={16} />
            Go to back-end
          </button>
          <button type="button" onClick={closeWorkspace}>
            <LogOut size={16} />
            Close workspace
          </button>
        </div>

        <div className="workspace-user">
          <Avatar name={user.fullName} />
          <span>
            <strong>{user.fullName}</strong>
            <small>{user.role?.replaceAll('_', ' ')}</small>
          </span>
          <ChevronDown size={15} />
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          className="workspace-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <div className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-topbar__title">
            <button
              type="button"
              className="icon-button workspace-menu-button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span>DealFlow360</span>
            <strong>{routeTitles[section] ?? 'Workspace'}</strong>
          </div>

          <div className="workspace-topbar__actions">
            <label className="workspace-search">
              <Search size={16} />
              <input placeholder="Search quotes, customers…" aria-label="Search workspace" />
              <kbd>⌘ K</kbd>
            </label>
            <button className="workspace-new-button" type="button" onClick={startQuote}>
              <Plus size={17} />
              <span>New quotation</span>
            </button>
          </div>
        </header>

        <div className="workspace-content">
          <Suspense fallback={<div className="workspace-loading"><span /> Loading workspace…</div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/quotations" element={<QuotationsPage />} />
              <Route path="/quotations/:quoteId" element={<QuotationBuilderPage />} />
              <Route path="/pipeline" element={<PipelinePage />} />
              <Route path="/approvals" element={<ApprovalsPage />} />
              <Route path="/approvals/:quoteId" element={<ApprovalsPage />} />
              <Route path="/fulfillment" element={<FulfillmentPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/configuration" element={<ConfigurationPage />} />
              <Route
                path="/admin/users"
                element={
                  user.role === 'ADMIN'
                    ? <ConfigurationPage initialTab="access" />
                    : <Navigate to="/dashboard" replace />
                }
              />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>
      <Toaster
        position="top-right"
        theme="dark"
        richColors
        toastOptions={{ className: 'dealflow-toast' }}
      />
    </div>
  )
}

export default function WorkspaceApp({ user, onLogout }) {
  return (
    <BrowserRouter>
      <WorkspaceProvider user={user}>
        <WorkspaceShell onLogout={onLogout} />
      </WorkspaceProvider>
    </BrowserRouter>
  )
}
