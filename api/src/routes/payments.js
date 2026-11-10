import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { badRequest, conflict, notFound, unprocessable } from '../errors.js';
import { paymentsTotal } from '../metrics.js';
import { authorize } from '../provider.js';
import { requireUuid, serializePayment } from '../validation.js';

const KEY_RE = /^[\x21-\x7e]{1,255}$/; // printable ASCII, no spaces

/**
 * POST /payments  { orderId }  + Idempotency-Key header
 *
 * - Same key + same order  -> the original result is replayed (200, Idempotent-Replayed: true).
 * - Same key + other order -> 422.
 * - New key on an order that already has an authorized/captured payment -> 409 (no double charge).
 *
 * The order row is locked (FOR UPDATE) and the transaction is held across the provider call,
 * so concurrent attempts on the same order serialize. This also means each in-flight payment
 * holds a DB connection for the provider latency (50-150 ms), which is why pool size matters.
 */
export async function createPayment(req, res) {
  const key = req.get('idempotency-key');
  if (!key) throw badRequest('missing_idempotency_key', 'Idempotency-Key header is required');
  if (!KEY_RE.test(key)) throw badRequest('invalid_idempotency_key', 'Idempotency-Key must be 1-255 printable ASCII chars');

  const orderId = requireUuid(req.body?.orderId, 'orderId');
  const forced = forcedOutcome(req);

  // Fast path: key already used -> replay without taking locks.
  const existing = await findByKey(query, key);
  if (existing) return replay(res, existing, orderId, req.userId);

  const result = await withTransaction(async (q) => {
    const { rows } = await q(
      'order_for_update',
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [orderId, req.userId],
    );
    const order = rows[0];
    if (!order) throw notFound('Order');

    // A concurrent request with the same key may have committed while we waited for the lock.
    const raced = await findByKey(q, key);
    if (raced) return { replayed: raced };

    const active = await q(
      'active_payment_for_order',
      `SELECT 1 FROM payments WHERE order_id = $1 AND status IN ('authorized', 'captured') LIMIT 1`,
      [orderId],
    );
    if (order.status === 'paid' || active.rowCount > 0) {
      throw conflict('order_already_paid', 'Order already has a successful payment');
    }

    const inserted = await q(
      'insert_payment',
      `INSERT INTO payments (order_id, idempotency_key, amount, currency, status)
       VALUES ($1, $2, $3, $4, 'processing')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [orderId, key, order.amount, order.currency],
    );
    if (inserted.rowCount === 0) return { conflictKey: true };

    const outcome = await authorize(forced);
    const updated = await q(
      'update_payment_status',
      `UPDATE payments SET status = $2, decline_reason = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [inserted.rows[0].id, outcome.status, outcome.declineReason],
    );
    return { created: updated.rows[0] };
  });

  if (result.created) {
    paymentsTotal.inc({ outcome: result.created.status });
    return res.status(201).json(serializePayment(result.created));
  }
  // Key collision detected inside the transaction: the winner has committed, replay it.
  const winner = result.replayed ?? (await findByKey(query, key));
  return replay(res, winner, orderId, req.userId);
}

export async function getPayment(req, res) {
  const id = requireUuid(req.params.id, 'id');
  const { rows } = await query(
    'payment_by_id_for_user',
    `SELECT p.* FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = $1 AND o.user_id = $2`,
    [id, req.userId],
  );
  if (!rows[0]) throw notFound('Payment');
  res.json(serializePayment(rows[0]));
}

async function findByKey(q, key) {
  const { rows } = await q(
    'payment_by_idempotency_key',
    `SELECT p.*, o.user_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.idempotency_key = $1`,
    [key],
  );
  return rows[0];
}

function replay(res, payment, orderId, userId) {
  if (payment.order_id !== orderId || payment.user_id !== userId) {
    throw unprocessable('idempotency_key_reused', 'Idempotency-Key was already used for a different request');
  }
  paymentsTotal.inc({ outcome: 'replayed' });
  res.set('Idempotent-Replayed', 'true');
  return res.status(200).json(serializePayment(payment));
}

function forcedOutcome(req) {
  const value = req.get('x-test-force-outcome');
  if (!value || !config.allowTestHeaders) return undefined;
  if (value !== 'approve' && value !== 'decline') {
    throw badRequest('invalid_request', 'X-Test-Force-Outcome must be approve or decline');
  }
  return value;
}
