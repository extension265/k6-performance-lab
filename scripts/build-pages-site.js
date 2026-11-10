// Builds the GitHub Pages site (_site/) from CI reports:
//   reports/newman/contract.html, reports/smoke.html (+ summary)  -> produced by this workflow run
//   pages-input/<scenario>/{<scenario>.html,<scenario>-summary.json,meta.json}  -> latest load-test artifacts
//
//   node scripts/build-pages-site.js
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, '_site');
const INPUT = path.join(ROOT, 'pages-input');
const { GITHUB_SERVER_URL = 'https://github.com', GITHUB_REPOSITORY = '', GITHUB_SHA = '', GITHUB_RUN_ID = '' } = process.env;
const repoUrl = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}`;

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function verdict(summary) {
  if (!summary) return { label: 'no summary', cls: 'unknown' };
  const failed = Object.values(summary.metrics).flatMap((m) => Object.values(m.thresholds ?? {})).filter((t) => !t.ok).length;
  return failed ? { label: `${failed} threshold(s) breached`, cls: 'fail' } : { label: 'all thresholds passed', cls: 'pass' };
}

function copy(from, toName) {
  if (!fs.existsSync(from)) return null;
  fs.copyFileSync(from, path.join(SITE, toName));
  return toName;
}

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });

const rows = [];
const runLink = (id) => (id ? `<a href="${repoUrl}/actions/runs/${esc(id)}">run ${esc(id)}</a>` : '');

// Reports produced by this workflow run (from main).
const contract = readJson(path.join(ROOT, 'reports', 'newman', 'contract.json'));
const contractHtml = copy(path.join(ROOT, 'reports', 'newman', 'contract.html'), 'contract.html');
if (contractHtml) {
  const a = contract?.run.stats.assertions;
  rows.push({
    name: 'Newman contract',
    href: contractHtml,
    verdict: a ? (a.failed ? { label: `${a.failed} assertion(s) failed`, cls: 'fail' } : { label: `${a.total}/${a.total} assertions passed`, cls: 'pass' }) : verdict(null),
    when: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    source: `main @ <code>${esc(GITHUB_SHA.slice(0, 7))}</code>, ${runLink(GITHUB_RUN_ID)}`,
  });
}
const smokeHtml = copy(path.join(ROOT, 'reports', 'smoke.html'), 'smoke.html');
if (smokeHtml) {
  rows.push({
    name: 'k6 smoke',
    href: smokeHtml,
    verdict: verdict(readJson(path.join(ROOT, 'reports', 'smoke-summary.json'))),
    when: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    source: `main @ <code>${esc(GITHUB_SHA.slice(0, 7))}</code>, ${runLink(GITHUB_RUN_ID)}`,
  });
}

// Latest manual load-test runs, one per scenario.
if (fs.existsSync(INPUT)) {
  for (const scenario of fs.readdirSync(INPUT).sort()) {
    const dir = path.join(INPUT, scenario);
    const html = copy(path.join(dir, `${scenario}.html`), `${scenario}.html`);
    if (!html) continue;
    const meta = readJson(path.join(dir, 'meta.json')) ?? {};
    rows.push({
      name: `k6 ${scenario}`,
      href: html,
      verdict: verdict(readJson(path.join(dir, `${scenario}-summary.json`))),
      when: meta.created_at ? meta.created_at.slice(0, 16).replace('T', ' ') + ' UTC' : '',
      source: `Load test workflow, ${runLink(meta.run_id)}`,
    });
  }
}

const tableRows = rows
  .map(
    (r) => `<tr><td><a href="${esc(r.href)}">${esc(r.name)}</a></td><td><span class="badge ${r.verdict.cls}">${esc(r.verdict.label)}</span></td><td>${esc(r.when)}</td><td>${r.source}</td></tr>`,
  )
  .join('\n');

fs.writeFileSync(
  path.join(SITE, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>k6 Performance Lab reports</title>
<style>
  :root { --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --line: #d1d9e0; --pass: #1a7f37; --fail: #cf222e; --link: #0969da; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #3d444d; --pass: #3fb950; --fail: #f85149; --link: #4493f8; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 16px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  p { color: var(--muted); margin: 8px 0; }
  a { color: var(--link); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; font-size: 13px; }
  .badge { font-size: 13px; font-weight: 600; }
  .pass { color: var(--pass); } .fail { color: var(--fail); } .unknown { color: var(--muted); }
  .note { border-left: 3px solid var(--line); padding-left: 12px; }
</style>
</head>
<body>
<main>
  <h1>k6 Performance Lab: latest reports</h1>
  <p>HTML reports from CI for <a href="${repoUrl}">${esc(GITHUB_REPOSITORY)}</a>: the Newman contract run, the k6 web dashboard export for each scenario, and whether its thresholds held.</p>
  <div class="table-wrap">
  <table>
    <thead><tr><th>Report</th><th>Thresholds</th><th>When</th><th>Source</th></tr></thead>
    <tbody>
${tableRows || '<tr><td colspan="4">No reports yet.</td></tr>'}
    </tbody>
  </table>
  </div>
  <p class="note">These runs use shared GitHub-hosted runners, so latency varies from run to run. They show that the system is functionally correct under load. They are not performance results. Controlled before/after measurements are in <a href="${repoUrl}/blob/main/docs/results.md">docs/results.md</a>.</p>
</main>
</body>
</html>
`,
);
console.log(`Built ${path.relative(ROOT, SITE)} with ${rows.length} report(s)`);
