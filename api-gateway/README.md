# DealFlow API gateway service

This service owns internal registration/login, administrator approval, revocable
HttpOnly sessions, and quotation-scoped customer portal invitations.

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

MongoDB must be available at the configured `MONGODB_URI`. For the complete stack,
use the root `docker-compose.yaml` file instead. The checked-in example uses the
Docker hostname `mongodb`; change it to `mongodb://localhost:27017/dealflow` when
running the API gateway directly against a host-installed MongoDB.

## Request flow

```text
Browser -> Apache APISIX -> this Express API -> MongoDB
```

APISIX performs edge routing, request IDs, CORS, and rate limiting. Express remains
the source of truth for password verification, user status, role authorization,
approval decisions, internal sessions, and customer portal scope.

## Observability

The service starts the shared `@app/observability` OpenTelemetry SDK before loading
Express. It exports OTLP/HTTP traces, logs, and metrics to the configured collector.
Automatic instrumentation covers inbound HTTP, Express, and MongoDB calls, while
the API wrapper adds a child span for every async route.

Every log keeps a short human-readable message and adds flat, filterable context:
`event.name`, `event.outcome`, `request.id`, `trace.id`, `span.id`,
`http.request.method`, `http.route`, response status, and duration. Auth, portal,
and administrator events add safe fields such as user role, outcome, error code,
session kind, quotation ID, registration ID, or discount ID. Email addresses are
represented by a keyed fingerprint when correlation is useful.

The logging helper drops attributes whose keys indicate passwords, cookies,
authorization, secrets, raw tokens, email addresses, customer names, delivery
addresses, or coordinates. It also redacts common credential patterns in exception
messages and never logs request bodies or portal access URLs. Set these variables in
`api-gateway/.env`:

```dotenv
OTEL_SERVICE_NAME=dealflow-api-gateway
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_METRIC_EXPORT_INTERVAL=60000
```

In the Docker stack the API gateway joins the `observability` network, sends logs
through the collector to Loki, and sends traces through the collector to Tempo.
Use `request.id` to correlate an APISIX response with API logs, and use `trace.id`
to move between the structured log and its Express/MongoDB trace in Tempo.

## Internal authentication

The canonical API base path is `/v1/api`.

- `POST /v1/api/user/auth/signup`
- `POST /v1/api/user/auth/login`
- `POST /v1/api/user/auth/forgot_password`
- `GET /v1/api/user/auth/me`
- `POST /v1/api/user/auth/logout`
- `POST /v1/api/admin/create_tier_discount` - admin or manager
- `POST /v1/api/admin/create_category_discount` - admin or manager
- `GET /v1/api/admin/discount_policy` - admin or manager
- `PATCH /v1/api/admin/tier_discount` - admin or manager
- `PATCH /v1/api/admin/category_discount` - admin or manager
- `GET /v1/api/admin/users` - admin only
- `GET /v1/api/admin/registration-requests?status=PENDING_APPROVAL`
- `POST /v1/api/admin/approve_user` with `{ "userId": "..." }`
- `PATCH /v1/api/admin/registration-requests/:requestId`

The earlier `/api/v1/auth` and `/api/v1/admin` mounts remain as compatibility
aliases for the current frontend. `/registrations` is also an alias for `/signup`,
and the requested `/create_category_discount_` spelling is accepted as an alias
for `/create_category_discount`.

The gateway does not seed users or other application data at startup. Administrator
accounts must be provisioned outside this service. A registration stores
`requestedRole` but leaves `role` null until an administrator approves it.
Rejected registrations are soft deleted with `is_deleted: true`; their document
and administrator reason are retained so the rejected user receives clear feedback.

`users` and `tier_discounts` are separate collections on the same configured
MongoDB database. Customer registrations require delivery coordinates and an
address. Their tier is assigned from the `tier_discounts` document with the
lowest numeric `discount`; customer creation fails when no tier is configured.
Category discount documents are stored separately in `category_discounts`.

Create a tier discount with:

```json
{
  "tier": "BRONZE",
  "discount": 5
}
```

Tier discounts must be non-negative integers and tier names are unique. Create
category discounts with:

```json
{
  "hardware": 5,
  "service": 10,
  "subscription": 0
}
```

Hardware and service discounts must be non-negative. Subscription discounts are
fixed at zero, matching the Night Sky model. The forgot-password endpoint always
returns the same accepted response to prevent account discovery and records an
audit event for known users. Email delivery and the reset-confirmation endpoint
still need to be connected before password reset is end-to-end complete.

## Customer portal

Customers are not internal users and never receive an internal role.

1. An authenticated sales rep, sales manager, or admin calls
   `POST /api/v1/portal/invitations`.
2. The API returns a URL whose token is in the URL fragment. Fragments are not sent
   in HTTP requests or gateway access logs.
3. React exchanges the token through `POST /api/v1/portal/session`, removes it from
   the address bar, and receives a separate HttpOnly portal cookie.
4. That session is restricted to one `quotationId`. Downstream quotation routes can
   use `requirePortalAuth` and compare the requested quotation ID with the session.

Portal endpoints:

- `POST /api/v1/portal/invitations` - internal roles only
- `POST /api/v1/portal/session` - exchange an invitation token
- `GET /api/v1/portal/session` - restore the portal session
- `POST /api/v1/portal/logout`
- `GET /api/v1/portal/quotation-access` - demonstrates quotation-scoped access
