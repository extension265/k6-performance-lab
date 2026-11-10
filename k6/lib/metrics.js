import { Counter, Rate, Trend } from 'k6/metrics';

// Share of journeys that end with a captured payment (provider declines count as false).
export const paymentSuccessRate = new Rate('payment_success_rate');

// Any sign of a double charge: a replayed key returning a different payment, a replay not
// marked as such, or an order holding more than one payment for a single key. Must stay 0.
export const idempotencyViolations = new Counter('idempotency_violations');

// Full checkout journey time (create order → pay → replay → status → webhook → verify), auth excluded.
export const checkoutDuration = new Trend('checkout_duration', true);
