import { sleep } from 'k6';
import { paymentJourney } from '../flows/payment-journey.js';
import { tokenForIteration } from './auth.js';
import { THINK_TIME } from './config.js';

/** Closed-model iteration (VU-based executors): one journey, then think time. */
export function vuIteration(data) {
  paymentJourney(tokenForIteration(data));
  if (THINK_TIME > 0) sleep(THINK_TIME);
}

/** Open-model iteration (arrival-rate executors): no think time, the executor sets the pace. */
export function arrivalIteration(data) {
  paymentJourney(tokenForIteration(data));
}
