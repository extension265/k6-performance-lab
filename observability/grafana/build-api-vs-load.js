// Generates observability/grafana/dashboards/api-vs-load.json, the "API vs Load" dashboard.
//
// Load (what k6 did) next to what the API and the database were doing at the same time,
// plus container CPU (including k6 itself). Correlating these rows is the point of the dashboard.
// Edit this file, then: npm run dashboards:build  (also asks a running Grafana to reload provisioning,
// since file-change polling is unreliable through Docker Desktop bind mounts on Windows).

const fs = require('node:fs');
const path = require('node:path');

const DS = { type: 'prometheus', uid: 'prometheus' };
const K6 = 'testid=~"$testid"';
const SVC = 'container_label_com_docker_compose_service';
const RI = '$__rate_interval';

let nextId = 1;
let y = 0;

const target = (expr, legendFormat, refId = 'A') => ({ datasource: DS, expr, legendFormat, refId, range: true });

function row(title) {
  const panel = { id: nextId++, type: 'row', title, collapsed: false, gridPos: { h: 1, w: 24, x: 0, y }, panels: [] };
  y += 1;
  return panel;
}

/** Lay panels out left to right on one line. Widths must add up to 24; height = tallest panel. */
function line(...specs) {
  let x = 0;
  const height = Math.max(...specs.map((s) => s.h ?? 9));
  const panels = specs.map(({ w, h, ...spec }) => {
    const p = panel({ ...spec, gridPos: { h: height, w, x, y } });
    x += w;
    return p;
  });
  y += height;
  return panels;
}

function panel({ title, description, type = 'timeseries', unit, targets, gridPos, min, max, softMax, thresholds, stack, legendRight, overrides = [], options = {} }) {
  return {
    id: nextId++,
    type,
    title,
    description,
    datasource: DS,
    gridPos,
    targets: targets.map((t, i) => ({ ...t, refId: String.fromCharCode(65 + i) })),
    fieldConfig: {
      defaults: {
        unit,
        min,
        max,
        color: { mode: thresholds && type !== 'timeseries' ? 'thresholds' : 'palette-classic' },
        thresholds: thresholds ?? { mode: 'absolute', steps: [{ color: 'green', value: null }] },
        custom:
          type === 'timeseries'
            ? {
                drawStyle: 'line',
                lineWidth: 2,
                fillOpacity: stack ? 30 : 8,
                showPoints: 'never',
                spanNulls: true,
                stacking: { mode: stack ? 'normal' : 'none' },
                thresholdsStyle: { mode: thresholds ? 'line+area' : 'off' },
                ...(softMax !== undefined && { axisSoftMax: softMax }),
              }
            : undefined,
      },
      overrides,
    },
    options: {
      legend: {
        displayMode: 'table',
        placement: legendRight ? 'right' : 'bottom',
        calcs: ['mean', 'max', 'lastNotNull'],
        sortBy: 'Mean',
        sortDesc: true,
        showLegend: true,
      },
      tooltip: { mode: 'multi', sort: 'desc' },
      ...options,
    },
  };
}

const redAt = (value) => ({ mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'red', value }] });
const cpuPctOfLimit = (svcRegex) =>
  `100 * sum by (${SVC}) (rate(container_cpu_usage_seconds_total{${SVC}=~"${svcRegex}"}[${RI}]))` +
  ` / sum by (${SVC}) (container_spec_cpu_quota{${SVC}=~"${svcRegex}"} / container_spec_cpu_period{${SVC}=~"${svcRegex}"})`;

