import { badRequest } from './errors.js';

export const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'INR']);
export const MAX_AMOUNT = 100_000_000; // minor units

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export function requireUuid(value, field) {
  if (!isUuid(value)) throw badRequest('invalid_request', `${field} must be a UUID`, { field });
  return value.toLowerCase();
}

export function parseOrderInput(body) {
  const errors = [];
  const { amount, currency } = body ?? {};
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    errors.push({ field: 'amount', message: `integer in minor units, 1..${MAX_AMOUNT}` });
  }
  if (!CURRENCIES.includes(currency)) {
    errors.push({ field: 'currency', message: `one of ${CURRENCIES.join(', ')}` });
  }
  if (errors.length) throw badRequest('invalid_request', 'Invalid order', errors);
  return { amount, currency };
}

const iso = (v) => (v instanceof Date ? v : new Date(v)).toISOString();

// Rows come either straight from pg (snake_case, Date) or from json_agg (snake_case, string).
export function serializePayment(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    idempotencyKey: row.idempotency_key,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    declineReason: row.decline_reason ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function serializeOrder(row, payments) {
  return {
    id: row.id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(payments && { payments: payments.map(serializePayment) }),
  };
}
