# PLAN.md — k6 Performance Lab

> **For Claude Code:** Read this whole file first. Work **one phase at a time**. At the end of each phase: run the acceptance checks, commit (Conventional Commits), then **stop and summarize what you did** so I can review before the next phase. Do not skip ahead.

---

## 1. Project goal

A public portfolio repo that shows **real performance engineering**, not just "a k6 framework":

1. A small **payment API** (self-hosted in Docker) that I load test end to end.
2. A full **k6 suite** (smoke, load, stress, spike, soak, breakpoint) with SLO thresholds.
3. **Newman** used for what it is: a functional/contract gate *before* load runs.
4. **Observability**: k6 + API metrics in Grafana, side by side.
5. A **bottleneck investigation** with real before/after numbers.
6. **CI**: GitHub Actions perf gate on PRs, reports published to GitHub Pages.
7. (Optional) **LLM endpoint load test** against a local model.

Repo name suggestion: `k6-performance-lab` (separate from my Playwright repo `playwright-e2e-framework`).

---

## 2. Working rules for Claude Code

- **My machine:** Windows + Docker Desktop. All run commands must work on Windows. Use `npm run <script>` wrappers, not bash-only scripts. If a shell script is unavoidable, also provide a PowerShell or Node equivalent.
- **Language:** JavaScript everywhere (API, k6 scripts, helper scripts). No TypeScript.
- **Never invent results.** Any numbers in README/docs must come from actual runs. If a run hasn't happened yet, leave a clearly marked `TODO: run and fill` placeholder.
- **Never point load tests at third-party/public sites.** Target only the local Docker stack (and local Ollama in Phase 8).
- Pin versions of Docker images and npm packages. Verify current image tags/package names before using them; don't guess.
- Keep VU counts laptop-friendly. Set Docker resource limits on the API so results are reproducible.
- One commit per logical step, Conventional Commits (`feat:`, `test:`, `ci:`, `docs:`, `perf:`).
- Ask me before adding any new tool not listed in this plan.

---

## 3. Target folder structure

```
k6-performance-lab/
├── api/                     # PayFlow mock payment API (Node + Express + Postgres)
│   ├── src/
│   ├── db/init.sql
│   ├── Dockerfile
│   └── package.json
├── k6/
│   ├── lib/                 # config, auth, checks, data generators, custom metrics
│   ├── scenarios/           # smoke.js, load.js, stress.js, spike.js, soak.js, breakpoint.js
│   ├── flows/               # payment-journey.js (reusable user journey)
│   ├── llm/                 # Phase 8 only
│   └── data/                # test data (CSV/JSON)
├── postman/                 # collection + environment for Newman
├── observability/
│   ├── prometheus/prometheus.yml
│   └── grafana/provisioning/ (datasources + dashboards)
├── reports/                 # gitignored local output
├── docs/
│   ├── results.md           # before/after findings with real numbers
│   ├── architecture.md
│   └── images/              # Grafana screenshots, diagrams
├── .github/workflows/
├── docker-compose.yml
├── package.json             # root npm scripts that wrap everything
└── README.md
```

---

## Phase 0 — Scaffold

- Init repo, `.gitignore` (node_modules, reports/, .env), `.editorconfig`, root `package.json`.
- Root npm scripts (fill in as phases land): `stack:up`, `stack:down`, `test:contract`, `test:smoke`, `test:load`, `test:stress`, `test:spike`, `test:soak`, `test:breakpoint`.
- `README.md` skeleton with section headers only.

**Acceptance:** repo structure exists, `npm run` lists the scripts.

---

## Phase 1 — PayFlow API (the system under test)

Node 20 + Express + `pg` + Postgres, run via Docker Compose.

**Endpoints**
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness + DB check |
| POST | `/auth/token` | returns JWT for a seeded test user (bcrypt password check) |
| POST | `/orders` | create order (amount, currency) |
| GET | `/orders/:id` | order + its payments |
| POST | `/payments` | requires `Idempotency-Key` header; same key → same result, no duplicate charge |
| GET | `/payments/:id` | payment status |
| POST | `/webhooks/payment` | simulates provider callback, updates status |
| GET | `/metrics` | Prometheus metrics via `prom-client` (request duration histogram, DB pool in-use/waiting gauges) |

**Payment simulation:** random 50–150 ms "provider latency", ~2% simulated declines (configurable via env).

