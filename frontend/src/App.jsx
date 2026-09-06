import { useEffect, useState } from 'react'
import { MapPin, Moon, Sun } from 'lucide-react'
import { authApi } from './api/authApi.js'
import {
  CUSTOMER_ROLE_OPTION,
  getRoleLabel,
  INTERNAL_ROLE_OPTIONS,
  SIGNUP_ROLE_OPTIONS,
  USER_ROLES,
} from './contracts/auth.js'
import loginIllustration from './illustrations/login.svg'
import resetIllustration from './illustrations/reset.svg'
import signupIllustration from './illustrations/signup.svg'
import verifyIllustration from './illustrations/verify.svg'
import CustomerPortal from './portal/CustomerPortal.jsx'
import WorkspaceApp from './workspace/WorkspaceApp.jsx'
import './App.css'

const emptyLogin = { email: '', password: '', remember: true }
const emptyRegistration = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
  requestedRole: USER_ROLES.CUSTOMER,
  deliveryAddress: '',
  lat: '',
  long: '',
  acceptTerms: false,
}
const THEME_STORAGE_KEY = 'dealflow.theme'

function readInitialTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark'
      ? 'dark'
      : 'light'
  } catch {
    return 'light'
  }
}

function ThemeToggle({ theme, onToggle }) {
  const dark = theme === 'dark'

  return (
    <button
      className="auth-theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}
      title={`Switch to ${dark ? 'light' : 'dark'} mode`}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
      <span>{dark ? 'Light' : 'Dark'}</span>
    </button>
  )
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span className="brand-mark__bar brand-mark__bar--one" />
      <span className="brand-mark__bar brand-mark__bar--two" />
      <span className="brand-mark__dot" />
    </span>
  )
}

function EyeIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 4 16 16M10.7 7.1A9.8 9.8 0 0 1 12 7c5.8 0 9 5 9 5a14 14 0 0 1-2.1 2.6M8.2 8.2C4.9 9.7 3 12 3 12s3.2 5 9 5c1.1 0 2.1-.2 3-.5M10.2 10.2a2.5 2.5 0 0 0 3.6 3.6" />
    </svg>
  )
}

function StatusIcon({ type }) {
  if (type === 'success') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m7 12.5 3.2 3.2L17.8 8" />
      </svg>
    )
  }

  if (type === 'rejected') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m8 8 8 8M16 8l-8 8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

function AuthAside({ mode, state }) {
  const pending = state === 'pending'
  const rejected = state === 'rejected'
  const authenticated = state === 'authenticated'
  const illustration = pending || rejected
    ? verifyIllustration
    : mode === 'reset'
      ? resetIllustration
      : mode === 'register'
      ? signupIllustration
      : loginIllustration

  return (
    <aside className="auth-aside" aria-label="DealFlow360 platform overview">
      <div className="aside-grid" aria-hidden="true" />
      <div className="aside-content">
        <span className="aside-kicker">
          <span />
          Intelligent sales operations
        </span>
        <h2>
          {pending
            ? 'Your workspace request is moving.'
            : rejected
              ? 'Your administrator left feedback.'
            : mode === 'reset'
              ? 'Choose a new password for your account.'
            : authenticated
              ? 'Access granted. Deals are waiting.'
              : 'Move every deal forward with confidence.'}
        </h2>
        <p>
          Pricing discipline, approvals and fulfilment decisions stay connected from the
          first quote to the final invoice.
        </p>

        <div className="illustration-wrap">
          <div className="illustration-glow" />
          <img src={illustration} alt="" />
        </div>
      </div>
    </aside>
  )
}

function PendingApproval({ request, onBack }) {
  const isCustomer = request.requestedRole === USER_ROLES.CUSTOMER
  const submittedAt = request.submittedAt
    ? new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(request.submittedAt))
    : 'Just now'

  return (
    <div className="state-panel">
      <span className="state-icon state-icon--pending">
        <StatusIcon type="pending" />
      </span>
      <span className="state-eyebrow">Approval pending</span>
      <h1>Your account request is with the administrator.</h1>
      <p className="state-copy">
        {isCustomer
          ? 'You can sign in after your customer account and delivery details are reviewed.'
          : 'We will unlock the internal workspace after your requested role is reviewed.'}
      </p>

      <dl className="request-summary">
        <div>
          <dt>Requested access</dt>
          <dd>{getRoleLabel(request.requestedRole)}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{submittedAt}</dd>
        </div>
      </dl>

      <div className="notice notice--info">
        <span aria-hidden="true">i</span>
        <p>
          You can sign in after approval. No session is created while your request is
          pending.
        </p>
      </div>

      <button className="primary-button" type="button" onClick={onBack}>
        Back to sign in
      </button>
    </div>
  )
}

