import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import { badRequest, conflict, notFound, unauthorized } from '../errors.js';
import { requireUuid, serializePayment } from '../validation.js';

// event -> { from: allowed current status, to: new status }
const TRANSITIONS = {
  'payment.captured': { from: 'authorized', to: 'captured' },
  'payment.failed': { from: 'authorized', to: 'failed' },
};

/**
 * POST /webhooks/payment  { paymentId, event }
 * Simulated provider callback. Authenticated with an HMAC-SHA256 signature of the raw body:
 *   X-Webhook-Signature: sha256=<hex(hmac(WEBHOOK_SECRET, rawBody))>
 * Redelivery of an already-applied event is a no-op (200), as real providers retry webhooks.
 */
export async function paymentWebhook(req, res) {
  verifySignature(req);

  const paymentId = requireUuid(req.body?.paymentId, 'paymentId');
  const transition = TRANSITIONS[req.body?.event];
  if (!transition) {
    throw badRequest('invalid_request', `event must be one of ${Object.keys(TRANSITIONS).join(', ')}`);
  }

  const payment = await withTransaction(async (q) => {
    const { rows } = await q('payment_for_update', 'SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
    const current = rows[0];
    if (!current) throw notFound('Payment');
    if (current.status === transition.to) return current; // duplicate delivery
    if (current.status !== transition.from) {
      throw conflict('invalid_transition', `Cannot apply ${req.body.event} to a ${current.status} payment`);
    }

    const updated = await q(
      'update_payment_status',
      'UPDATE payments SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [paymentId, transition.to],
    );
    if (transition.to === 'captured') {
      await q('mark_order_paid', `UPDATE orders SET status = 'paid', updated_at = now() WHERE id = $1`, [
        current.order_id,
      ]);
    }
    return updated.rows[0];
  });

  res.json({ received: true, payment: serializePayment(payment) });
}

function verifySignature(req) {
  const header = req.get('x-webhook-signature') ?? '';
  const expected = 'sha256=' + createHmac('sha256', config.webhookSecret).update(req.rawBody ?? '').digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw unauthorized('Invalid webhook signature');
}
