// Runs a k6 scenario in the pinned grafana/k6 container on the compose network.
//
//   node scripts/run-k6.js <scenario> [--fresh] [-- <extra k6 args>]
//
//   --fresh   reset the DB to the seeded state and wait for /health first (npm run perf:fresh -- <scenario>)
//
// Outputs: reports/<scenario>-summary.json (handleSummary) and reports/<scenario>.html (web dashboard).
// k6's exit code is passed through, so threshold breaches (exit 99) fail the npm script.
const fs = require('node:fs');
const path = require('node:path');
const { freshStack, health, run, HEALTH_URL } = require('./stack.js');

const ROOT = path.resolve(__dirname, '..');
const SCENARIOS = fs
  .readdirSync(path.join(ROOT, 'k6', 'scenarios'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => f.replace(/\.js$/, ''));

// Env vars forwarded to k6 when set in the calling shell (see k6/lib/config.js and scenarios).
const FORWARDED_ENV = [
  'FRESH_AUTH_RATIO',
  'THINK_TIME',
  'SOAK_DURATION',
  'BREAKPOINT_MAX_RATE',
  'BREAKPOINT_RAMP',
  'BREAKPOINT_MAX_VUS',
];

async function main() {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  const own = sep === -1 ? argv : argv.slice(0, sep);
  const k6Extra = sep === -1 ? [] : argv.slice(sep + 1);

  const fresh = own.includes('--fresh');
  const scenario = own.find((a) => !a.startsWith('--'));
  if (!scenario || !SCENARIOS.includes(scenario)) {
    console.error(`Usage: node scripts/run-k6.js <${SCENARIOS.join('|')}> [--fresh] [-- <k6 args>]`);
    process.exit(2);
  }

  let h;
  if (fresh) {
    h = await freshStack();
  } else {
    h = await health();
    if (!h) {
      console.error(`API is not healthy at ${HEALTH_URL}. Run "npm run stack:up" first (or use perf:fresh).`);
      process.exit(1);
    }
  }
  console.log(`[k6] scenario=${scenario} fresh=${fresh} api config=${JSON.stringify(h.config)}`);

  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });

  const env = [
    ['K6_WEB_DASHBOARD', 'true'],
    ['K6_WEB_DASHBOARD_EXPORT', `/reports/${scenario}.html`],
    ...FORWARDED_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
  ];
  const args = [
    'compose', 'run', '--rm', '--no-deps',
    ...env.flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    'k6', 'run', ...k6Extra, `/scripts/scenarios/${scenario}.js`,
  ];
  const code = run('docker', args);
  console.log(`[k6] ${scenario} finished with exit code ${code}${code === 99 ? ' (thresholds breached)' : ''}`);
  process.exit(code);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
