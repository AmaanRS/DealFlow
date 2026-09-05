# DealFlow frontend

React + Vite frontend for the internal sales workspace and separate restricted
customer quotation portal.

## Complete stack

From the repository root:

```bash
cp api-gateway/.env.example api-gateway/.env
docker compose up --build
```

Open `http://localhost:9080`. Apache APISIX serves the frontend and proxies
`/api/*` to the API gateway service.

## Frontend development

```bash
cp .env.example .env
npm install
npm run dev
```

The Vite server proxies `/api/*` to APISIX, so the browser always uses the same
relative API paths. The real API is the default. Mock mode remains an opt-in
developer fallback and is never identified in the user interface.

Customer access lives at `/portal`, but it is intentionally not linked from the
internal sign-in screen and has no public access-code form. Quotation emails open
`/portal#token=...`; the client exchanges that one-time token for a secure,
quotation-scoped HttpOnly session and immediately removes it from the URL.

## Code map

- `src/App.jsx` - internal login, registration, pending approval, and session states.
- `src/workspace/` - dashboard, quotations, pipeline, approvals, fulfillment,
  billing, configuration, and reports.
- `src/portal/CustomerPortal.jsx` - separate customer negotiation workspace.
- `src/api/authApi.js` - API gateway request adapter.
- `src/contracts/auth.js` - endpoint, role, and status constants.
- `contracts/api-gateway.md` - API gateway authentication handoff contract.
- `contracts/workspace-api.md` - quotation, approval, fulfillment, billing,
  configuration, reporting, and customer-portal handoff contract.

The employee and portal authentication paths use the real Express service by
default. Until the remaining service endpoints are connected, workspace modules
use seeded client state with live calculations and local persistence; their final
server-owned calculations and mutations are defined in the workspace contract.
