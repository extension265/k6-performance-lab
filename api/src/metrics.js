import client from 'prom-client';
import { config } from './config.js';

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

const latencyBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, by route template',
  labelNames: ['method', 'route', 'status_code'],
  buckets: latencyBuckets,
  registers: [register],
});

export const dbQueryDuration = new client.Histogram({
  name: 'payflow_db_query_duration_seconds',
  help: 'Time spent executing a DB query (excludes pool wait), by query name',
  labelNames: ['query'],
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const dbPoolAcquireDuration = new client.Histogram({
  name: 'payflow_db_pool_acquire_duration_seconds',
  help: 'Time spent waiting to check a connection out of the pool',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const paymentsTotal = new client.Counter({
  name: 'payflow_payments_total',
  help: 'Payment attempts by outcome (authorized, declined, replayed)',
  labelNames: ['outcome'],
  registers: [register],
});

const bottleneckInfo = new client.Gauge({
  name: 'payflow_bottleneck_enabled',
  help: '1 if a seeded bottleneck is enabled, 0 if fixed',
  labelNames: ['bottleneck'],
  registers: [register],
});
for (const [name, enabled] of Object.entries(config.bottlenecks)) {
  bottleneckInfo.set({ bottleneck: name }, enabled ? 1 : 0);
}

new client.Gauge({
  name: 'payflow_bcrypt_cost',
  help: 'Configured bcrypt cost factor',
  registers: [register],
}).set(config.bcryptCost);

// Pool gauges read live values from the pg Pool at scrape time.
export function registerPoolMetrics(pool) {
  const gauge = (name, help, read) =>
    new client.Gauge({
      name,
      help,
      registers: [register],
      collect() {
        this.set(read());
      },
    });

  gauge('payflow_db_pool_max', 'Configured maximum pool size', () => config.poolSize);
  gauge('payflow_db_pool_total', 'Connections currently open', () => pool.totalCount);
  gauge('payflow_db_pool_idle', 'Open connections that are idle', () => pool.idleCount);
  gauge('payflow_db_pool_in_use', 'Connections checked out', () => pool.totalCount - pool.idleCount);
  gauge('payflow_db_pool_waiting', 'Requests queued waiting for a connection', () => pool.waitingCount);
}
