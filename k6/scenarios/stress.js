// Stress: step beyond normal peak (50 → 100 → 150 → 200 VUs). Where does latency bend, what fails first?
// Thresholds are expected to fail with bottlenecks on; that is the point of the run.
import { setupAuth } from '../lib/auth.js';
import { vuIteration } from '../lib/iteration.js';
import { summaryFor } from '../lib/summary.js';
import { SUMMARY_TREND_STATS, thresholds } from '../lib/thresholds.js';

const step = (target) => [
  { duration: '30s', target }, // ramp to the step
  { duration: '2m', target }, //  hold it
];

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [...step(50), ...step(100), ...step(150), ...step(200), { duration: '1m', target: 0 }],
      gracefulRampDown: '30s',
    },
  },
  thresholds: thresholds(),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = setupAuth;
export default vuIteration;
export const handleSummary = summaryFor('stress');
