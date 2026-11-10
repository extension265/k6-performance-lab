// Renders a Markdown results table from the k6 summary JSON (+ Newman JSON if present).
// In GitHub Actions it is appended to $GITHUB_STEP_SUMMARY; locally it prints to stdout.
//
//   node scripts/ci-summary.js [scenario]      (default: smoke)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const scenario = process.argv[2] || 'smoke';
const k6File = path.join(ROOT, 'reports', `${scenario}-summary.json`);
const newmanFile = path.join(ROOT, 'reports', 'newman', 'contract.json');

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const pct = (v) => `${(v * 100).toFixed(2)}%`;
const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(1)} ms`);

// "p(95)<500" -> value of values["p(95)"]; "rate<0.01" -> values.rate; "count==0" -> values.count
function actual(metric, expression) {
  const stat = expression.match(/^\s*([a-z]+(?:\(\d+(?:\.\d+)?\))?)/i)?.[1];
  const v = metric.values?.[stat];
  if (v === undefined) return 'n/a';
  if (metric.type === 'rate') return pct(v);
  if (metric.type === 'trend' && metric.contains === 'time') return ms(v);
  return String(v);
}

const lines = [];
const k6 = readJson(k6File);

if (k6) {
  const rows = [];
  for (const [name, metric] of Object.entries(k6.metrics)) {
    for (const [expression, result] of Object.entries(metric.thresholds ?? {})) {
      rows.push(`| \`${name}\` | \`${expression}\` | ${actual(metric, expression)} | ${result.ok ? '✅ pass' : '❌ FAIL'} |`);
    }
  }
  const failed = rows.filter((r) => r.includes('FAIL')).length;
  lines.push(`### k6 ${scenario}: ${failed ? `❌ ${failed} threshold(s) breached` : '✅ all thresholds passed'}`, '');
  lines.push('| Metric | Threshold | Actual | Result |', '|---|---|---|---|', ...rows, '');

  const m = k6.metrics;
  const info = [
    ['Journeys (iterations)', m.iterations?.values.count],
    ['HTTP requests', m.http_reqs?.values.count],
    ['Payment success rate (declines are simulated at ~2%)', m.payment_success_rate && pct(m.payment_success_rate.values.rate)],
    ['Checks passed', m.checks && `${m.checks.values.passes} / ${m.checks.values.passes + m.checks.values.fails}`],
  ].filter(([, v]) => v !== undefined);
  lines.push('| Run info | Value |', '|---|---|', ...info.map(([k, v]) => `| ${k} | ${v} |`), '');
} else {
  lines.push(`### k6 ${scenario}: ❌ no summary found (${path.relative(ROOT, k6File)})`, '');
}

const newman = readJson(newmanFile);
if (newman) {
  const a = newman.run.stats.assertions;
  const r = newman.run.stats.requests;
  lines.push(
    `### Newman contract: ${a.failed ? `❌ ${a.failed} assertion(s) failed` : '✅ all assertions passed'}`,
    '',
    `${a.total - a.failed} / ${a.total} assertions passed across ${r.total} requests.`,
    '',
  );
  for (const f of newman.run.failures.slice(0, 10)) {
    lines.push(`- ❌ **${f.source?.name ?? 'request'}**: ${f.error?.test ?? ''}: ${f.error?.message ?? ''}`);
  }
  if (newman.run.failures.length) lines.push('');
}

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY } = process.env;
const resultsUrl = GITHUB_REPOSITORY ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/blob/main/docs/results.md` : 'docs/results.md';
lines.push(
  '> Latency numbers here come from shared GitHub-hosted runners and vary from run to run. CI gates on **functional',
  '> correctness under light load** (thresholds, `idempotency_violations == 0`, Newman). The latency numbers are not',
  `> performance results. See [docs/results.md](${resultsUrl}) for controlled measurements.`,
  '',
);

const out = lines.join('\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
else console.log(out);
