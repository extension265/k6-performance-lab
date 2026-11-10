import { config } from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Simulated payment provider: random latency in [min, max] ms and a configurable decline rate.
 * forcedOutcome ('approve' | 'decline') comes from the X-Test-Force-Outcome header in test mode.
 */
export async function authorize(forcedOutcome) {
  const { latencyMinMs, latencyMaxMs, declineRate } = config.provider;
  await sleep(latencyMinMs + Math.random() * (latencyMaxMs - latencyMinMs));

  const declined = forcedOutcome ? forcedOutcome === 'decline' : Math.random() < declineRate;
  return declined
    ? { status: 'declined', declineReason: 'insufficient_funds' }
    : { status: 'authorized', declineReason: null };
}
