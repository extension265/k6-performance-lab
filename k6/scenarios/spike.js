// Spike: sudden burst 10 → 200 VUs in 10s, hold 1m, drop back. Does it survive and recover afterwards?
import { setupAuth } from '../lib/auth.js';
import { vuIteration } from '../lib/iteration.js';
import { summaryFor } from '../lib/summary.js';
import { SUMMARY_TREND_STATS, thresholds } from '../lib/thresholds.js';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 10 }, //  baseline
        { duration: '10s', target: 200 }, // spike
        { duration: '1m', target: 200 }, //  hold
        { duration: '10s', target: 10 }, //  drop
        { duration: '1m', target: 10 }, //   recovery: latency should return to baseline
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: thresholds(),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = setupAuth;
export default vuIteration;
export const handleSummary = summaryFor('spike');
