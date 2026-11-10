# PayFlow API

A mock payment API that the k6 suite runs against. Node 24 LTS, Express 5, Postgres 18.
The seed data is 1,000 users, 200k orders and about 500k payments. It is sized so the missing-index bottleneck is measurable.

> **The bottlenecks below are seeded on purpose.** They are toggleable so the Phase 6
> investigation can be reproduced. They are not production bugs that were discovered.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | Liveness + DB check; also echoes the active bottleneck config |
| POST | `/auth/token` | none | `{ email, password }` → `{ accessToken, tokenType, expiresIn }` (bcrypt check) |
| POST | `/orders` | Bearer | `{ amount, currency }`, amount in minor units, currency `USD`/`EUR`/`GBP`/`INR` |
| GET | `/orders/:id` | Bearer | Order + its payments |
| POST | `/payments` | Bearer | `{ orderId }` + `Idempotency-Key` header (see below) |
| GET | `/payments/:id` | Bearer | Payment status |
| POST | `/webhooks/payment` | HMAC | `{ paymentId, event }`, event `payment.captured` or `payment.failed` |
| GET | `/metrics` | none | Prometheus metrics |

Test user: `loadtest@payflow.local` / `payflow-loadtest` (local stack only).

### Payments and idempotency

- Status flow: `authorized` or `declined` (provider result), then `captured` or `failed` (webhook).
- The same key on the same order replays the original result: `200` with `Idempotent-Replayed: true`. No second charge is made.
- The same key on a different order returns `422 idempotency_key_reused`.
- A new key on an order that already has an authorized or captured payment returns `409 order_already_paid`.
- Concurrent requests with the same key serialize on the order row lock. Only one payment row is ever created.
- Simulated provider: 50–150 ms latency and a 2% decline rate (`PROVIDER_LATENCY_*`, `DECLINE_RATE`).
- Test mode: `X-Test-Force-Outcome: approve|decline` forces the result, so contract tests are deterministic.

### Webhook signature

`X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw request body, key = WEBHOOK_SECRET>`

Re-delivering an event that has already been applied is a no-op and returns `200`.

## Seeded bottlenecks

`BOTTLENECK_MODE=on|off` (default `on`) sets every flag below. Each flag can override it on its own.

| Flag | `on` (bottleneck) | `off` (fixed) |
|---|---|---|
| `BOTTLENECK_POOL` | DB pool size 5 | 20 |
| `BOTTLENECK_INDEX` | no index on `payments.order_id` | index created at startup |
| `BOTTLENECK_N_PLUS_ONE` | `GET /orders/:id` runs 2 + N queries | one `LEFT JOIN` |
| `BOTTLENECK_BCRYPT` | bcrypt cost 12 | cost 8 (the hash is rewritten at startup) |

`POOL_SIZE` and `BCRYPT_COST` override the numbers directly. The payment transaction holds its DB
connection across the simulated provider call, so pool size limits payment throughput.

## Metrics

- `http_request_duration_seconds{method,route,status_code}`: `route` is the template (`/orders/:id`).
- `payflow_db_pool_{max,total,idle,in_use,waiting}`
- `payflow_db_pool_acquire_duration_seconds`: time spent waiting for a pool connection.
- `payflow_db_query_duration_seconds{query}`: time per named query. Under N+1, `payment_by_id` volume rises.
- `payflow_payments_total{outcome}`, `payflow_bottleneck_enabled{bottleneck}`, `payflow_bcrypt_cost`

Note: `prom-client` (pinned at 15.1.3) is deprecated in favour of `@prometheus-io/client`; a swap is planned once that package reaches 1.0.
