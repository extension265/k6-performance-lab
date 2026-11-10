// Stack helpers shared by the npm scripts. Node instead of shell so everything runs on Windows as-is.
const { spawnSync } = require('node:child_process');

const HEALTH_URL = process.env.HEALTH_URL || 'http://localhost:3000/health';

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

function mustRun(cmd, args) {
  const code = run(cmd, args);
  if (code !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${code}`);
}

async function health() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function waitForHealth({ timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const h = await health();
    if (h) return h;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`API not healthy at ${HEALTH_URL} after ${timeoutMs / 1000}s`);
}

/**
 * Wipe the database volume, start the stack again (re-running init.sql) and wait for /health,
 * so every measured run starts from the same seeded data.
 */
async function freshStack() {
  const started = Date.now();
  console.log('[stack] resetting: docker compose down -v');
  mustRun('docker', ['compose', 'down', '-v']);
  console.log('[stack] starting and re-seeding: docker compose up -d --build --wait');
  mustRun('docker', ['compose', 'up', '-d', '--build', '--wait']);
  const h = await waitForHealth();
  console.log(`[stack] fresh stack healthy in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return h;
}

module.exports = { run, mustRun, health, waitForHealth, freshStack, HEALTH_URL };

if (require.main === module) {
  freshStack().catch((err) => {
    console.error(`[stack] ${err.message}`);
    process.exit(1);
  });
}
