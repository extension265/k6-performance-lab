import { createApp } from './app.js';
import { ensureTestUser } from './auth.js';
import { config, publicConfig } from './config.js';
import { pool } from './db.js';
import { applyIndexToggle, waitForDb } from './migrations.js';

async function main() {
  console.log('[api] starting with', JSON.stringify(publicConfig()));
  await waitForDb();
  await applyIndexToggle();
  await ensureTestUser();

  const server = createApp().listen(config.port, () => {
    console.log(`[api] PayFlow listening on :${config.port}`);
  });
  // Keep-alive longer than typical load-generator idle timeouts to avoid connection churn.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const shutdown = (signal) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
