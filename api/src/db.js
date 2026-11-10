import pg from 'pg';
import { config } from './config.js';
import { dbPoolAcquireDuration, dbQueryDuration, registerPoolMetrics } from './metrics.js';

export const pool = new pg.Pool({
  ...config.db,
  max: config.poolSize,
  connectionTimeoutMillis: config.poolAcquireTimeoutMs,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => console.error('[db] idle client error:', err.message));
registerPoolMetrics(pool);

async function acquire() {
  const end = dbPoolAcquireDuration.startTimer();
  try {
    return await pool.connect();
  } finally {
    end();
  }
}

async function run(client, name, text, params) {
  const end = dbQueryDuration.startTimer({ query: name });
  try {
    return await client.query(text, params);
  } finally {
    end();
  }
}

/** Run one named query on its own pool checkout. */
export async function query(name, text, params = []) {
  const client = await acquire();
  try {
    return await run(client, name, text, params);
  } finally {
    client.release();
  }
}

/**
 * Run fn(q) inside a transaction on a single connection, where q(name, text, params)
 * executes a named query. The connection is held for the whole callback.
 */
export async function withTransaction(fn) {
  const client = await acquire();
  const q = (name, text, params = []) => run(client, name, text, params);
  try {
    await client.query('BEGIN');
    const result = await fn(q);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
      client.release();
    } catch {
      client.release(true); // connection is broken; drop it from the pool
    }
    throw err;
  }
}
