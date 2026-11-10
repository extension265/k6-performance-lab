// Load: expected peak traffic (50 VUs) held for 5 minutes. Does the system meet SLO at normal peak?
import { setupAuth } from '../lib/auth.js';
import { vuIteration } from '../lib/iteration.js';
import { summaryFor } from '../lib/summary.js';
import { SUMMARY_TREND_STATS, thresholds } from '../lib/thresholds.js';

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 }, // ramp up
        { duration: '5m', target: 50 }, // hold at peak
        { duration: '30s', target: 0 }, // ramp down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: thresholds(),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = setupAuth;
export default vuIteration;
export const handleSummary = summaryFor('load');
