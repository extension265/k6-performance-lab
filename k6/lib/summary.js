import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { REPORTS_DIR } from './config.js';

/**
 * handleSummary factory: prints the usual text summary and writes
 * reports/<scenario>-summary.json for CI step summaries and the Phase 6 write-up.
 */
export function summaryFor(scenario) {
  return function handleSummary(data) {
    return {
      stdout: textSummary(data, { indent: ' ', enableColors: true }),
      [`${REPORTS_DIR}/${scenario}-summary.json`]: JSON.stringify(data, null, 2),
    };
  };
}
