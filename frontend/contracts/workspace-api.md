# DealFlow360 workspace API contract

Version: `v1`  
Frontend owner: React workspace  
Server owner: API gateway and downstream deal/operations services
Gateway: Apache APISIX

The screens currently use the same shapes from seeded client state, so server
work can proceed without blocking UI work. Replace the client adapter one resource
at a time; do not change these shapes silently.

## Shared rules

- Internal endpoints require the HttpOnly employee session and role checks.
- Portal endpoints require the separate, quotation-scoped portal session.
- Money is an integer in minor units (`125000` means INR 1,250.00).
- Dates use ISO 8601. IDs are opaque strings.
- The API gateway recalculates totals, margins, risk, approvals, stock, proration and
  payment state. Never trust a calculated total submitted by the browser.
- Mutating requests accept an `Idempotency-Key` header.
- Concurrent updates use an integer `version`; stale updates return `409`.

Error envelope:

```json
{ "code": "QUOTE_VERSION_CONFLICT", "message": "The quotation changed. Reload and retry.", "fields": {}, "details": {} }
```

## Dashboard and reporting

`GET /api/v1/dashboard?period=30d&teamId=all`

Returns pipeline totals, pending approvals, health alerts, stage counts and trend
points. Every alert includes `quotationId`, `type`, `severity`, `reason`, and
allowed actions.

`POST /api/v1/alerts/:alertId/actions`

```json
{ "action": "NUDGE", "message": "Can we help finalize the delivery date?" }
```

Allowed actions are `NUDGE`, `ESCALATE`, and `DISMISS`.

`GET /api/v1/reports/sales?from=2026-04-01&to=2026-09-30&teamId=all&status=all&category=all`

Returns summary cards plus period rows containing quotation count, won count,
revenue, average discount and margin. Use the same filters for exports:

- `GET /api/v1/reports/sales.pdf?...`
- `GET /api/v1/reports/sales.xls?...`

## Quotations

`GET /api/v1/quotations?stage=all&search=&cursor=`

`POST /api/v1/quotations`

```json
{
  "customer": { "name": "Acme Industries", "email": "buyer@acme.example", "tier": "GOLD" },
  "validUntil": "2026-09-20"
}
```

`GET /api/v1/quotations/:quotationId`

Returns the quotation, enriched lines, server-calculated commercial summary,
approval route, audit history, and current `version`.

`PATCH /api/v1/quotations/:quotationId`

```json
{ "version": 4, "customer": { "tier": "GOLD" }, "orderDiscountPercent": 8 }
```

`POST /api/v1/quotations/:quotationId/lines`

```json
{ "version": 4, "productId": "prod_apexbook", "quantity": 3, "discountPercent": 7 }
```

`PATCH /api/v1/quotations/:quotationId/lines/:lineId`

```json
{ "version": 5, "quantity": 4, "discountPercent": 9 }
```

`DELETE /api/v1/quotations/:quotationId/lines/:lineId?version=6`

`POST /api/v1/quotations/:quotationId/submit`

```json
{ "version": 7 }
```

Returns the authoritative calculation and either `APPROVED` or
`PENDING_APPROVAL`. The server selects the approval chain from customer tier,
category policy, effective discount, margin and risk.

## Recommendations

`GET /api/v1/quotations/:quotationId/recommendations`

Each recommendation contains product, reason, rank, promotion, expected revenue
and margin delta.

`POST /api/v1/quotations/:quotationId/recommendations/:recommendationId/accept`

```json
{ "version": 7, "quantity": 1 }
```

`POST /api/v1/quotations/:quotationId/recommendations/:recommendationId/dismiss`

Dismissals are recorded for later ranking improvements.

## Approvals

`GET /api/v1/approvals?status=PENDING&assignedTo=me`

`GET /api/v1/approvals/:quotationId`

Returns commercial calculations, policy exceptions, risk factors, approval steps
and immutable audit events.

`POST /api/v1/approvals/:quotationId/decisions`

```json
{ "version": 7, "decision": "APPROVE", "reason": "Margin remains above floor." }
```

Decisions are `APPROVE`, `REJECT`, and `RETURN_FOR_REVISION`. Enforce the active
step's role and write the decision and state transition atomically.

## Fulfillment

`GET /api/v1/orders/:quotationId/fulfillment/recommendation`

Returns warehouse groups, reserved quantities, shortages, service level,
estimated cost and the reason for the recommendation.

`POST /api/v1/orders/:quotationId/fulfillment/accept`

```json
{ "version": 2, "recommendationId": "alloc_01", "groups": [{ "warehouseId": "wh_main", "lines": [{ "lineId": "line_01", "quantity": 3 }] }] }
```

The API gateway validates live inventory and reserves all groups transactionally. A
stock race returns `409 STOCK_CHANGED` with a refreshed recommendation.

`POST /api/v1/orders/:quotationId/fulfillment/consolidate-backorder`

Rechecks inventory and returns a lower-shipment allocation when possible.

## Billing and subscriptions

`GET /api/v1/orders/:quotationId/billing`

Returns one-time invoice lines, recurring lines, invoice status, subscription
schedule, proration policy, payments and credit notes.

`POST /api/v1/invoices/:invoiceId/payments`

```json
{ "provider": "CASHFREE", "providerPaymentId": "pay_01", "amount": 2480000 }
```

Payment status must ultimately come from a verified provider webhook. This
endpoint is for reconciliation/import, not trusting a browser success callback.

`POST /api/v1/subscriptions/:subscriptionId/changes`

```json
{ "version": 3, "quantityDelta": 5, "effectiveAt": "2026-09-14T00:00:00Z" }
```

Returns the server-calculated charge or credit note and future schedule.

`POST /api/v1/subscriptions/:subscriptionId/cancel`

## Configuration

Role access: `ADMIN` can change everything; `SALES_MANAGER` can read policies;
`FINANCE_OPERATIONS` can manage billing policy; `SALES_REP` is read-only where
needed by the quotation builder.

- `GET|POST|PATCH /api/v1/config/products`
- `GET|POST|PATCH /api/v1/config/price-lists`
- `GET|POST|PATCH /api/v1/config/discount-rules`
- `GET|POST|PATCH /api/v1/config/approval-chains`
- `GET|POST|PATCH /api/v1/config/warehouses`
- `GET|POST|PATCH /api/v1/config/subscription-plans`
- `GET|PATCH /api/v1/config/recommendations`

All configuration changes create an audit event with actor, before/after values,
timestamp and correlation ID.

## Customer portal

The email link contains a one-time token in the URL fragment. The existing auth
contract exchanges it for the portal HttpOnly cookie. After exchange:

- `GET /api/v1/portal/quotation`
- `POST /api/v1/portal/quotation/comments`
- `POST /api/v1/portal/quotation/change-requests`
- `POST /api/v1/portal/quotation/counter-offers`
- `POST /api/v1/portal/quotation/confirm`

Counter offer request:

```json
{
  "version": 7,
  "discountPercent": 18,
  "message": "Please include installation.",
  "lineComments": [{ "lineId": "line_01", "message": "Deliver before 18 September." }]
}
```

The API gateway recalculates policy. If the counter crosses a threshold, it changes
the quote to `PENDING_APPROVAL`, creates fresh approval steps, and records the
customer action in the audit trail.
