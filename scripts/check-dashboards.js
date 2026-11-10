// Verifies the provisioned Grafana dashboards have live data: every panel query is executed through
// Grafana's datasource proxy (the same path the panels use) for the most recent k6 run.
//
//   node scripts/check-dashboards.js        (npm run dashboards:check, while or right after a --prom run)
//
// Exits 1 if any panel returns no series.
const GRAFANA = process.env.GRAFANA_URL || 'http://localhost:3001';
const AUTH = 'Basic ' + Buffer.from(process.env.GRAFANA_AUTH || 'admin:admin').toString('base64');
const WINDOW_S = 600; // look back 10 minutes

async function get(path) {
  const res = await fetch(GRAFANA + path, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function promQuery(expr) {
  const end = Math.floor(Date.now() / 1000);
  const qs = new URLSearchParams({ query: expr, start: String(end - WINDOW_S), end: String(end), step: '15' });
  const body = await get(`/api/datasources/proxy/uid/prometheus/api/v1/query_range?${qs}`);
  return body.data.result.length;
}

function panelsOf(dashboard) {
  const out = [];
  const walk = (panels) =>
    panels.forEach((p) => {
      if (p.type === 'row') walk(p.panels || []);
      else if (p.targets?.some((t) => t.expr)) out.push(p);
    });
  walk(dashboard.panels);
  return out;
}

async function main() {
  // The run with the most recent samples (not the last in sort order).
  const latest = await get(
    `/api/datasources/proxy/uid/prometheus/api/v1/query?query=${encodeURIComponent('topk(1, max by (testid) (max_over_time(timestamp(k6_vus)[1h:15s])))')}`,
  );
  const testid = latest.data.result[0]?.metric.testid;
  if (!testid) throw new Error('No k6 runs in Prometheus yet. Run e.g. npm run test:smoke:prom first.');
  console.log(`Checking against latest k6 run: testid=${testid}\n`);

  const vars = {
    testid,
    quantile_stat: 'p95',
    __rate_interval: '30s',
    __interval: '15s',
    __range: `${WINDOW_S}s`,
    adhoc_filter: '',
    DS_PROMETHEUS: 'prometheus',
  };
  const fill = (expr) =>
    expr.replace(/\$\{(\w+)(?::\w+)?\}|\$(\w+)/g, (m, a, b) => (vars[a ?? b] !== undefined ? vars[a ?? b] : m));

  let failures = 0;
  for (const { uid } of await get('/api/search?type=dash-db')) {
    const { dashboard } = await get(`/api/dashboards/uid/${uid}`);
    console.log(`== ${dashboard.title}`);
    for (const panel of panelsOf(dashboard)) {
      const counts = [];
      for (const t of panel.targets.filter((x) => x.expr)) counts.push(await promQuery(fill(t.expr)));
      const ok = counts.some((n) => n > 0);
      // Failure panels legitimately have no series until the first failure happens.
      const noEvents = !ok && /fail|error|5xx/i.test(panel.title);
      if (!ok && !noEvents) failures++;
      const status = ok ? 'ok  ' : noEvents ? 'ok* ' : 'NONE';
      console.log(`  ${status} ${panel.title} (${counts.join('/')} series)${noEvents ? ' - no failures recorded' : ''}`);
    }
  }
  console.log(failures ? `\n${failures} panel(s) without data` : '\nAll panels have data');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
