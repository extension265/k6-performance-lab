# Results: bottleneck investigation

> **Status: TODO: run and fill.** No experiment has been run yet. Every number on this page must
> come from a real run, recorded with the conditions below. The bottlenecks are **seeded on purpose**
> (see [api/README.md](../api/README.md)), so the investigation can be reproduced. They were not
> discovered in production.

## Method

1. Write the **hypothesis** in the table **before** the run: what you expect to change, and why.
2. Run from a freshly seeded database every time: `npm run perf:fresh -- <scenario> --prom`. Set the bottleneck flags first.
3. Read the numbers from `reports/<scenario>-summary.json`, and the **observed** behaviour from the "API vs Load" dashboard. Take one screenshot per experiment.
4. Check run validity: k6 peak CPU must be **≤ 80% of its limit** (the gauge on the API vs Load dashboard). If it isn't, discard the run and repeat it.
5. Change **one** thing per row, keeping the earlier fixes. Each row adds one fix to the row above it.

## Run conditions

Fill this in once per session. If anything changes, start a new session block.

| Condition | Value |
|---|---|
| Date | TODO |
| Machine (CPU / RAM) | TODO |
| Laptop on charger | TODO (must be yes) |
| Windows power mode | TODO (must be "Best performance") |
| Docker Desktop version / WSL2 resources | TODO |
| Other heavy apps closed | TODO |
| `perf:fresh` used for every run | TODO (must be yes) |
| Container limits | api 1 CPU / 512m, postgres 2 CPU / 1g, k6 2 CPU / 1g (docker-compose.yml) |
| k6 version / API commit | grafana/k6:2.3.0 / TODO (`git rev-parse --short HEAD`) |

## Experiments

Scenario for the throughput column: `breakpoint` (max sustainable journeys/s before the first SLO breach). Scenario for the latency columns: `stress`. Note which one each number came from if that changes.

| # | Change (flags) | Hypothesis (before the run) | Max RPS | p95 POST /payments | p95 GET /orders/:id | Error rate | k6 peak CPU % of limit | Observed (from the dashboards) |
|---|---|---|---|---|---|---|---|---|
| 0 | Baseline: all bottlenecks on (`BOTTLENECK_MODE=on`) | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| 1 | + pool 5 → 20 (`BOTTLENECK_POOL=off`) | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| 2 | + index on payments.order_id (`BOTTLENECK_INDEX=off`) | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| 3 | + N+1 → JOIN (`BOTTLENECK_N_PLUS_ONE=off`) | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| 4 | + bcrypt cost 12 → 8 (`BOTTLENECK_BCRYPT=off`) | TODO | TODO | TODO | TODO | TODO | TODO | TODO |

Row 4 is the fourth seeded bottleneck. With `FRESH_AUTH_RATIO=0.15`, 15% of iterations re-authenticate, so its effect shows up mainly in `POST /auth/token` latency and in API CPU.

How to set the flags for a row (PowerShell). The flags are cumulative: row 2 keeps row 1's fix.

```powershell
$env:BOTTLENECK_POOL='off'; $env:BOTTLENECK_INDEX='off'   # row 2
npm run perf:fresh -- breakpoint --prom
npm run perf:fresh -- stress --prom
```

## Experiment notes

Copy one block per experiment.

### 0. Baseline

- **Hypothesis:** TODO
- **Observed:** TODO (which panel moved first: pool waiting, a query's p95, API CPU, …)
- **testid(s):** TODO
- **Screenshot:** TODO (`docs/images/results-0-baseline.png`)

### 1. Pool 5 → 20

- **Hypothesis:** TODO
- **Observed:** TODO
- **testid(s):** TODO
- **Screenshot:** TODO

### 2. Index on payments.order_id

- **Hypothesis:** TODO
- **Observed:** TODO
- **testid(s):** TODO
- **Screenshot:** TODO

### 3. N+1 → JOIN

- **Hypothesis:** TODO
- **Observed:** TODO
- **testid(s):** TODO
- **Screenshot:** TODO

### 4. bcrypt cost 12 → 8

- **Hypothesis:** TODO
- **Observed:** TODO
- **testid(s):** TODO
- **Screenshot:** TODO

## Headline

TODO: one sentence after all rows are filled, e.g. "p95 POST /payments X ms → Y ms; max sustainable rate A → B journeys/s". Use real numbers only.
