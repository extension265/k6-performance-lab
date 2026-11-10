// Soak: moderate constant load (30 VUs) for 30 minutes. Looks for drift: leaks, pool exhaustion,
// latency creeping up as tables grow. Manual only, never in CI.
import { setupAuth } from '../lib/auth.js';
import { vuIteration } from '../lib/iteration.js';
import { summaryFor } from '../lib/summary.js';
import { SUMMARY_TREND_STATS, thresholds } from '../lib/thresholds.js';

export const options = {
  scenarios: {
    soak: { executor: 'constant-vus', vus: 30, duration: __ENV.SOAK_DURATION || '30m' },
  },
  thresholds: thresholds(),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = setupAuth;
export default vuIteration;
export const handleSummary = summaryFor('soak');
