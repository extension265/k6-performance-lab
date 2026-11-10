// Central configuration. Everything is driven by environment variables so the
// docker-compose file (and Phase 6 experiments) can flip behaviour without code changes.

const env = process.env;

function flag(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (['on', 'true', '1', 'yes'].includes(v)) return true;
  if (['off', 'false', '0', 'no'].includes(v)) return false;
  throw new Error(`Invalid boolean flag value: "${value}" (use on|off)`);
}

function number(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric value: "${value}"`);
  return n;
}

// BOTTLENECK_MODE sets the default for every seeded bottleneck (default: on).
// Each one can be overridden individually so fixes can be measured one at a time.
const mode = flag(env.BOTTLENECK_MODE, true);

const bottlenecks = {
  smallPool: flag(env.BOTTLENECK_POOL, mode), //        DB pool 5 instead of 20
  missingIndex: flag(env.BOTTLENECK_INDEX, mode), //    no index on payments.order_id
  nPlusOne: flag(env.BOTTLENECK_N_PLUS_ONE, mode), //   N+1 queries in GET /orders/:id
  highBcryptCost: flag(env.BOTTLENECK_BCRYPT, mode), // bcrypt cost 12 instead of 8
};

export const config = Object.freeze({
  port: number(env.PORT, 3000),

  db: {
    host: env.PGHOST ?? 'localhost',
    port: number(env.PGPORT, 5432),
    user: env.PGUSER ?? 'payflow',
    password: env.PGPASSWORD ?? 'payflow',
    database: env.PGDATABASE ?? 'payflow',
  },

  bottleneckMode: mode,
  bottlenecks: Object.freeze(bottlenecks),
  poolSize: number(env.POOL_SIZE, bottlenecks.smallPool ? 5 : 20),
  poolAcquireTimeoutMs: number(env.POOL_ACQUIRE_TIMEOUT_MS, 5000),
  bcryptCost: number(env.BCRYPT_COST, bottlenecks.highBcryptCost ? 12 : 8),

  jwtSecret: env.JWT_SECRET ?? 'local-dev-only-jwt-secret',
  jwtTtlSeconds: number(env.JWT_TTL_SECONDS, 3600),
  webhookSecret: env.WEBHOOK_SECRET ?? 'local-dev-only-webhook-secret',

  testUser: {
    email: env.TEST_USER_EMAIL ?? 'loadtest@payflow.local',
    password: env.TEST_USER_PASSWORD ?? 'payflow-loadtest',
  },

  provider: {
    latencyMinMs: number(env.PROVIDER_LATENCY_MIN_MS, 50),
    latencyMaxMs: number(env.PROVIDER_LATENCY_MAX_MS, 150),
    declineRate: number(env.DECLINE_RATE, 0.02),
  },

  // Allows the X-Test-Force-Outcome header so contract tests can be deterministic.
  allowTestHeaders: flag(env.ALLOW_TEST_HEADERS, true),
});

export function publicConfig() {
  return {
    bottleneckMode: config.bottleneckMode ? 'on' : 'off',
    bottlenecks: config.bottlenecks,
    poolSize: config.poolSize,
    bcryptCost: config.bcryptCost,
    provider: config.provider,
  };
}