const panels = [
  row('Load generated (k6)'),
  ...line(
    { w: 6, title: 'Virtual users', unit: 'none', targets: [target(`sum(k6_vus{${K6}})`, 'VUs')] },
    {
      w: 6,
      title: 'Request rate (k6)',
      unit: 'reqps',
      targets: [target(`sum(rate(k6_http_reqs_total{${K6}}[${RI}]))`, 'req/s')],
    },
    {
      w: 6,
      title: 'Error rate (k6)',
      description: 'Share of requests with an unexpected status (http_req_failed). SLO: < 1%.',
      unit: 'percentunit',
      min: 0,
      softMax: 0.02,
      thresholds: redAt(0.01),
      targets: [
        target(
          `(sum(rate(k6_http_reqs_total{${K6}, expected_response="false"}[${RI}])) or vector(0)) / sum(rate(k6_http_reqs_total{${K6}}[${RI}]))`,
          'error rate',
        ),
      ],
    },
    {
      w: 6,
      title: 'Checkout journey p95 (k6)',
      description: 'checkout_duration p95 (full journey, auth excluded). SLO: < 1.5 s.',
      unit: 's',
      thresholds: redAt(1.5),
      targets: [target(`max(k6_checkout_duration_p95{${K6}})`, 'checkout p95')],
    },
  ),
  ...line({
    w: 24,
    h: 10,
    legendRight: true,
    title: 'p95 latency by endpoint (k6, client side)',
    description: 'Includes time spent queued in the API. SLO for POST /payments: < 500 ms.',
    unit: 's',
    targets: [target(`max by (name) (k6_http_req_duration_p95{${K6}})`, '{{name}}')],
  }),

  row('API (server side)'),
  ...line(
    {
      w: 8,
      h: 10,
      title: 'Request rate by route (API)',
      unit: 'reqps',
      stack: true,
      targets: [target(`sum by (route) (rate(http_request_duration_seconds_count{job="payflow-api"}[${RI}]))`, '{{route}}')],
    },
    {
      w: 8,
      title: 'p95 latency by route (API)',
      unit: 's',
      targets: [
        target(
          `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{job="payflow-api"}[${RI}])))`,
          '{{route}}',
        ),
      ],
    },
    {
      w: 8,
      title: '5xx responses (API)',
      description: '503 db_pool_timeout = a request waited longer than POOL_ACQUIRE_TIMEOUT_MS for a connection.',
      unit: 'reqps',
      targets: [
        target(
          `sum by (route, status_code) (rate(http_request_duration_seconds_count{job="payflow-api", status_code=~"5.."}[${RI}]))`,
          '{{route}} {{status_code}}',
        ),
        target('sum(rate(http_request_duration_seconds_count{job="payflow-api", status_code=~"5.."}[' + RI + '])) or vector(0)', 'all 5xx'),
      ],
    },
  ),

  row('Database'),
  ...line(
    {
      w: 8,
      title: 'DB pool: in use / waiting / max',
      description: 'Waiting > 0 means requests are queued for a connection: the pool is the bottleneck.',
      unit: 'none',
      targets: [
        target('sum(payflow_db_pool_in_use)', 'in use'),
        target('sum(payflow_db_pool_waiting)', 'waiting'),
        target('max(payflow_db_pool_max)', 'max'),
      ],
      overrides: [
        { matcher: { id: 'byName', options: 'waiting' }, properties: [{ id: 'color', value: { mode: 'fixed', fixedColor: 'red' } }] },
        {
          matcher: { id: 'byName', options: 'max' },
          properties: [
            { id: 'color', value: { mode: 'fixed', fixedColor: 'text' } },
            { id: 'custom.lineStyle', value: { fill: 'dash', dash: [10, 10] } },
            { id: 'custom.fillOpacity', value: 0 },
          ],
        },
      ],
    },
    {
      w: 8,
      title: 'Pool acquire wait p95',
      description: 'Time a request waited to get a DB connection, before running any query.',
      unit: 's',
      targets: [
        target(
          `histogram_quantile(0.95, sum by (le) (rate(payflow_db_pool_acquire_duration_seconds_bucket[${RI}])))`,
          'acquire p95',
        ),
      ],
    },
    {
      w: 8,
      title: 'Active seeded bottlenecks',
      type: 'stat',
      thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'orange', value: 1 }] },
      targets: [target('max by (bottleneck) (payflow_bottleneck_enabled)', '{{bottleneck}}')],
      options: {
        reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
        colorMode: 'background',
        textMode: 'value_and_name',
        graphMode: 'none',
        legend: undefined,
        tooltip: undefined,
      },
      overrides: [],
    },
  ),
  ...line(
    {
      w: 12,
      h: 11,
      title: 'Query rate by query name',
      description: 'Under the N+1 bottleneck, payment_by_id rises with every GET /orders/:id.',
      unit: 'ops',
      stack: true,
      targets: [target(`sum by (query) (rate(payflow_db_query_duration_seconds_count[${RI}])) > 0`, '{{query}}')],
    },
    {
      w: 12,
      title: 'Query p95 by query name',
      description: 'Execution time only (excludes pool wait). A missing index shows up in payment_ids_by_order / order_with_payments.',
      unit: 's',
      targets: [
        target(
          `histogram_quantile(0.95, sum by (le, query) (rate(payflow_db_query_duration_seconds_bucket[${RI}]) > 0))`,
          '{{query}}',
        ),
      ],
    },
  ),

  row('Resources (cAdvisor): is the load generator the bottleneck?'),
  ...line(
    {
      w: 6,
      title: 'k6 CPU (% of its limit)',
      description: 'Peak over the selected range. Above 80% the load generator is saturated and the run is INVALID (PLAN.md Phase 6).',
      type: 'gauge',
      unit: 'percent',
      min: 0,
      max: 100,
      thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'orange', value: 60 }, { color: 'red', value: 80 }] },
      targets: [target(cpuPctOfLimit('k6'), 'k6')],
      options: {
        reduceOptions: { calcs: ['max'], fields: '', values: false },
        showThresholdMarkers: true,
        legend: undefined,
        tooltip: undefined,
      },
    },
    {
      w: 18,
      title: 'CPU % of container limit',
      description: 'api capped at 1 CPU, postgres 2, k6 2. Red line: 80%.',
      unit: 'percent',
      min: 0,
      thresholds: redAt(80),
      targets: [target(cpuPctOfLimit('api|postgres|k6'), `{{${SVC}}}`)],
    },
  ),
  ...line({
    w: 24,
    h: 8,
    legendRight: true,
    title: 'Memory working set by container',
    unit: 'bytes',
    targets: [
      target(`sum by (${SVC}) (container_memory_working_set_bytes{${SVC}=~"api|postgres|k6"})`, `{{${SVC}}}`),
    ],
  }),
];

