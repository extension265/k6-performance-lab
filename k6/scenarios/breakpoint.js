// Breakpoint: open model, arrival rate keeps rising until an SLO is breached and the run aborts.
// The rate at abort time is the maximum sustainable throughput (journeys/s) for this configuration.
import { setupAuth } from '../lib/auth.js';
import { arrivalIteration } from '../lib/iteration.js';
import { summaryFor } from '../lib/summary.js';
import { SUMMARY_TREND_STATS, thresholds } from '../lib/thresholds.js';

const MAX_RATE = Number(__ENV.BREAKPOINT_MAX_RATE || 100); //  journeys per second at the end of the ramp
const RAMP = __ENV.BREAKPOINT_RAMP || '10m';

export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: Number(__ENV.BREAKPOINT_MAX_VUS || 300),
      stages: [{ duration: RAMP, target: MAX_RATE }],
    },
  },
  thresholds: thresholds({ abort: true, delayAbortEval: '30s' }),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export const setup = setupAuth;
export default arrivalIteration;
export const handleSummary = summaryFor('breakpoint');
