import { group } from 'k6';
import crypto from 'k6/crypto';
import http from 'k6/http';
import { expectJson, expectTrue } from '../lib/checks.js';
import { BASE_URL, WEBHOOK_SECRET } from '../lib/config.js';
import { idempotencyKey, randomAmount, randomCurrency } from '../lib/data.js';
import { params } from '../lib/http.js';
import { checkoutDuration, idempotencyViolations, paymentSuccessRate } from '../lib/metrics.js';

/**
 * One customer checkout:
 *   create order → pay → retry pay with the same key (must not double charge) → get payment
 *   → provider webhook (capture) → verify the order's final state.
 * Returns true if the journey completed with a captured payment.
 */
export function paymentJourney(token) {
  const started = Date.now();
  const captured = runJourney(token);
  checkoutDuration.add(Date.now() - started);
  paymentSuccessRate.add(captured);
  return captured;
}

function runJourney(token) {
  const key = idempotencyKey();
  let order;
  let payment;

  group('01 create order', () => {
    const res = http.post(
      `${BASE_URL}/orders`,
      JSON.stringify({ amount: randomAmount(), currency: randomCurrency() }),
      params('POST /orders', token),
    );
    order = expectJson(res, 201, 'create order');
  });
  if (!order) return false;

  group('02 pay', () => {
    const res = http.post(
      `${BASE_URL}/payments`,
      JSON.stringify({ orderId: order.id }),
      params('POST /payments', token, { 'Idempotency-Key': key }),
    );
    payment = expectJson(res, 201, 'pay');
  });
  if (!payment) return false;

  group('03 retry pay (same key)', () => {
    const res = http.post(
      `${BASE_URL}/payments`,
      JSON.stringify({ orderId: order.id }),
      params('POST /payments (replay)', token, { 'Idempotency-Key': key }),
    );
    const replay = expectJson(res, 200, 'replay');
    const consistent =
      replay !== null &&
      replay.id === payment.id &&
      replay.status === payment.status &&
      res.headers['Idempotent-Replayed'] === 'true';
    if (!expectTrue('replay returns the original payment', consistent)) idempotencyViolations.add(1);
  });

  group('04 get payment', () => {
    const res = http.get(`${BASE_URL}/payments/${payment.id}`, params('GET /payments/:id', token));
    const body = expectJson(res, 200, 'get payment');
    expectTrue('payment status unchanged', body?.status === payment.status);
  });

  // ~2% of payments are declined by the simulated provider: that is a valid outcome, not an error.
  const authorized = payment.status === 'authorized';
  if (authorized) {
    group('05 webhook capture', () => {
      const body = JSON.stringify({ paymentId: payment.id, event: 'payment.captured' });
      const signature = 'sha256=' + crypto.hmac('sha256', WEBHOOK_SECRET, body, 'hex');
      const res = http.post(
        `${BASE_URL}/webhooks/payment`,
        body,
        params('POST /webhooks/payment', null, { 'X-Webhook-Signature': signature }),
      );
      const result = expectJson(res, 200, 'webhook');
      expectTrue('webhook captured the payment', result?.payment?.status === 'captured');
    });
  }

  let finalOk = false;
  group('06 verify order', () => {
    const res = http.get(`${BASE_URL}/orders/${order.id}`, params('GET /orders/:id', token));
    const body = expectJson(res, 200, 'verify order');
    if (!body) return;

    const forKey = body.payments.filter((p) => p.idempotencyKey === key);
    if (!expectTrue('exactly one payment for the key', forKey.length === 1)) idempotencyViolations.add(1);

    const expectedOrder = authorized ? 'paid' : 'pending';
    const expectedPayment = authorized ? 'captured' : 'declined';
    finalOk = expectTrue(
      'order and payment reach the expected final state',
      body.status === expectedOrder && forKey[0]?.status === expectedPayment,
    );
  });

  return authorized && finalOk;
}
