-- PayFlow schema + seed data.
-- Runs once, on first start of an empty Postgres volume (docker-entrypoint-initdb.d).
-- To re-seed: npm run stack:reset
--
-- NOTE (intentional, seeded bottleneck): there is NO index on payments.order_id here.
-- The API creates or drops idx_payments_order_id at startup depending on BOTTLENECK_INDEX,
-- so the "missing index" bottleneck can be toggled without re-seeding.

CREATE TABLE users (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text,                       -- set by the API at startup for the test user
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    integer NOT NULL REFERENCES users (id),
  amount     integer NOT NULL CHECK (amount > 0),          -- minor units (cents)
  currency   char(3) NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders (id),
  idempotency_key text NOT NULL UNIQUE,
  amount          integer NOT NULL CHECK (amount > 0),
  currency        char(3) NOT NULL,
  status          text NOT NULL
                  CHECK (status IN ('processing', 'authorized', 'declined', 'captured', 'failed')),
  decline_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Volume is sized so a sequential scan of payments is measurably slower than an index lookup
-- (~200k orders, ~500k payments). Smaller seeds hide the missing-index bottleneck.

-- Users: #1 is the load-test user (password set by the API), the rest only own seeded history.
INSERT INTO users (email)
SELECT CASE WHEN i = 1 THEN 'loadtest@payflow.local' ELSE format('customer%s@payflow.local', i) END
FROM generate_series(1, 1000) AS i;

-- 200,000 historical orders spread across the 1,000 users and the last 90 days.
INSERT INTO orders (user_id, amount, currency, status, created_at, updated_at)
SELECT (i % 1000) + 1,
       500 + (abs(hashtext('amt' || i)) % 99500),
       (ARRAY['USD', 'EUR', 'GBP', 'INR'])[1 + (i % 4)],
       'paid',
       ts, ts
FROM generate_series(1, 200000) AS i,
     LATERAL (SELECT now() - make_interval(secs => abs(hashtext('ts' || i)) % (90 * 86400))) AS t(ts);

-- 1-4 payment attempts per order: earlier attempts declined, the last one captured (~500k rows).
INSERT INTO payments (order_id, idempotency_key, amount, currency, status, decline_reason, created_at, updated_at)
SELECT o.id,
       gen_random_uuid()::text,
       o.amount,
       o.currency,
       CASE WHEN a.n = a.total THEN 'captured' ELSE 'declined' END,
       CASE WHEN a.n = a.total THEN NULL ELSE 'insufficient_funds' END,
       o.created_at + make_interval(secs => a.n * 30),
       o.created_at + make_interval(secs => a.n * 30)
FROM orders o
CROSS JOIN LATERAL (
  SELECT n, 1 + (abs(hashtext(o.id::text)) % 4) AS total
  FROM generate_series(1, 1 + (abs(hashtext(o.id::text)) % 4)) AS n
) AS a;

ANALYZE;
