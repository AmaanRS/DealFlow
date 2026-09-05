# DealFlow360 authentication API contract

Version: `v1`  
Frontend owner: React client  
Backend owner: Authentication service  
Gateway: Apache APISIX

This is the frontend/API gateway handoff contract. The frontend already uses these paths and response shapes through `src/api/authApi.js`.

## 1. Required business rules

1. The initial administrator is created from a server-side seed or deployment secret. An administrator account cannot be requested through public registration.
2. Registration sends a `requestedRole`; it does not grant that role.
3. A pending user has `role: null` and `status: "PENDING_APPROVAL"`.
4. Only an active administrator can approve or reject registrations.
5. Approval atomically sets `role = requestedRole`, `status = "ACTIVE"`, and reviewer metadata.
6. Rejection leaves `role: null` and sets `status = "REJECTED"`.
7. Pending, rejected, and suspended users never receive an authenticated session.
8. Store only a strong password hash (Argon2id or bcrypt), never the original password.
9. Send authentication in a Secure, HttpOnly cookie. Do not return a bearer token for local storage.

## 2. Shared enums and errors

Roles:

```json
["ADMIN", "SALES_REP", "SALES_MANAGER", "FINANCE_OPERATIONS"]
```

Only the final three values are valid during public registration.

Statuses:

```json
["PENDING_APPROVAL", "ACTIVE", "REJECTED", "SUSPENDED"]
```

Every non-2xx JSON response uses this envelope:

```json
{
  "code": "STABLE_MACHINE_READABLE_CODE",
  "message": "Safe message that can be shown to the user",
  "fields": {
    "email": "Optional field-level validation message"
  },
  "details": {}
}
```

`fields` and `details` are optional. Never include a stack trace, database error, password hash, or secret.

## 3. Public authentication endpoints

### Register an internal user

`POST /api/v1/auth/registrations`

Request:

```json
{
  "fullName": "Aanya Patel",
  "email": "aanya@company.com",
  "password": "correct horse battery staple",
  "requestedRole": "SALES_REP"
}
```

Success: `202 Accepted`

```json
{
  "request": {
    "id": "usr_01J7W9R2K9PX2",
    "status": "PENDING_APPROVAL",
    "requestedRole": "SALES_REP",
    "submittedAt": "2026-09-05T10:30:00.000Z",
    "applicant": {
      "fullName": "Aanya Patel",
      "email": "aanya@company.com"
    }
  },
  "message": "Your access request has been sent to an administrator."
}
```

Expected errors:

- `400 VALIDATION_ERROR` with `fields` for invalid name, email, or password.
- `400 INVALID_ROLE` for a non-requestable role, including `ADMIN`.
- `409 EMAIL_ALREADY_REGISTERED` when the normalized email already exists.
- `429 RATE_LIMITED` when attempts exceed the gateway/application limit.

Trim and lowercase emails before the unique check. Create the user and approval metadata in one database write.

### Sign in

`POST /api/v1/auth/login`

Request:

```json
{
  "email": "aanya@company.com",
  "password": "correct horse battery staple",
  "remember": true
}
```

Success: `200 OK`

```json
{
  "user": {
    "id": "usr_01J7W9R2K9PX2",
    "fullName": "Aanya Patel",
    "email": "aanya@company.com",
    "role": "SALES_REP",
    "status": "ACTIVE"
  },
  "session": {
    "expiresAt": "2026-09-12T10:30:00.000Z"
  }
}
```

Also send a cookie similar to:

```http
Set-Cookie: dealflow_session=<opaque-session-id>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800
```

For local HTTP development, omit `Secure`; enable it whenever HTTPS is used. `remember: false` should create a short session cookie without persistent `Max-Age`. Use a random, revocable opaque session value and store only its hash in the database.

Invalid credentials: `401 Unauthorized`

```json
{
  "code": "INVALID_CREDENTIALS",
  "message": "Email or password is incorrect."
}
```

Pending account: `403 Forbidden`

```json
{
  "code": "ACCOUNT_PENDING_APPROVAL",
  "message": "Your access request is still waiting for administrator approval.",
  "details": {
    "requestId": "usr_01J7W9R2K9PX2",
    "requestedRole": "SALES_REP",
    "submittedAt": "2026-09-05T10:30:00.000Z",
    "applicant": {
      "fullName": "Aanya Patel",
      "email": "aanya@company.com"
    }
  }
}
```

Other `403` codes are `ACCOUNT_REJECTED` and `ACCOUNT_SUSPENDED`. Rate-limit attempts by both IP and normalized email.

### Read the current user

`GET /api/v1/auth/me`

Authenticated response: `200 OK`