function RejectedAccess({ rejection, onBack, onRegisterAgain }) {
  const reviewedAt = rejection.reviewedAt
    ? new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(rejection.reviewedAt))
    : 'Recently'

  return (
    <div className="state-panel">
      <span className="state-icon state-icon--danger">
        <StatusIcon type="rejected" />
      </span>
      <span className="state-eyebrow state-eyebrow--danger">Access rejected</span>
      <h1>Your workspace request was not approved.</h1>
      <p className="state-copy">
        Review the administrator feedback below before contacting your organization.
      </p>

      <dl className="request-summary">
        <div>
          <dt>Account</dt>
          <dd>{rejection.email}</dd>
        </div>
        <div>
          <dt>Reviewed</dt>
          <dd>{reviewedAt}</dd>
        </div>
      </dl>

      <div className="notice notice--danger">
        <span aria-hidden="true">!</span>
        <p><strong>Rejection reason</strong>{rejection.reason}</p>
      </div>

      <div className="state-actions">
        <button className="primary-button" type="button" onClick={onRegisterAgain}>
          Register again
        </button>
        <button className="text-button" type="button" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    </div>
  )
}

function PasswordResetComplete({ message, onBack }) {
  return (
    <div className="state-panel">
      <span className="state-icon state-icon--success">
        <StatusIcon type="success" />
      </span>
      <span className="state-eyebrow">Password updated</span>
      <h1>Your password has been reset.</h1>
      <p className="state-copy">{message}</p>
      <button className="primary-button" type="button" onClick={onBack}>
        Sign in with new password
      </button>
    </div>
  )
}

