// Smoke: does the full journey work under minimal load, within SLO? Gate for every other run (and CI).
import { setupAuth } from '../lib/auth.js';
import { vuIteration } from '../lib/iteration.js';
import { summaryFor } from '../lib/summary.js';
import { SUMMARY_TREND_STATS, thresholds } from '../lib/thresholds.js';

export const options = {
  scenarios: {
    smoke: { executor: 'constant-vus', vus: 2, duration: '30s' },
  },
  thresholds: thresholds(),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = setupAuth;
export default vuIteration;
export const handleSummary = summaryFor('smoke');
