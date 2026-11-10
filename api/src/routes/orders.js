import { config } from '../config.js';
import { query } from '../db.js';
import { notFound } from '../errors.js';
import { parseOrderInput, requireUuid, serializeOrder } from '../validation.js';

export async function createOrder(req, res) {
  const { amount, currency } = parseOrderInput(req.body);
  const { rows } = await query(
    'insert_order',
    `INSERT INTO orders (user_id, amount, currency) VALUES ($1, $2, $3) RETURNING *`,
    [req.userId, amount, currency],
  );
  res.status(201).json(serializeOrder(rows[0], []));
}

export async function getOrder(req, res) {
  const id = requireUuid(req.params.id, 'id');
  const order = config.bottlenecks.nPlusOne
    ? await loadOrderNPlusOne(id, req.userId)
    : await loadOrderJoin(id, req.userId);
  if (!order) throw notFound('Order');
  res.json(order);
}

// SEEDED BOTTLENECK (BOTTLENECK_N_PLUS_ONE=on): 1 query for the order, 1 for payment ids,
// then 1 query per payment, each on its own pool checkout.
async function loadOrderNPlusOne(id, userId) {
  const { rows } = await query('order_by_id', 'SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rows[0]) return null;

  const ids = await query(
    'payment_ids_by_order',
    'SELECT id FROM payments WHERE order_id = $1 ORDER BY created_at',
    [id],
  );
  const payments = [];
  for (const { id: paymentId } of ids.rows) {
    const p = await query('payment_by_id', 'SELECT * FROM payments WHERE id = $1', [paymentId]);
    payments.push(p.rows[0]);
  }
  return serializeOrder(rows[0], payments);
}

// Fixed version: a single LEFT JOIN with the payments aggregated in Postgres.
async function loadOrderJoin(id, userId) {
  const { rows } = await query(
    'order_with_payments',
    `SELECT o.*,
            COALESCE(json_agg(p ORDER BY p.created_at) FILTER (WHERE p.id IS NOT NULL), '[]') AS payments
       FROM orders o
       LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.id = $1 AND o.user_id = $2
      GROUP BY o.id`,
    [id, userId],
  );
  return rows[0] ? serializeOrder(rows[0], rows[0].payments) : null;
}
