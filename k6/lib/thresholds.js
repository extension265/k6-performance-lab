import { ENDPOINTS } from './http.js';

// Shared SLOs (see PLAN.md Phase 3 / README "SLOs and thresholds").
export const SLO = {
  http_req_failed: ['rate<0.01'],
  'http_req_duration{name:POST /payments}': ['p(95)<500'],
  checkout_duration: ['p(95)<1500'],
  idempotency_violations: ['count==0'],
  checks: ['rate>0.99'],
};

/**
 * Per-endpoint latency, reported but not gated: an empty threshold list makes k6 track the
 * tagged sub-metric so p95/p99 per endpoint show up in the summary JSON.
 */
const PER_ENDPOINT = Object.fromEntries(
  ENDPOINTS.map((name) => [`http_req_duration{name:${name}}`, []]).filter(([k]) => !(k in SLO)),
);

/** Baseline thresholds. With abort=true every SLO aborts the run once breached (breakpoint). */
export function thresholds({ abort = false, delayAbortEval = '30s' } = {}) {
  const slo = abort
    ? Object.fromEntries(
        Object.entries(SLO).map(([metric, list]) => [
          metric,
          list.map((threshold) => ({ threshold, abortOnFail: true, delayAbortEval })),
        ]),
      )
    : SLO;
  return { ...PER_ENDPOINT, ...slo };
}

export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'];
