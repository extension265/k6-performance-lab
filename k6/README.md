# k6 suite

k6 2.3.0 runs in Docker on the compose network, so a fresh clone needs only Docker.

```
npm run stack:up
npm run test:smoke                     # or load | stress | spike | soak | breakpoint
npm run perf:fresh -- stress           # reset DB to the seeded state, wait for /health, then run
npm run test:smoke -- -- --vus 5       # anything after the second -- is passed to k6 run
```

Each run writes `reports/<scenario>-summary.json` (from `handleSummary`) and `reports/<scenario>.html` (k6 web dashboard export). The npm script exits with k6's exit code: **99 means a threshold was breached**.

## The journey (`flows/payment-journey.js`)

1. create order
2. pay with a new `Idempotency-Key`
3. retry with the same key: it must replay the same payment
4. get the payment
5. send a signed webhook to capture it
6. verify the order: paid, with exactly one payment for the key

Every request carries a `name` tag (the route template), so per-endpoint metrics don't explode into one series per id. The retry is tagged `POST /payments (replay)`, so the `POST /payments` SLO measures only real charges. About 2% of payments are declined by the simulated provider. That is a valid outcome, so a decline doesn't fail checks. It shows up in `payment_success_rate`.

## Scenarios

| Scenario | Executor | Shape | Question it answers |
|---|---|---|---|
| smoke | constant-vus | 2 VUs, 30s | Does the full journey work within SLO at all? |
| load | ramping-vus | ramp to 50 VUs, hold 5m | Does it meet SLO at expected peak? |
| stress | ramping-vus | 50 → 100 → 150 → 200 VUs, 2m per step | Where does latency bend, and what fails first? |
| spike | ramping-vus | 10 → 200 VUs in 10s, hold 1m, drop | Does it survive a burst and recover? |
| soak | constant-vus | 30 VUs, 30m (manual only) | Does anything drift over time? |
| breakpoint | ramping-arrival-rate | 1 → 100 journeys/s over 10m | What is the maximum sustainable rate? It aborts on the first SLO breach. |

VU scenarios sleep `THINK_TIME` (default 1s) between journeys. Breakpoint uses an open model with no think time.

## Thresholds (shared SLOs, `lib/thresholds.js`)

| Metric | Threshold |
|---|---|
| `http_req_failed` | rate < 1% |
| `http_req_duration{name:POST /payments}` | p95 < 500 ms |
| `checkout_duration` | p95 < 1500 ms |
| `idempotency_violations` | count == 0 |
| `checks` | rate > 99% |

Per-endpoint p95/p99 for every other endpoint is reported but not gated.

## Custom metrics (`lib/metrics.js`)

- `payment_success_rate` (Rate): share of journeys that end with a captured payment.
- `idempotency_violations` (Counter): replay mismatches, or more than one payment for a key. It must stay 0.
- `checkout_duration` (Trend): full journey time, excluding auth.

## Settings (env vars, forwarded by the runner)

| Variable | Default | Effect |
|---|---|---|
| `FRESH_AUTH_RATIO` | `0.15` | Share of iterations that call `/auth/token` instead of reusing the `setup()` token. This keeps the bcrypt cost visible. Use `0` to exclude auth. |
| `THINK_TIME` | `1` | Seconds between journeys (VU scenarios) |
| `SOAK_DURATION` | `30m` | Soak length |
| `BREAKPOINT_MAX_RATE` / `BREAKPOINT_RAMP` / `BREAKPOINT_MAX_VUS` | `100` / `10m` / `300` | Breakpoint ramp |

`lib/config.js` refuses any target other than the local stack (`api`, `localhost`, `127.0.0.1`, `host.docker.internal`).