function InternalAuth({ theme, onThemeToggle }) {
  const [resetToken] = useState(() =>
    new URLSearchParams(window.location.search).get('reset_token'),
  )
  const [mode, setMode] = useState(() => (resetToken ? 'reset' : 'login'))
  const [loginForm, setLoginForm] = useState(emptyLogin)
  const [registrationForm, setRegistrationForm] = useState(emptyRegistration)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingRequest, setPendingRequest] = useState(null)
  const [rejectedRequest, setRejectedRequest] = useState(null)
  const [resubmissionContext, setResubmissionContext] = useState(null)
  const [resetForm, setResetForm] = useState({ password: '', confirmPassword: '' })
  const [resetResult, setResetResult] = useState(null)
  const [sessionUser, setSessionUser] = useState(null)

  useEffect(() => {
    let mounted = true
    authApi
      .getCurrentUser()
      .then((result) => {
        if (mounted && result.authenticated) setSessionUser(result.user)
      })
      .catch(() => {
        // A missing/expired session simply leaves the visitor on the sign-in form.
      })

    return () => {
      mounted = false
    }
  }, [])

  const pageState = pendingRequest
    ? 'pending'
    : rejectedRequest
      ? 'rejected'
    : resetResult
      ? 'reset-complete'
    : sessionUser
      ? 'authenticated'
      : 'form'

  function switchMode(nextMode) {
    setMode(nextMode)
    setResetResult(null)
    setRejectedRequest(null)
    setResubmissionContext(null)
    setError('')
    setPasswordVisible(false)
  }

  function updateLogin(event) {
    const { name, value, checked, type } = event.target
    setLoginForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  function updateRegistration(event) {
    const { name, value, checked, type } = event.target
    setRegistrationForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      if (mode === 'reset') {
        if (resetForm.password !== resetForm.confirmPassword) {
          setError('Passwords do not match.')
          return
        }
        const result = await authApi.resetPassword({
          token: resetToken,
          password: resetForm.password,
        })
        setResetResult(result)
        window.history.replaceState({}, '', window.location.pathname)
        return
      }

      if (mode === 'login') {
        const result = await authApi.login(loginForm)
        setSessionUser(result.user)
        return
      }

      if (registrationForm.password !== registrationForm.confirmPassword) {
        setError('Passwords do not match.')
        return
      }

      const requestedRole =
        registrationForm.requestedRole || USER_ROLES.CUSTOMER
      const result = await authApi.register({
        fullName: registrationForm.fullName,
        email: registrationForm.email,
        password: registrationForm.password,
        requestedRole,
        _custom_json:
          requestedRole === USER_ROLES.CUSTOMER
            ? {
                delivery_address: registrationForm.deliveryAddress.trim(),
                lat: Number(registrationForm.lat),
                long: Number(registrationForm.long),
              }
            : null,
      })
      setResubmissionContext(null)
      setPendingRequest(result.request)
    } catch (requestError) {
      if (
        requestError.code === 'ACCOUNT_PENDING_APPROVAL' &&
        requestError.details
      ) {
        setPendingRequest(requestError.details)
      } else if (requestError.code === 'ACCOUNT_REJECTED') {
        setRejectedRequest({
          email: loginForm.email,
          reason: requestError.details?.reason ?? requestError.message,
          reviewedAt: requestError.details?.reviewedAt ?? null,
          requestedRole: requestError.details?.requestedRole,
          fullName: requestError.details?.applicant?.fullName,
        })
      } else {
        setError(requestError.message ?? 'Something went wrong. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleLogout() {
    setBusy(true)
    await authApi.logout()
    setSessionUser(null)
    setBusy(false)
  }

  function backToLogin() {
    const email =
      pendingRequest?.applicant?.email ??
      rejectedRequest?.email ??
      registrationForm.email
    setPendingRequest(null)
    setRejectedRequest(null)
    setResubmissionContext(null)
    setResetResult(null)
    setMode('login')
    setLoginForm((current) => ({ ...current, email, password: '' }))
    setError('')
  }

  function registerAgain() {
    const requestedRole = SIGNUP_ROLE_OPTIONS.some(
      (role) => role.value === rejectedRequest?.requestedRole,
    )
      ? rejectedRequest.requestedRole
      : USER_ROLES.CUSTOMER

    setRegistrationForm({
      ...emptyRegistration,
      fullName: rejectedRequest?.fullName ?? '',
      email: rejectedRequest?.email ?? '',
      requestedRole,
    })
    setResubmissionContext({
      reason: rejectedRequest?.reason,
      reviewedAt: rejectedRequest?.reviewedAt,
    })
    setRejectedRequest(null)
    setMode('register')
    setError('')
    setPasswordVisible(false)
  }

  if (sessionUser) {
    if (sessionUser.role === USER_ROLES.CUSTOMER) {
      return (
        <CustomerPortal
          internalUser={sessionUser}
          onInternalLogout={handleLogout}
          theme={theme}
          onThemeToggle={onThemeToggle}
        />
      )
    }

    return (
      <WorkspaceApp
        user={sessionUser}
        onLogout={handleLogout}
        theme={theme}
        onThemeToggle={onThemeToggle}
      />
    )
  }

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <div className="auth-main">
          <header className="brand">
            <span className="brand-identity">
              <BrandMark />
              <span className="brand-copy">
                <strong>DealFlow</strong>
                <small>Sales operations</small>
              </span>
            </span>
            <ThemeToggle theme={theme} onToggle={onThemeToggle} />
          </header>

          <div className="form-stage">
            {pendingRequest ? (
              <PendingApproval request={pendingRequest} onBack={backToLogin} />
            ) : rejectedRequest ? (
              <RejectedAccess
                rejection={rejectedRequest}
                onBack={backToLogin}
                onRegisterAgain={registerAgain}
              />
            ) : resetResult ? (
              <PasswordResetComplete
                message={resetResult.message}
                onBack={backToLogin}
              />
            ) : (
              <div className="form-panel">
                {mode === 'reset' ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => switchMode('login')}
                  >
                    ← Back to sign in
                  </button>
                ) : (
                  <div className="auth-tabs" role="tablist" aria-label="Authentication">
                    <button
                      className={mode === 'login' ? 'active' : ''}
                      type="button"
                      role="tab"
                      aria-selected={mode === 'login'}
                      onClick={() => switchMode('login')}
                    >
                      Sign in
                    </button>
                    <button
                      className={mode === 'register' ? 'active' : ''}
                      type="button"
                      role="tab"
                      aria-selected={mode === 'register'}
                      onClick={() => switchMode('register')}
                    >
                      Create account
                    </button>
                  </div>
                )}

                <div className="form-heading">
                  <span className="form-eyebrow">
                    {mode === 'login'
                      ? 'Welcome back'
                      : mode === 'reset'
                        ? 'Secure password reset'
                        : 'Join DealFlow360'}
                  </span>
                  <h1>
                    {mode === 'login'
                      ? 'Sign in to move deals forward.'
                      : mode === 'reset'
                        ? 'Create your new password.'
                        : 'Create your DealFlow account.'}
                  </h1>
                  <p>
                    {mode === 'login'
                      ? 'Use the account approved by your DealFlow360 administrator.'
                      : mode === 'reset'
                        ? 'This one-time link can be used once and expires after 15 minutes.'
                        : 'Customer is selected by default. Every new account is reviewed by an administrator before access is granted.'}
                  </p>
                </div>

                <form className="auth-form" onSubmit={handleSubmit}>
                  {mode === 'register' && resubmissionContext && (
                    <div className="notice notice--danger resubmission-notice">
                      <span aria-hidden="true">!</span>
                      <p>
                        <strong>Previous administrator feedback</strong>
                        {resubmissionContext.reason}
                        <small>
                          Update your details below to submit a new request.
                        </small>
                      </p>
                    </div>
                  )}

                  {mode === 'register' && (
                    <label className="field">
                      <span>Full name</span>
                      <input
                        name="fullName"
                        value={registrationForm.fullName}
                        onChange={updateRegistration}
                        autoComplete="name"
                        placeholder="e.g. Aanya Patel"
                        required
                      />
                    </label>
                  )}

                  {mode !== 'reset' && (
                    <label className="field">
                      <span>{mode === 'register' ? 'Email address' : 'Work email'}</span>
                      <input
                        name="email"
                        type="email"
                        value={
                          mode === 'login'
                            ? loginForm.email
                            : registrationForm.email
                        }
                        onChange={
                          mode === 'login'
                            ? updateLogin
                            : updateRegistration
                        }
                        autoComplete="email"
                        placeholder="name@company.com"
                        required
                      />
                    </label>
                  )}

                  <label className="field">
                      <span>Password</span>
                      <span className="password-field">
                        <input
                          name="password"
                          type={passwordVisible ? 'text' : 'password'}
                          value={
                            mode === 'login'
                              ? loginForm.password
                              : mode === 'reset'
                                ? resetForm.password
                              : registrationForm.password
                          }
                          onChange={
                            mode === 'login'
                              ? updateLogin
                              : mode === 'reset'
                                ? (event) => setResetForm((current) => ({
                                    ...current,
                                    password: event.target.value,
                                  }))
                                : updateRegistration
                          }
                          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                          placeholder={mode === 'login' ? 'Enter your password' : 'At least 8 characters'}
                          minLength={8}
                          required
                        />
                        <button
                          type="button"
                          aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                          onClick={() => setPasswordVisible((visible) => !visible)}
                        >
                          <EyeIcon visible={passwordVisible} />
                        </button>
                      </span>
                  </label>

                  {mode === 'reset' && (
                    <label className="field">
                      <span>Confirm new password</span>
                      <input
                        name="confirmPassword"
                        type={passwordVisible ? 'text' : 'password'}
                        value={resetForm.confirmPassword}
                        onChange={(event) => setResetForm((current) => ({
                          ...current,
                          confirmPassword: event.target.value,
                        }))}
                        autoComplete="new-password"
                        placeholder="Repeat your new password"
                        minLength={8}
                        required
                      />
                    </label>
                  )}

                  {mode === 'register' && (
                    <>
                      <label className="field">
                        <span>Confirm password</span>
                        <input
                          name="confirmPassword"
                          type={passwordVisible ? 'text' : 'password'}
                          value={registrationForm.confirmPassword}
                          onChange={updateRegistration}
                          autoComplete="new-password"
                          placeholder="Repeat your password"
                          minLength={8}
                          required
                        />
                      </label>

                      <fieldset className="role-fieldset">
                        <legend>How will you use DealFlow360?</legend>

                        <label
                          className={
                            registrationForm.requestedRole === USER_ROLES.CUSTOMER
                              ? 'role-option role-option--customer selected'
                              : 'role-option role-option--customer'
                          }
                        >
                          <input
                            type="radio"
                            name="requestedRole"
                            value={CUSTOMER_ROLE_OPTION.value}
                            checked={
                              registrationForm.requestedRole === USER_ROLES.CUSTOMER
                            }
                            onChange={updateRegistration}
                          />
                          <span className="role-radio" />
                          <span className="role-option__copy">
                            <span className="role-option__heading">
                              <strong>{CUSTOMER_ROLE_OPTION.label}</strong>
                              <span className="role-default-badge">Default</span>
                            </span>
                            <small>{CUSTOMER_ROLE_OPTION.description}</small>
                          </span>
                        </label>

                        <div className="role-choice-divider">
                          <span>Or request internal team access</span>
                        </div>

                        <div className="role-options">
                          {INTERNAL_ROLE_OPTIONS.map((role) => (
                            <label
                              className={
                                registrationForm.requestedRole === role.value
                                  ? 'role-option selected'
                                  : 'role-option'
                              }
                              key={role.value}
                            >
                              <input
                                type="radio"
                                name="requestedRole"
                                value={role.value}
                                checked={registrationForm.requestedRole === role.value}
                                onChange={updateRegistration}
                              />
                              <span className="role-radio" />
                              <span>
                                <strong>{role.label}</strong>
                                <small>{role.description}</small>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>

                      {registrationForm.requestedRole === USER_ROLES.CUSTOMER && (
                        <section
                          className="customer-details"
                          aria-labelledby="delivery-details-title"
                        >
                          <header>
                            <span className="customer-details__icon" aria-hidden="true">
                              <MapPin size={17} />
                            </span>
                            <span>
                              <strong id="delivery-details-title">Delivery details</strong>
                              <small>Used to find the nearest fulfilment store.</small>
                            </span>
                          </header>

                          <label className="field">
                            <span>Delivery address</span>
                            <textarea
                              name="deliveryAddress"
                              value={registrationForm.deliveryAddress}
                              onChange={updateRegistration}
                              placeholder="Building, street, city, state and postal code"
                              rows={3}
                              required
                            />
                          </label>

                          <div className="customer-coordinate-grid">
                            <label className="field">
                              <span>Latitude</span>
                              <input
                                name="lat"
                                type="number"
                                value={registrationForm.lat}
                                onChange={updateRegistration}
                                placeholder="19.0760"
                                min="-90"
                                max="90"
                                step="any"
                                required
                              />
                            </label>
                            <label className="field">
                              <span>Longitude</span>
                              <input
                                name="long"
                                type="number"
                                value={registrationForm.long}
                                onChange={updateRegistration}
                                placeholder="72.8777"
                                min="-180"
                                max="180"
                                step="any"
                                required
                              />
                            </label>
                          </div>
                        </section>
                      )}
                    </>
                  )}

                  {mode === 'login' && (
                    <div className="form-options">
                      <label className="check-control">
                        <input
                          type="checkbox"
                          name="remember"
                          checked={loginForm.remember}
                          onChange={updateLogin}
                        />
                        <span />
                        Keep me signed in
                      </label>
                    </div>
                  )}

                  {mode === 'register' && (
                    <>
                      <p className="admin-note">
                        Administrator access is provisioned by the organization and cannot
                        be requested here.
                      </p>
                    </>
                  )}

                  {error && (
                    <div className="form-error" role="alert">
                      <span aria-hidden="true">!</span>
                      {error}
                    </div>
                  )}

                  <button className="primary-button" type="submit" disabled={busy}>
                    {busy && <span className="spinner" aria-hidden="true" />}
                    {busy
                      ? mode === 'login'
                        ? 'Checking access…'
                        : mode === 'reset'
                          ? 'Updating password…'
                          : 'Sending request…'
                      : mode === 'login'
                        ? 'Sign in securely'
                        : mode === 'reset'
                          ? 'Set new password'
                          : registrationForm.requestedRole === USER_ROLES.CUSTOMER
                            ? 'Submit customer registration'
                            : 'Submit access request'}
                  </button>
                </form>
              </div>
            )}
          </div>

          <footer className="auth-footer">
            <span>Secure role-based workspace access</span>
            <span>DealFlow360</span>
          </footer>
        </div>

        <AuthAside mode={mode} state={pageState} />
      </section>
    </main>
  )
}

function App() {
  const [theme, setTheme] = useState(readInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // The selected theme remains active for this session if storage is unavailable.
    }
  }, [theme])

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  return window.location.pathname.startsWith('/portal') ? (
    <CustomerPortal theme={theme} onThemeToggle={toggleTheme} />
  ) : (
    <InternalAuth theme={theme} onThemeToggle={toggleTheme} />
  )
}

export default App
