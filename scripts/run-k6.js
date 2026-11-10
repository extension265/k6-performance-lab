// Runs a k6 scenario in the pinned grafana/k6 container on the compose network.
//
//   node scripts/run-k6.js <scenario> [--fresh] [--prom] [-- <extra k6 args>]
//
//   --fresh   reset the DB to the seeded state and wait for /health first (npm run perf:fresh -- <scenario>)
//   --prom    also push metrics to Prometheus (remote write) for the Grafana dashboards, tagged with a
//             unique testid per run (npm run test:<scenario>:prom)
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

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090';

async function prometheusReady() {
  try {
    const res = await fetch(`${PROMETHEUS_URL}/-/ready`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  const own = sep === -1 ? argv : argv.slice(0, sep);
  const k6Extra = sep === -1 ? [] : argv.slice(sep + 1);

  const fresh = own.includes('--fresh');
  const prom = own.includes('--prom');
  const scenario = own.find((a) => !a.startsWith('--'));
  if (!scenario || !SCENARIOS.includes(scenario)) {
    console.error(`Usage: node scripts/run-k6.js <${SCENARIOS.join('|')}> [--fresh] [--prom] [-- <k6 args>]`);
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
  if (prom && !(await prometheusReady())) {
    console.error(`Prometheus is not ready at ${PROMETHEUS_URL}. Run "npm run stack:up" first.`);
    process.exit(1);
  }

  // testid labels every series of this run, so dashboards can isolate (and compare) runs.
  // Timestamp first so the dashboards' run picker sorts newest-first.
  const testid = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')}-${scenario}`;
  console.log(`[k6] scenario=${scenario} fresh=${fresh} prom=${prom} testid=${testid}`);
  console.log(`[k6] api config=${JSON.stringify(h.config)}`);

  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });

  const env = [
    ['K6_WEB_DASHBOARD', 'true'],
    ['K6_WEB_DASHBOARD_EXPORT', `/reports/${scenario}.html`],
    // No `url` tag: request ids would make one series per order/payment. `name` identifies endpoints.
    ['K6_SYSTEM_TAGS', 'status,method,name,group,check,error_code,scenario,expected_response'],
    ...(prom
      ? [
          ['K6_PROMETHEUS_RW_SERVER_URL', 'http://prometheus:9090/api/v1/write'],
          ['K6_PROMETHEUS_RW_PUSH_INTERVAL', '5s'],
          // Stats expected by the official k6 Prometheus dashboard (grafana.com 19665).
          ['K6_PROMETHEUS_RW_TREND_STATS', 'p(95),p(99),min,max,avg,med'],
        ]
      : []),
    ...FORWARDED_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
  ];
  const args = [
    'compose', 'run', '--rm', '--no-deps',
    ...env.flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    'k6', 'run',
    '--tag', `testid=${testid}`,
    ...(prom ? ['-o', 'experimental-prometheus-rw'] : []),
    ...k6Extra,
    `/scripts/scenarios/${scenario}.js`,
  ];
  const code = run('docker', args);
  console.log(`[k6] ${scenario} finished with exit code ${code}${code === 99 ? ' (thresholds breached)' : ''}`);
  process.exit(code);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
