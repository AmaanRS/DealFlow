import { lazy, Suspense, useState } from 'react'
import {
  BadgeIndianRupee,
  BadgePercent,
  Boxes,
  ChartNoAxesCombined,
  ClipboardCheck,
  FileText,
  LogOut,
  Menu,
  Moon,
  PackagePlus,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sun,
  UserRoundCheck,
  Warehouse,
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
import { Toaster } from 'sonner'
import { USER_ROLES } from '../contracts/auth.js'
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext.jsx'
import { Avatar } from './components/Ui.jsx'
import './Workspace.css'

const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage.jsx'))
const BillingPage = lazy(() => import('./pages/BillingPage.jsx'))
const ConfigurationPage = lazy(() => import('./pages/ConfigurationPage.jsx'))
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'))
const FulfillmentPage = lazy(() => import('./pages/FulfillmentPage.jsx'))
const QuotationBuilderPage = lazy(() => import('./pages/QuotationBuilderPage.jsx'))
const QuotationsPage = lazy(() => import('./pages/QuotationsPage.jsx'))

/**
 * Every configuration surface is a first-class sidebar entry rather than a tab
 * inside one page, so an administrator's whole navigation is a list of screens
 * backed by live endpoints. `section` is the prop handed to ConfigurationPage.
 */
const CONFIGURATION_LINKS = [
  {
    to: '/configuration/products',
    section: 'products',
    label: 'Products & inventory',
    icon: PackagePlus,
    roles: [USER_ROLES.ADMIN],
  },
  {
    to: '/configuration/subscriptions',
    section: 'subscriptions',
    label: 'Subscriptions',
    icon: RefreshCw,
    roles: [USER_ROLES.ADMIN],
  },
  {
    to: '/configuration/stores',
    section: 'stores',
    label: 'Stores',
    icon: Warehouse,
    roles: [USER_ROLES.ADMIN],
  },
  {
    to: '/configuration/discounts',
    section: 'discounts',
    label: 'Discount policy',
    icon: BadgePercent,
    roles: [USER_ROLES.ADMIN, USER_ROLES.MANAGER],
  },
  {
    to: '/configuration/risk',
    section: 'risk',
    label: 'Risk thresholds',
    icon: ShieldAlert,
    roles: [USER_ROLES.ADMIN],
  },
]

const navigation = [
  {
    label: 'Overview',
    links: [{
      to: '/dashboard',
      label: 'Overview',
      icon: ChartNoAxesCombined,
      roles: [USER_ROLES.SALES_REP, USER_ROLES.MANAGER],
    }],
  },
  {
    label: 'Sales workspace',
    links: [
      {
        to: '/quotations',
        label: 'Quotations',
        icon: FileText,
        roles: [USER_ROLES.SALES_REP],
      },
      {
        to: '/approvals',
        label: 'Approvals',
        icon: ClipboardCheck,
        roles: [USER_ROLES.MANAGER, USER_ROLES.FINANCE],
      },
    ],
  },
  {
    label: 'Operations',
    links: [
      {
        to: '/fulfillment',
        label: 'Fulfillment',
        icon: Boxes,
        roles: [USER_ROLES.SALES_REP, USER_ROLES.FINANCE],
      },
      {
        to: '/billing',
        label: 'Billing',
        icon: BadgeIndianRupee,
        roles: [USER_ROLES.FINANCE],
      },
    ],
  },
  {
    label: 'Sales back-end',
    links: CONFIGURATION_LINKS,
  },
  {
    label: 'Administration',
    links: [
      {
        to: '/admin/users',
        label: 'Access requests',
        icon: UserRoundCheck,
        roles: [USER_ROLES.ADMIN],
      },
    ],
  },
]

const routeTitles = {
  dashboard: 'Overview',
  quotations: 'Quotations',
  approvals: 'Discount approvals',
  fulfillment: 'Warehouse fulfillment',
  billing: 'Subscriptions & billing',
  configuration: 'Back-end configuration',
  admin: 'Access requests',
}

const routeRoles = {
  dashboard: [USER_ROLES.SALES_REP, USER_ROLES.MANAGER],
  quotations: [USER_ROLES.SALES_REP],
  approvals: [USER_ROLES.MANAGER, USER_ROLES.FINANCE],
  fulfillment: [USER_ROLES.SALES_REP, USER_ROLES.FINANCE],
  billing: [USER_ROLES.FINANCE],
  admin: [USER_ROLES.ADMIN],
}

const homeByRole = {
  [USER_ROLES.ADMIN]: '/configuration/products',
  [USER_ROLES.MANAGER]: '/dashboard',
  [USER_ROLES.FINANCE]: '/approvals',
  [USER_ROLES.SALES_REP]: '/dashboard',
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

function WorkspaceShell({ onLogout, theme, onThemeToggle }) {
  const { user, createQuote } = useWorkspace()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const section = location.pathname.split('/')[1] || 'dashboard'
  const homePath = homeByRole[user.role] ?? '/dashboard'
  const canCreateQuote = user.role === USER_ROLES.SALES_REP
  const routeAllowed = (route) => routeRoles[route]?.includes(user.role)
  const configurationLinks = CONFIGURATION_LINKS.filter((link) =>
    link.roles.includes(user.role),
  )
  // Configuration routes all share the same first path segment, so the topbar
  // title comes from the matched sidebar entry instead of the segment.
  const pageTitle =
    CONFIGURATION_LINKS.find((link) => link.to === location.pathname)?.label ??
    routeTitles[section] ??
    'Workspace'

  function startQuote() {
    const id = createQuote()
    navigate(`/quotations/${id}`)
  }

  async function closeWorkspace() {
    await onLogout()
    navigate('/')
  }

  return (
    <div className="workspace-root">
      <aside className={`workspace-sidebar ${mobileNavOpen ? 'is-open' : ''}`}>
        <div className="workspace-sidebar__top">
          <NavLink className="workspace-brand" to={homePath}>
            <BrandMark />
            <span>
              <strong>DealFlow</strong>
              <small>Sales operations</small>
            </span>
          </NavLink>
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
              ({ roles }) => roles.includes(user.role),
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
          <button type="button" onClick={closeWorkspace}>
            <LogOut size={16} />
            Log out
          </button>
        </div>

        <div className="workspace-user">
          <Avatar name={user.fullName} />
          <span>
            <strong>{user.fullName}</strong>
            <small>{user.role?.replaceAll('_', ' ')}</small>
          </span>
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
            {!mobileNavOpen && (
              <button
                type="button"
                className="icon-button workspace-menu-button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
              >
                <Menu size={20} />
              </button>
            )}
            <span>DealFlow360</span>
            <strong>{pageTitle}</strong>
          </div>

          <div className="workspace-topbar__actions">
            <button
              className="workspace-theme-toggle"
              type="button"
              onClick={onThemeToggle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
            {canCreateQuote && (
              <button className="workspace-new-button" type="button" onClick={startQuote}>
                <Plus size={17} />
                <span>New quotation</span>
              </button>
            )}
          </div>
        </header>

        <div className="workspace-content">
          <Suspense fallback={<div className="workspace-loading"><span /> Loading workspace…</div>}>
            <Routes>
              <Route path="/" element={<Navigate to={homePath} replace />} />
              <Route path="/dashboard" element={routeAllowed('dashboard') ? <DashboardPage /> : <Navigate to={homePath} replace />} />
              <Route path="/quotations" element={routeAllowed('quotations') ? <QuotationsPage /> : <Navigate to={homePath} replace />} />
              <Route path="/quotations/:quoteId" element={routeAllowed('quotations') ? <QuotationBuilderPage /> : <Navigate to={homePath} replace />} />
              <Route path="/approvals" element={routeAllowed('approvals') ? <ApprovalsPage /> : <Navigate to={homePath} replace />} />
              <Route path="/approvals/:quoteId" element={routeAllowed('approvals') ? <ApprovalsPage /> : <Navigate to={homePath} replace />} />
              <Route path="/fulfillment" element={routeAllowed('fulfillment') ? <FulfillmentPage /> : <Navigate to={homePath} replace />} />
              <Route path="/billing" element={routeAllowed('billing') ? <BillingPage /> : <Navigate to={homePath} replace />} />
              {/* One route per configuration surface, each gated by the same
                  role list that decides whether its sidebar entry is rendered. */}
              <Route
                path="/configuration"
                element={<Navigate to={configurationLinks[0]?.to ?? homePath} replace />}
              />
              {CONFIGURATION_LINKS.map(({ to, section: configSection, roles }) => (
                <Route
                  key={to}
                  path={to}
                  element={roles.includes(user.role)
                    ? <ConfigurationPage section={configSection} />
                    : <Navigate to={homePath} replace />}
                />
              ))}
              <Route
                path="/admin/users"
                element={routeAllowed('admin')
                  ? <ConfigurationPage section="access" />
                  : <Navigate to={homePath} replace />}
              />
              <Route path="*" element={<Navigate to={homePath} replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>
      <Toaster
        position="top-right"
        theme={theme}
        richColors
        toastOptions={{ className: 'dealflow-toast' }}
      />
    </div>
  )
}

export default function WorkspaceApp({ user, onLogout, theme, onThemeToggle }) {
  return (
    <BrowserRouter>
      <WorkspaceProvider user={user}>
        <WorkspaceShell
          onLogout={onLogout}
          theme={theme}
          onThemeToggle={onThemeToggle}
        />
      </WorkspaceProvider>
    </BrowserRouter>
  )
}