const dashboard = {
  uid: 'api-vs-load',
  title: 'API vs Load',
  description: 'k6 load next to API, DB pool and container metrics. Generated by observability/grafana/build-api-vs-load.js.',
  tags: ['k6', 'payflow'],
  editable: true,
  schemaVersion: 39,
  version: 1,
  refresh: '5s',
  time: { from: 'now-15m', to: 'now' },
  timezone: 'browser',
  graphTooltip: 1, // shared crosshair: hover one panel, see the same moment in every panel
  links: [{ title: 'k6 Prometheus (official)', type: 'dashboards', tags: ['k6'], asDropdown: false }],
  templating: {
    list: [
      {
        name: 'testid',
        label: 'k6 run',
        type: 'query',
        datasource: DS,
        query: { query: 'label_values(k6_vus, testid)', refId: 'testid' },
        definition: 'label_values(k6_vus, testid)',
        refresh: 2, // on time range change
        sort: 2, //    alphabetical desc: testids start with a timestamp, so newest first
        includeAll: false,
        multi: false,
      },
    ],
  },
  annotations: { list: [] },
  panels,
};

const out = path.join(__dirname, 'dashboards', 'api-vs-load.json');
fs.writeFileSync(out, JSON.stringify(dashboard, null, 2) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), out)} (${panels.filter((p) => p.type !== 'row').length} panels)`);

// Reload provisioned dashboards in a running Grafana (no-op if the stack is down).
const GRAFANA = process.env.GRAFANA_URL || 'http://localhost:3001';
const AUTH = 'Basic ' + Buffer.from(process.env.GRAFANA_AUTH || 'admin:admin').toString('base64');
fetch(`${GRAFANA}/api/admin/provisioning/dashboards/reload`, {
  method: 'POST',
  headers: { Authorization: AUTH },
  signal: AbortSignal.timeout(3000),
})
  .then((res) => console.log(res.ok ? 'Grafana provisioning reloaded' : `Grafana reload failed: HTTP ${res.status}`))
  .catch(() => console.log('Grafana not running; dashboards load on next start'));
