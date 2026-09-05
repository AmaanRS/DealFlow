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

## Internal authentication

- `POST /api/v1/auth/registrations`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/session`
- `POST /api/v1/auth/logout`
- `GET /api/v1/admin/registration-requests?status=PENDING_APPROVAL`
- `PATCH /api/v1/admin/registration-requests/:requestId`

The configured administrator is seeded only when its email does not exist. A
registration stores `requestedRole` but leaves `role` null until the administrator
approves it.

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

The sample token in `.env.example` is local seed data only.
