// Target selection and run settings, all overridable via __ENV (k6 run -e NAME=value).

const TARGETS = {
  docker: 'http://api:3000', //        k6 running in the compose network (npm run test:*)
  local: 'http://localhost:3000', //   k6 installed on the host
};

const target = __ENV.TARGET || 'docker';
if (!__ENV.BASE_URL && !TARGETS[target]) {
  throw new Error(`Unknown TARGET "${target}". Use one of: ${Object.keys(TARGETS).join(', ')}, or set BASE_URL.`);
}

export const BASE_URL = (__ENV.BASE_URL || TARGETS[target]).replace(/\/$/, '');

// Guard rail: this suite must only ever generate load against the local stack.
const ALLOWED_HOSTS = ['api', 'localhost', '127.0.0.1', 'host.docker.internal'];
const host = BASE_URL.replace(/^https?:\/\//, '').split(/[:/]/)[0];
if (!ALLOWED_HOSTS.includes(host)) {
  throw new Error(`Refusing to load test "${host}". Only the local stack is allowed: ${ALLOWED_HOSTS.join(', ')}.`);
}

export const CREDENTIALS = {
  email: __ENV.TEST_USER_EMAIL || 'loadtest@payflow.local',
  password: __ENV.TEST_USER_PASSWORD || 'payflow-loadtest',
};

export const WEBHOOK_SECRET = __ENV.WEBHOOK_SECRET || 'local-dev-only-webhook-secret';

// Share of iterations that call POST /auth/token instead of reusing the setup() token.
// Without this, the bcrypt bottleneck never shows up under load. Set to 0 to exclude auth.
export const FRESH_AUTH_RATIO = number('FRESH_AUTH_RATIO', 0.15, 0, 1);

// Pause between iterations for VU-based scenarios (seconds). Arrival-rate scenarios ignore it.
export const THINK_TIME = number('THINK_TIME', 1, 0, 60);

export const REPORTS_DIR = (__ENV.REPORTS_DIR || '/reports').replace(/\/$/, '');

function number(name, fallback, min, max) {
  if (__ENV[name] === undefined || __ENV[name] === '') return fallback;
  const n = Number(__ENV[name]);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number in [${min}, ${max}]`);
  return n;
}
