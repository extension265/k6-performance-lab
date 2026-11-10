import { config } from './config.js';
import { query } from './db.js';

/**
 * SEEDED BOTTLENECK (BOTTLENECK_INDEX): the payments.order_id index is created when the
 * bottleneck is off and dropped when it is on, so the toggle works on an existing database.
 */
export async function applyIndexToggle() {
  if (config.bottlenecks.missingIndex) {
    await query('drop_index', 'DROP INDEX IF EXISTS idx_payments_order_id');
  } else {
    await query('create_index', 'CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id)');
  }
  await query('analyze_payments', 'ANALYZE payments');
  console.log(`[db] payments.order_id index ${config.bottlenecks.missingIndex ? 'absent' : 'present'}`);
}

/** Wait for Postgres to accept queries (compose healthcheck covers most of this; belt and braces). */
export async function waitForDb({ attempts = 30, delayMs = 1000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await query('health', 'SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`[db] waiting for database (${i}/${attempts}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