**Deliberate, toggleable bottlenecks** (env `BOTTLENECK_MODE=on|off`, default `on`):
1. Small DB pool (`POOL_SIZE=5` when on, `20` when off).
2. Missing index on `payments.order_id` (migration adds it when off).
3. N+1 query in `GET /orders/:id` (single JOIN when off).
4. High bcrypt cost in `/auth/token` (12 when on, 8 when off). Also cache tokens in k6 so auth isn't hammered per iteration.

These are intentionally seeded so the investigation in Phase 6 is reproducible. **README must state openly that they're seeded.** Do not present them as discovered production bugs.

**Docker:** API container limited to `cpus: "1.0"`, `mem_limit: 512m`. Postgres with an init script and ~10k seeded orders.

**Acceptance:** `npm run stack:up` → `/health` returns 200; manual curl of the full flow works; idempotency verified (same key twice → one payment row).

---

## Phase 2 — Newman contract gate

- Postman collection in `postman/` covering every endpoint: status codes, schema checks, idempotency behaviour, negative cases (missing key → 400, bad token → 401).
- Environment file pointing at `http://localhost:3000`.
- `npm run test:contract` runs Newman with CLI + `htmlextra` reporter → `reports/newman/`.

**Acceptance:** all Newman assertions pass against the running stack.

---

## Phase 3 — k6 suite