```json
{
  "authenticated": true,
  "user": {
    "id": "usr_01J7W9R2K9PX2",
    "fullName": "Aanya Patel",
    "email": "aanya@company.com",
    "role": "SALES_REP",
    "status": "ACTIVE"
  }
}
```

No valid session: `200 OK`

```json
{
  "authenticated": false,
  "user": null
}
```

This lets React restore the user after a refresh without reading the HttpOnly cookie.

### Sign out

`POST /api/v1/auth/logout`

Success: `204 No Content`. Revoke the server-side session and expire the cookie using the same Path, SameSite, and domain attributes used at creation.

For cookie authentication, protect state-changing endpoints against CSRF. SameSite=Lax, an allowed-origin check, and a CSRF token are the safer general setup.

## 4. Administrator endpoints

Both endpoints require an authenticated `ADMIN`. Return `401` for no session and `403 FORBIDDEN` for an authenticated non-admin.

### List registration requests

`GET /api/v1/admin/registration-requests?status=PENDING_APPROVAL`

Success: `200 OK`

```json
{
  "items": [
    {
      "id": "usr_01J7W9R2K9PX2",
      "fullName": "Aanya Patel",
      "email": "aanya@company.com",
      "role": null,
      "requestedRole": "SALES_REP",
      "status": "PENDING_APPROVAL",
      "approval": {
        "requestedAt": "2026-09-05T10:30:00.000Z",
        "reviewedAt": null,
        "reviewedByUserId": null,
        "reason": null
      }
    }
  ],
  "page": {
    "cursor": null,
    "hasMore": false
  }
}
```

The first hackathon version may omit cursor pagination, but must keep the `items` array.

### Approve or reject a request

`PATCH /api/v1/admin/registration-requests/:requestId`

Approve:

```json
{
  "decision": "APPROVE"
}
```

Reject:

```json
{
  "decision": "REJECT",
  "reason": "The employee record could not be verified."
}
```

Success: `200 OK`

```json
{
  "user": {
    "id": "usr_01J7W9R2K9PX2",
    "fullName": "Aanya Patel",
    "email": "aanya@company.com",
    "role": "SALES_REP",
    "requestedRole": "SALES_REP",
    "status": "ACTIVE",
    "approval": {
      "requestedAt": "2026-09-05T10:30:00.000Z",
      "reviewedAt": "2026-09-05T10:42:00.000Z",
      "reviewedByUserId": "usr_admin_seed",
      "reason": null
    }
  }
}
```

Expected errors are `400 INVALID_DECISION`, `404 REQUEST_NOT_FOUND`, and `409 REQUEST_ALREADY_REVIEWED`. Make this update atomic: filter by both ID and `status: "PENDING_APPROVAL"` so two admin clicks cannot review the same request. Record an audit event in the same transaction when supported.

## 5. Customer portal endpoints

Customer access is separate from internal employee authentication. A quotation invitation is exchanged for a short-lived `dealflow_portal_session` HttpOnly cookie. That cookie contains no internal role and cannot call `/api/v1/admin/*`.

### Exchange an invitation

`POST /api/v1/portal/session`

```json
{
  "accessToken": "a-long-random-invitation-token"
}
```

Success: `200 OK`, plus an HttpOnly `dealflow_portal_session` cookie.

```json
{
  "authenticated": true,
  "customer": {
    "name": "Acme Corporation",
    "email": "procurement@acme.example"
  },
  "quotation": {
    "id": "quote_acme_demo",
    "reference": "Q-2026-0042"
  },
  "expiresAt": "2026-09-05T12:00:00.000Z"
}
```

The raw token is accepted from the URL fragment (`/portal#token=...`) and is removed from the address bar immediately after exchange. The server stores only its HMAC hash.

### Restore and end a portal session

- `GET /api/v1/portal/session` returns the same authenticated customer/quotation shape, or `{ "authenticated": false }`.
- `POST /api/v1/portal/logout` revokes the server-side session and clears the portal cookie.

### Create a quotation invitation

`POST /api/v1/portal/invitations` requires an active internal `ADMIN`, `SALES_REP`, or `SALES_MANAGER` session.

```json
{
  "quotationId": "quote_123",
  "quotationReference": "Q-2026-0043",
  "customerName": "Acme Corporation",
  "customerEmail": "procurement@acme.example",
  "expiresInHours": 72
}
```

The response contains a one-time-visible `accessUrl`. Sending the link by email belongs to the mail/notification service, not this endpoint.

### Validate quotation scope

`GET /api/v1/portal/quotation-access` requires the portal cookie and returns only that invitation's `quotationId` and allowed actions:

```json
{
  "quotationId": "quote_123",
  "scope": [
    "quotation:read",
    "quotation:comment",
    "quotation:counter",
    "quotation:confirm"
  ]
}
```

Every future quotation read, comment, counter-offer, and confirmation endpoint must compare its route quotation ID with the portal session's `quotationId`.

## 6. Recommended MongoDB collections

### `users`

Keep bounded user-owned authentication/profile fields together:

```js
{
  _id: ObjectId,
  fullName: String,
  email: String,
  emailLower: String, // unique index
  passwordHash: String,
  role: null | "ADMIN" | "SALES_REP" | "SALES_MANAGER" | "FINANCE_OPERATIONS",
  requestedRole: "ADMIN" | "SALES_REP" | "SALES_MANAGER" | "FINANCE_OPERATIONS",
  status: "PENDING_APPROVAL" | "ACTIVE" | "REJECTED" | "SUSPENDED",
  approval: {
    requestedAt: Date | null,
    reviewedAt: Date | null,
    reviewedByUserId: ObjectId | "SYSTEM" | null,
    reason: String | null
  },
  profile: {
    department: String | null,
    title: String | null,
    avatarUrl: String | null
  },
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

```js
db.users.createIndex({ emailLower: 1 }, { unique: true })
db.users.createIndex({ status: 1, "approval.requestedAt": -1 })
```

Embedding the small `approval` and `profile` objects is appropriate because they are bounded and read with the user. Do not embed deals, quotations, approval histories, notifications, or audit events in the user document; those lists grow without a fixed bound and duplicate business data.

Use references in separate collections:

```js
quotes.createdByUserId
approvalRequests.assignedToUserId
approvalRequests.reviewedByUserId
auditEvents.actorUserId
sessions.userId
```

### `sessions`

```js
{
  _id: ObjectId,
  tokenHash: String, // unique; never store the raw cookie value
  userId: ObjectId,
  createdAt: Date,
  expiresAt: Date, // TTL index
  revokedAt: Date | null,
  lastSeenAt: Date,
  userAgent: String | null,
  ipHash: String | null
}
```

### `portalinvitations`

Stores only the invitation-token hash, customer snapshot, quotation reference, expiry/revocation state, and creator. The raw token is returned only when the invitation is created.

The `sessions` collection stores both internal and customer sessions with an explicit `kind`. Internal sessions reference a user; customer sessions reference a portal invitation and copy its quotation ID for authorization checks.

## 7. APISIX placement

```text
React browser -> Apache APISIX -> API gateway service -> MongoDB
```

Use APISIX initially for routing, TLS termination, CORS, request IDs, access logs, and rate limiting. The API gateway service remains responsible for registration, password verification, approval state, RBAC, session creation/revocation, CSRF checks, database writes, and audit records.

Do not add APISIX OAuth/OIDC plugins merely because the app has a login screen. Those plugins are useful when APISIX validates tokens issued by a separate identity provider such as Keycloak, Auth0, or Google. For this email/password plus admin-approval flow, application-owned HttpOnly sessions are simpler and easier to explain.

APISIX must forward the Cookie header, must not cache auth responses, and should restrict credentialed CORS to the frontend origin.

## 8. Frontend adapter and isolated mock mode

React imports one adapter from `src/api/authApi.js`, so screens do not know whether the response came from the mock or API gateway.

The normal frontend always calls this contract with `credentials: "include"`:

```env
VITE_USE_MOCK_AUTH=false
```

Set `VITE_USE_MOCK_AUTH=true` only for isolated frontend development when the API gateway is intentionally unavailable. Mock mode is never named or exposed in the rendered product UI.

The mock stores only fake demo records in browser local storage so an in-progress demo can survive refreshes. It includes plain mock passwords and must never be copied into production code or used with real credentials.

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@dealflow360.local` | `Admin@360` |
| Sales representative | `rep@dealflow360.local` | `Demo@360` |
| Sales manager | `manager@dealflow360.local` | `Demo@360` |
| Finance & operations | `finance@dealflow360.local` | `Demo@360` |

## 9. Backend completion checklist

- Seed exactly one initial admin from deployment configuration.
- Validate and normalize every input on the server.
- Hash passwords before saving.
- Implement the internal, administrator, and customer-portal endpoint shapes in this document.
- Make approval/rejection atomic and write audit events.
- Issue revocable HttpOnly cookie sessions and add CSRF protection.
- Add login and registration rate limits.
- Never trust a role sent by React after registration; read the effective role from the database/session.
- Configure APISIX to forward cookies and never cache auth routes.
- Test pending, approved, rejected, duplicate-review, expired-session, and non-admin cases.
