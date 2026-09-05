import { useEffect, useState } from 'react'
import { authApi } from './api/authApi.js'
import {
  getRoleLabel,
  INTERNAL_ROLE_OPTIONS,
  USER_ROLES,
} from './contracts/auth.js'
import forgotIllustration from './illustrations/forgot.svg'
import loginIllustration from './illustrations/login.svg'
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
  requestedRole: USER_ROLES.SALES_REP,
  acceptTerms: false,
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
    : mode === 'forgot'
      ? forgotIllustration
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
            : mode === 'forgot'
              ? 'Recover access without exposing your account.'
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

          <div className="floating-card floating-card--risk">
            <span className="floating-card__label">Blended risk</span>
            <strong>High · 72</strong>
            <span className="risk-line">
              <i />
            </span>
          </div>

          <div className="floating-card floating-card--approval">
            <span className="approval-avatar">MS</span>
            <span>
              <small>Next approval</small>
              <strong>Sales manager</strong>
            </span>
            <span className="approval-state">Pending</span>
          </div>
        </div>

        <div className="aside-points">
          <span>Live margin intelligence</span>
          <span>Policy-led approvals</span>
          <span>Complete audit trail</span>
        </div>
      </div>
    </aside>
  )
}

function PendingApproval({ request, onBack }) {
  const requestId = request.id ?? request.requestId
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
      <h1>Your request is with the administrator.</h1>
      <p className="state-copy">
        We will unlock the internal workspace after your requested role is reviewed.
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
        <div>
          <dt>Request ID</dt>
          <dd>{requestId}</dd>
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
        <p><strong>Administrator reason</strong>{rejection.reason}</p>
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

function PasswordResetRequested({ email, message, onBack }) {
  return (
    <div className="state-panel">
      <span className="state-icon state-icon--success">
        <StatusIcon type="success" />
      </span>
      <span className="state-eyebrow">Request accepted</span>
      <h1>Password reset request accepted.</h1>
      <p className="state-copy">{message}</p>

      <dl className="request-summary">
        <div>
          <dt>Email address</dt>
          <dd>{email}</dd>
        </div>
      </dl>

      <div className="notice notice--info">
        <span aria-hidden="true">i</span>
        <p>For security, we show the same result whether or not the account exists.</p>
      </div>

      <button className="primary-button" type="button" onClick={onBack}>
        Back to sign in
      </button>
    </div>
  )
}

function InternalAuth() {
  const [mode, setMode] = useState('login')
  const [loginForm, setLoginForm] = useState(emptyLogin)
  const [registrationForm, setRegistrationForm] = useState(emptyRegistration)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingRequest, setPendingRequest] = useState(null)
  const [rejectedRequest, setRejectedRequest] = useState(null)
  const [resubmissionContext, setResubmissionContext] = useState(null)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotResult, setForgotResult] = useState(null)
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
    : forgotResult
      ? 'reset-requested'
    : sessionUser
      ? 'authenticated'
      : 'form'

  function switchMode(nextMode) {
    if (nextMode === 'forgot' && !forgotEmail) {
      setForgotEmail(loginForm.email)
    }
    setMode(nextMode)
    setForgotResult(null)
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
      if (mode === 'forgot') {
        const result = await authApi.forgotPassword({ email: forgotEmail })
        setForgotResult({ email: forgotEmail, message: result.message })
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

      const result = await authApi.register({
        fullName: registrationForm.fullName,
        email: registrationForm.email,
        password: registrationForm.password,
        requestedRole: registrationForm.requestedRole,
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
      forgotResult?.email ??
      registrationForm.email
    setPendingRequest(null)
    setRejectedRequest(null)
    setResubmissionContext(null)
    setForgotResult(null)
    setMode('login')
    setLoginForm((current) => ({ ...current, email, password: '' }))
    setError('')
  }

  function registerAgain() {
    const requestedRole = INTERNAL_ROLE_OPTIONS.some(
      (role) => role.value === rejectedRequest?.requestedRole,
    )
      ? rejectedRequest.requestedRole
      : USER_ROLES.SALES_REP

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
    return <WorkspaceApp user={sessionUser} onLogout={handleLogout} />
  }

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <div className="auth-main">
          <header className="brand">
            <BrandMark />
            <span className="brand-copy">
              <strong>DealFlow</strong>
              <small>Sales operations</small>
            </span>
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
            ) : forgotResult ? (
              <PasswordResetRequested
                email={forgotResult.email}
                message={forgotResult.message}
                onBack={backToLogin}
              />
            ) : (
              <div className="form-panel">
                {mode === 'forgot' ? (
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
                      Request access
                    </button>
                  </div>
                )}

                <div className="form-heading">
                  <span className="form-eyebrow">
                    {mode === 'login'
                      ? 'Welcome back'
                      : mode === 'forgot'
                        ? 'Account recovery'
                        : 'Join your sales team'}
                  </span>
                  <h1>
                    {mode === 'login'
                      ? 'Sign in to move deals forward.'
                      : mode === 'forgot'
                        ? 'Reset your password securely.'
                        : 'Request your workspace role.'}
                  </h1>
                  <p>
                    {mode === 'login'
                      ? 'Use the account approved by your DealFlow360 administrator.'
                      : mode === 'forgot'
                        ? 'Enter your work email and we will accept a password reset request without revealing whether the account exists.'
                        : 'An administrator reviews every internal account before access is granted.'}
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

                  <label className="field">
                    <span>Work email</span>
                    <input
                      name="email"
                      type="email"
                      value={
                        mode === 'login'
                          ? loginForm.email
                          : mode === 'forgot'
                            ? forgotEmail
                            : registrationForm.email
                      }
                      onChange={
                        mode === 'login'
                          ? updateLogin
                          : mode === 'forgot'
                            ? (event) => setForgotEmail(event.target.value)
                            : updateRegistration
                      }
                      autoComplete="email"
                      placeholder="name@company.com"
                      required
                    />
                  </label>

                  {mode !== 'forgot' && (
                    <label className="field">
                      <span>Password</span>
                      <span className="password-field">
                        <input
                          name="password"
                          type={passwordVisible ? 'text' : 'password'}
                          value={
                            mode === 'login'
                              ? loginForm.password
                              : registrationForm.password
                          }
                          onChange={mode === 'login' ? updateLogin : updateRegistration}
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
                        <legend>Requested role</legend>
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
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => switchMode('forgot')}
                      >
                        Forgot password?
                      </button>
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
                        : mode === 'forgot'
                          ? 'Submitting request…'
                          : 'Sending request…'
                      : mode === 'login'
                        ? 'Sign in securely'
                        : mode === 'forgot'
                          ? 'Request password reset'
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
  return window.location.pathname.startsWith('/portal') ? (
    <CustomerPortal />
  ) : (
    <InternalAuth />
  )
}

export default App