**lib/**
- `config.js`: base URL and env selection via `__ENV`.
- `auth.js`: gets token once in `setup()`, shares it.
- `checks.js`: reusable check helpers.
- `metrics.js`: custom metrics:
  - `payment_success_rate` (Rate)
  - `idempotency_violations` (Counter, should stay 0)
  - `checkout_duration` (Trend, full journey time)
- `data.js`: random amounts/currencies, unique idempotency keys (`uuidv4` from k6 jslib).

**flows/payment-journey.js**: create order → pay → retry pay with same key (assert no duplicate) → get payment → webhook → verify final status. Use `group()` and request tags (`name:` tag per endpoint, so dynamic URLs don't explode metric cardinality).

**scenarios/** (each has its own `options` with executors + thresholds):
| File | Executor | Shape (laptop-friendly, tune later) |
|---|---|---|
| smoke.js | constant-vus | 2 VUs, 30s |
| load.js | ramping-vus | ramp to 50 VUs, hold 5m |
| stress.js | ramping-vus | step 50 → 100 → 150 → 200 |
| spike.js | ramping-vus | 10 → 200 in 10s, hold 1m, drop |
| soak.js | constant-vus | 30 VUs, 30m (manual only) |
| breakpoint.js | ramping-arrival-rate | increase RPS until thresholds abort (`abortOnFail: true`) |

**Thresholds (SLOs), shared baseline:**
- `http_req_failed: rate<0.01`
- `http_req_duration{name:POST /payments}: p(95)<500`
- `checkout_duration: p(95)<1500`
- `idempotency_violations: count==0`
- `checks: rate>0.99`

**Reporting:** `handleSummary()` writes `reports/<scenario>-summary.json`. Also support the k6 web dashboard HTML export (`K6_WEB_DASHBOARD=true`, `K6_WEB_DASHBOARD_EXPORT=reports/<scenario>.html`).

**Acceptance:** `npm run test:smoke` passes all thresholds; HTML report generated.

---

## Phase 4 — Observability

- Add Prometheus + Grafana to `docker-compose.yml` (pinned versions). Prometheus started with the remote-write receiver enabled.
- k6 writes metrics via the Prometheus remote-write output. Add an npm script variant for each scenario that enables it.
- Prometheus also scrapes the API's `/metrics`.
- Grafana provisioned automatically (no manual clicking):
  - Datasource: Prometheus.
  - Dashboard 1: official k6 Prometheus dashboard from grafana.com (verify the current ID).
  - Dashboard 2: custom **"API vs Load"** dashboard: VUs, RPS, p95 latency, error rate **alongside** API-side DB pool in-use/waiting and request duration. Correlating these is the point.

**Acceptance:** run `load.js`; both dashboards show live data. Take screenshots into `docs/images/`.

---

## Phase 5 — CI (GitHub Actions)

1. `pr-perf-gate.yml` (on pull_request):
   - start stack with docker compose
   - wait for `/health`
   - Newman contract run
   - k6 smoke with thresholds (fail job on breach)
   - write a results table to `$GITHUB_STEP_SUMMARY`
   - upload reports as artifacts
2. `load-test.yml` (workflow_dispatch with input: scenario name): runs the chosen scenario, uploads the HTML report.
3. `publish-reports.yml`: publishes latest HTML reports to GitHub Pages so people can view them without cloning.

Use the official Grafana k6 GitHub actions (`setup-k6-action` / `run-k6-action`). Verify current versions.

**Acceptance:** PR workflow green; a deliberately broken threshold fails the build (prove it once, then revert).

---

## Phase 6 — Bottleneck investigation (the LinkedIn story)

**I will run these myself; Claude Code prepares scripts and the doc template.**

1. `BOTTLENECK_MODE=on`: run `stress.js` and `breakpoint.js`. Record:
   - max sustainable RPS
   - p95/p99 per endpoint
   - error rate
   - DB pool waiting
2. Diagnose from Grafana. Identify each bottleneck from the evidence (pool waiting spikes, slow `GET /orders/:id`, slow auth).
3. Fix one at a time (flip each toggle individually via separate env flags), re-run, record.
4. Fill `docs/results.md` with a before/after table for each fix, plus a Grafana screenshot for each.

Template table:
| Change | Max RPS | p95 POST /payments | p95 GET /orders/:id | Error rate |
|---|---|---|---|---|
| Baseline (all bottlenecks) | TODO | TODO | TODO | TODO |
| + pool 5→20 | | | | |
| + index on payments.order_id | | | | |
| + N+1 → JOIN | | | | |

**Acceptance:** table filled with real numbers only.

---

## Phase 7 — README (the repo's front page)

Order matters. Recruiters skim the top 30 lines.

1. One-line pitch + badges (CI status, k6, Docker).
2. **Key results first:** the before/after headline (e.g. "p95 X ms → Y ms at Z RPS"), plus one Grafana screenshot.
3. Architecture diagram (Mermaid): k6 → API → Postgres; Prometheus → Grafana; CI flow.
4. Quick start: 3 commands max.
5. Test types table: what each scenario proves.
6. SLOs/thresholds and why.
7. How the CI gate works (with screenshot of a failed gate).
8. Link to `docs/results.md`, GitHub Pages reports.
9. Note that bottlenecks are intentionally seeded for reproducibility.

---

## Phase 8 (optional, do it if time) — LLM endpoint load test

Differentiator for AI-product QA roles.

- Run Ollama locally (Docker or native on Windows) with a small model (e.g. a ~1B parameter model; verify current names).
- `k6/llm/llm-load.js` targets Ollama's generate API:
  - Non-streaming: compute **tokens/sec** from response fields (`eval_count`, `eval_duration`) into a custom Trend.
  - Streaming: use `http_req_waiting` (time to first byte) as a **time-to-first-token** proxy.
  - Ramp concurrency 1 → 2 → 4 → 8 and show how TTFT and tokens/sec degrade.
- Local only, **not in CI** (too heavy for runners).
- Add a section to `docs/results.md` with the concurrency vs TTFT chart.

---

## Phase 9 — LinkedIn assets (Claude Code generates, I post)

Create `docs/linkedin/` with:
- `post-draft.md`: filled from real numbers in `docs/results.md` (structure below).
- `carousel-outline.md`: 5–7 slide outline:
  1. hook number
  2. architecture
  3. test types
  4. Grafana before
  5. the fix
  6. Grafana after
  7. CI gate + repo link
- List of which screenshots to use.

**Post structure:**
1. Hook line with a real number ("Our payment API fell over at X RPS. One config line moved it to Y.").
2. 3–4 lines: what I built (API, k6 suite, Newman gate, Grafana, CI).
3. The bottleneck story in 3 short bullets: symptom → evidence in Grafana → fix → result.
4. One lesson ("load generation isn't performance testing; correlation is").
5. Repo link + "feedback welcome".
6. 3–5 hashtags max: #k6 #PerformanceTesting #QA #TestAutomation #GrafanaK6.

---

## Definition of done

- [ ] `npm run stack:up` + `npm run test:smoke` works from a fresh clone on Windows
- [ ] Newman contract gate passing
- [ ] All 6 k6 scenarios run with thresholds
- [ ] Grafana dashboards auto-provisioned
- [ ] CI gate on PRs + reports on GitHub Pages
- [ ] `docs/results.md` filled with real before/after numbers
- [ ] README leads with results
- [ ] LinkedIn draft + carousel outline ready
