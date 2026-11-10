// Generates postman/payflow.postman_collection.json (Postman Collection v2.1).
//
// The collection is generated rather than hand-edited so the test scripts and JSON schemas stay
// readable here instead of being escaped strings in JSON. Edit this file, then run:
//   npm run contract:build
// The generated collection is committed and can be imported into Postman as-is.

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------- JSON schemas (the contract)
const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const ISO_DATE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$';
const CURRENCY = { type: 'string', enum: ['USD', 'EUR', 'GBP', 'INR'] };

const payment = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'orderId', 'idempotencyKey', 'amount', 'currency', 'status', 'declineReason', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', pattern: UUID },
    orderId: { type: 'string', pattern: UUID },
    idempotencyKey: { type: 'string', minLength: 1 },
    amount: { type: 'integer', minimum: 1 },
    currency: CURRENCY,
    status: { type: 'string', enum: ['authorized', 'declined', 'captured', 'failed'] },
    declineReason: { type: ['string', 'null'] },
    createdAt: { type: 'string', pattern: ISO_DATE },
    updatedAt: { type: 'string', pattern: ISO_DATE },
  },
};

const SCHEMAS = {
  health: {
    type: 'object',
    required: ['status', 'db', 'uptimeSeconds', 'config'],
    properties: {
      status: { const: 'ok' },
      db: { const: 'up' },
      uptimeSeconds: { type: 'integer', minimum: 0 },
      config: {
        type: 'object',
        required: ['bottleneckMode', 'bottlenecks', 'poolSize', 'bcryptCost'],
        properties: {
          bottleneckMode: { type: 'string', enum: ['on', 'off'] },
          poolSize: { type: 'integer', minimum: 1 },
          bcryptCost: { type: 'integer', minimum: 4 },
          bottlenecks: {
            type: 'object',
            required: ['smallPool', 'missingIndex', 'nPlusOne', 'highBcryptCost'],
            additionalProperties: { type: 'boolean' },
          },
        },
      },
    },
  },
  token: {
    type: 'object',
    additionalProperties: false,
    required: ['accessToken', 'tokenType', 'expiresIn'],
    properties: {
      accessToken: { type: 'string', pattern: '^[\\w-]+\\.[\\w-]+\\.[\\w-]+$' },
      tokenType: { const: 'Bearer' },
      expiresIn: { type: 'integer', minimum: 1 },
    },
  },
  order: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'amount', 'currency', 'status', 'createdAt', 'updatedAt', 'payments'],
    properties: {
      id: { type: 'string', pattern: UUID },
      amount: { type: 'integer', minimum: 1 },
      currency: CURRENCY,
      status: { type: 'string', enum: ['pending', 'paid'] },
      createdAt: { type: 'string', pattern: ISO_DATE },
      updatedAt: { type: 'string', pattern: ISO_DATE },
      payments: { type: 'array', items: payment },
    },
  },
  payment,
  webhook: {
    type: 'object',
    additionalProperties: false,
    required: ['received', 'payment'],
    properties: { received: { const: true }, payment },
  },
  error: {
    type: 'object',
    additionalProperties: false,
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          details: { type: 'array' },
        },
      },
    },
  },
};

// ---------------------------------------------------------------- script snippets
const status = (code) => `pm.test('status is ${code}', () => pm.response.to.have.status(${code}));`;
const schema = (name) =>
  `pm.test('body matches ${name} schema', () => pm.response.to.have.jsonSchema(${JSON.stringify(SCHEMAS[name])}));`;
const errorCase = (code, errorCode) =>
  [
    status(code),
    schema('error'),
    `pm.test('error code is ${errorCode}', () => pm.expect(pm.response.json().error.code).to.eql('${errorCode}'));`,
  ].join('\n');
const save = (variable, expr) =>
  `if (pm.response.code < 300) pm.collectionVariables.set('${variable}', ${expr});`;
const newKey = (variable) => `pm.collectionVariables.set('${variable}', pm.variables.replaceIn('{{$guid}}'));`;

// Webhooks are signed over the exact raw body (after variable substitution), like a real provider.
const signWebhook = [
  `const body = pm.variables.replaceIn(pm.request.body.raw);`,
  `const sig = CryptoJS.HmacSHA256(body, pm.environment.get('webhookSecret')).toString(CryptoJS.enc.Hex);`,
  `pm.request.headers.upsert({ key: 'X-Webhook-Signature', value: 'sha256=' + sig });`,
].join('\n');

// ---------------------------------------------------------------- request builder
const script = (listen, code) => ({ listen, script: { type: 'text/javascript', exec: code.split('\n') } });

function request({ name, method = 'GET', url, auth = 'token', headers = {}, body, pre, test }) {
  const header = [];
  if (auth === 'token') header.push({ key: 'Authorization', value: 'Bearer {{token}}' });
  else if (auth) header.push({ key: 'Authorization', value: auth });
  if (body !== undefined) header.push({ key: 'Content-Type', value: 'application/json' });
  for (const [key, value] of Object.entries(headers)) header.push({ key, value });

  const raw = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return {
    name,
    event: [pre && script('prerequest', pre), script('test', test)].filter(Boolean),
    request: {
      method,
      header,
      url: `{{baseUrl}}${url}`,
      ...(body !== undefined && { body: { mode: 'raw', raw, options: { raw: { language: 'json' } } } }),
    },
  };
}

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const credentials = { email: '{{email}}', password: '{{password}}' };

// ---------------------------------------------------------------- the contract, in run order
const folders = [
  {
    name: '1. Health & metrics',
    item: [
      request({ name: 'GET /health', url: '/health', auth: null, test: [status(200), schema('health')].join('\n') }),
      request({
        name: 'GET /metrics',
        url: '/metrics',
        auth: null,
        test: [
          status(200),
          `pm.test('Prometheus text format', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('text/plain'));`,
          `pm.test('exposes request duration and DB pool metrics', () => {`,
          `  const text = pm.response.text();`,
          `  ['http_request_duration_seconds_bucket', 'payflow_db_pool_in_use', 'payflow_db_pool_waiting', 'payflow_bottleneck_enabled']`,
          `    .forEach((m) => pm.expect(text).to.include(m));`,
          `});`,
        ].join('\n'),
      }),
    ],
  },
  {
    name: '2. Auth',
    item: [
      request({
        name: 'POST /auth/token - valid credentials',
        method: 'POST',
        url: '/auth/token',
        auth: null,
        body: credentials,
        test: [status(200), schema('token'), save('token', 'pm.response.json().accessToken')].join('\n'),
      }),
      request({
        name: 'POST /auth/token - wrong password → 401',
        method: 'POST',
        url: '/auth/token',
        auth: null,
        body: { email: '{{email}}', password: 'definitely-wrong' },
        test: errorCase(401, 'unauthorized'),
      }),
      request({
        name: 'POST /auth/token - missing fields → 400',
        method: 'POST',
        url: '/auth/token',
        auth: null,
        body: {},
        test: errorCase(400, 'invalid_request'),
      }),
    ],
  },
  {
    name: '3. Orders',
    item: [
      request({
        name: 'POST /orders - create',
        method: 'POST',
        url: '/orders',
        body: { amount: 4999, currency: 'EUR' },
        test: [
          status(201),
          schema('order'),
          `pm.test('new order is pending with no payments, amount echoed', () => {`,
          `  const o = pm.response.json();`,
          `  pm.expect(o.status).to.eql('pending');`,
          `  pm.expect(o.payments).to.eql([]);`,
          `  pm.expect(o.amount).to.eql(4999);`,
          `  pm.expect(o.currency).to.eql('EUR');`,
          `});`,
          save('orderId', 'pm.response.json().id'),
        ].join('\n'),
      }),
      request({
        name: 'POST /orders - create second order',
        method: 'POST',
        url: '/orders',
        body: { amount: 1250, currency: 'GBP' },
        test: [status(201), schema('order'), save('orderId2', 'pm.response.json().id')].join('\n'),
      }),
      request({
        name: 'POST /orders - invalid body → 400',
        method: 'POST',
        url: '/orders',
        body: { amount: -5, currency: 'XYZ' },
        test: [
          errorCase(400, 'invalid_request'),
          `pm.test('details name both invalid fields', () => {`,
          `  const fields = pm.response.json().error.details.map((d) => d.field);`,
          `  pm.expect(fields).to.include.members(['amount', 'currency']);`,
          `});`,
        ].join('\n'),
      }),
      request({
        name: 'POST /orders - malformed JSON → 400',
        method: 'POST',
        url: '/orders',
        body: '{"amount": 10,',
        test: errorCase(400, 'invalid_json'),
      }),
      request({
        name: 'POST /orders - no token → 401',
        method: 'POST',
        url: '/orders',
        auth: null,
        body: { amount: 100, currency: 'USD' },
        test: errorCase(401, 'unauthorized'),
      }),
      request({
        name: 'POST /orders - bad token → 401',
        method: 'POST',
        url: '/orders',
        auth: 'Bearer not.a.validtoken',
        body: { amount: 100, currency: 'USD' },
        test: errorCase(401, 'unauthorized'),
      }),
      request({
        name: 'GET /orders/:id',
        url: '/orders/{{orderId}}',
        test: [
          status(200),
          schema('order'),
          `pm.test('returns the requested order', () => pm.expect(pm.response.json().id).to.eql(pm.collectionVariables.get('orderId')));`,
        ].join('\n'),
      }),
      request({ name: 'GET /orders/:id - unknown → 404', url: `/orders/${UNKNOWN_ID}`, test: errorCase(404, 'not_found') }),
      request({ name: 'GET /orders/:id - malformed id → 400', url: '/orders/not-a-uuid', test: errorCase(400, 'invalid_request') }),
    ],
  },
  {
    name: '4. Payments & idempotency',
    item: [
      request({
        name: 'POST /payments - missing Idempotency-Key → 400',
        method: 'POST',
        url: '/payments',
        body: { orderId: '{{orderId}}' },
        test: errorCase(400, 'missing_idempotency_key'),
      }),
      request({
        name: 'POST /payments - no token → 401',
        method: 'POST',
        url: '/payments',
        auth: null,
        headers: { 'Idempotency-Key': '{{$guid}}' },
        body: { orderId: '{{orderId}}' },
        test: errorCase(401, 'unauthorized'),
      }),
      request({
        name: 'POST /payments - create (approved)',
        method: 'POST',
        url: '/payments',
        headers: { 'Idempotency-Key': '{{idemKey}}', 'X-Test-Force-Outcome': 'approve' },
        body: { orderId: '{{orderId}}' },
        pre: newKey('idemKey'),
        test: [
          status(201),
          schema('payment'),
          `pm.test('authorized for the order amount under our key', () => {`,
          `  const p = pm.response.json();`,
          `  pm.expect(p.status).to.eql('authorized');`,
          `  pm.expect(p.orderId).to.eql(pm.collectionVariables.get('orderId'));`,
          `  pm.expect(p.idempotencyKey).to.eql(pm.collectionVariables.get('idemKey'));`,
          `  pm.expect(p.amount).to.eql(4999);`,
          `});`,
          `pm.test('not marked as a replay', () => pm.response.to.not.have.header('Idempotent-Replayed'));`,
          save('paymentId', 'pm.response.json().id'),
        ].join('\n'),
      }),
      request({
        name: 'POST /payments - same key replays, no new charge',
        method: 'POST',
        url: '/payments',
        headers: { 'Idempotency-Key': '{{idemKey}}' },
        body: { orderId: '{{orderId}}' },
        test: [
          status(200),
          schema('payment'),
          `pm.test('Idempotent-Replayed header is set', () => pm.expect(pm.response.headers.get('Idempotent-Replayed')).to.eql('true'));`,
          `pm.test('same payment returned', () => {`,
          `  const p = pm.response.json();`,
          `  pm.expect(p.id).to.eql(pm.collectionVariables.get('paymentId'));`,
          `  pm.expect(p.status).to.eql('authorized');`,
          `});`,
        ].join('\n'),
      }),
      request({
        name: 'POST /payments - same key, different order → 422',
        method: 'POST',
        url: '/payments',
        headers: { 'Idempotency-Key': '{{idemKey}}' },
        body: { orderId: '{{orderId2}}' },
        test: errorCase(422, 'idempotency_key_reused'),
      }),
      request({
        name: 'POST /payments - new key on already-paid order → 409',
        method: 'POST',
        url: '/payments',
        headers: { 'Idempotency-Key': '{{$guid}}' },
        body: { orderId: '{{orderId}}' },
        test: errorCase(409, 'order_already_paid'),
      }),
      request({
        name: 'POST /payments - unknown order → 404',
        method: 'POST',
        url: '/payments',
        headers: { 'Idempotency-Key': '{{$guid}}' },
        body: { orderId: UNKNOWN_ID },
        test: errorCase(404, 'not_found'),
      }),
      request({
        name: 'POST /payments - declined',
        method: 'POST',
        url: '/payments',
        headers: { 'Idempotency-Key': '{{$guid}}', 'X-Test-Force-Outcome': 'decline' },
        body: { orderId: '{{orderId2}}' },
        test: [
          status(201),
          schema('payment'),
          `pm.test('declined with a reason', () => {`,
          `  const p = pm.response.json();`,
          `  pm.expect(p.status).to.eql('declined');`,
          `  pm.expect(p.declineReason).to.be.a('string').and.not.be.empty;`,
          `});`,
          save('declinedPaymentId', 'pm.response.json().id'),
        ].join('\n'),
      }),
      request({
        name: 'GET /payments/:id',
        url: '/payments/{{paymentId}}',
        test: [
          status(200),
          schema('payment'),
          `pm.test('returns the requested payment', () => pm.expect(pm.response.json().id).to.eql(pm.collectionVariables.get('paymentId')));`,
        ].join('\n'),
      }),
      request({ name: 'GET /payments/:id - unknown → 404', url: `/payments/${UNKNOWN_ID}`, test: errorCase(404, 'not_found') }),
      request({
        name: 'GET /payments/:id - no token → 401',
        url: '/payments/{{paymentId}}',
        auth: null,
        test: errorCase(401, 'unauthorized'),
      }),
    ],
  },
  {
    name: '5. Webhooks',
    item: [
      request({
        name: 'POST /webhooks/payment - bad signature → 401',
        method: 'POST',
        url: '/webhooks/payment',
        auth: null,
        headers: { 'X-Webhook-Signature': 'sha256=0000' },
        body: { paymentId: '{{paymentId}}', event: 'payment.captured' },
        test: errorCase(401, 'unauthorized'),
      }),
      request({
        name: 'POST /webhooks/payment - captured',
        method: 'POST',
        url: '/webhooks/payment',
        auth: null,
        body: { paymentId: '{{paymentId}}', event: 'payment.captured' },
        pre: signWebhook,
        test: [
          status(200),
          schema('webhook'),
          `pm.test('payment is captured', () => pm.expect(pm.response.json().payment.status).to.eql('captured'));`,
        ].join('\n'),
      }),
      request({
        name: 'POST /webhooks/payment - duplicate delivery is a no-op',
        method: 'POST',
        url: '/webhooks/payment',
        auth: null,
        body: { paymentId: '{{paymentId}}', event: 'payment.captured' },
        pre: signWebhook,
        test: [
          status(200),
          schema('webhook'),
          `pm.test('still captured', () => pm.expect(pm.response.json().payment.status).to.eql('captured'));`,
        ].join('\n'),
      }),
      request({
        name: 'POST /webhooks/payment - capture a declined payment → 409',
        method: 'POST',
        url: '/webhooks/payment',
        auth: null,
        body: { paymentId: '{{declinedPaymentId}}', event: 'payment.captured' },
        pre: signWebhook,
        test: errorCase(409, 'invalid_transition'),
      }),
      request({
        name: 'POST /webhooks/payment - unknown event → 400',
        method: 'POST',
        url: '/webhooks/payment',
        auth: null,
        body: { paymentId: '{{paymentId}}', event: 'payment.refunded' },
        pre: signWebhook,
        test: errorCase(400, 'invalid_request'),
      }),
      request({
        name: 'POST /webhooks/payment - unknown payment → 404',
        method: 'POST',
        url: '/webhooks/payment',
        auth: null,
        body: { paymentId: UNKNOWN_ID, event: 'payment.captured' },
        pre: signWebhook,
        test: errorCase(404, 'not_found'),
      }),
    ],
  },
  {
    name: '6. End state (no duplicate charges)',
    item: [
      request({
        name: 'GET /orders/:id - paid with exactly one captured payment',
        url: '/orders/{{orderId}}',
        test: [
          status(200),
          schema('order'),
          `pm.test('order is paid', () => pm.expect(pm.response.json().status).to.eql('paid'));`,
          `pm.test('exactly one payment despite replay and 409 attempts', () => {`,
          `  const payments = pm.response.json().payments;`,
          `  pm.expect(payments).to.have.lengthOf(1);`,
          `  pm.expect(payments[0].id).to.eql(pm.collectionVariables.get('paymentId'));`,
          `  pm.expect(payments[0].status).to.eql('captured');`,
          `});`,
        ].join('\n'),
      }),
      request({
        name: 'GET /orders/:id - second order still pending, only the declined attempt',
        url: '/orders/{{orderId2}}',
        test: [
          status(200),
          schema('order'),
          `pm.test('order is pending', () => pm.expect(pm.response.json().status).to.eql('pending'));`,
          `pm.test('the 422 key-reuse attempt created nothing', () => {`,
          `  const payments = pm.response.json().payments;`,
          `  pm.expect(payments).to.have.lengthOf(1);`,
          `  pm.expect(payments[0].status).to.eql('declined');`,
          `});`,
        ].join('\n'),
      }),
    ],
  },
];

const collection = {
  info: {
    name: 'PayFlow API - contract',
    description:
      'Functional/contract gate for the PayFlow API, run with Newman before any load test. ' +
      'Requests run in order and share state through collection variables. ' +
      'Generated by postman/build-collection.js - edit that file, not this one.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  event: [
    script(
      'test',
      [
        `// Every API response except /metrics is JSON.`,
        `if (pm.request.url.getPath() !== '/metrics') {`,
        `  pm.test('responds with JSON', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json'));`,
        `}`,
      ].join('\n'),
    ),
  ],
  variable: ['token', 'orderId', 'orderId2', 'idemKey', 'paymentId', 'declinedPaymentId'].map((key) => ({
    key,
    value: '',
  })),
  item: folders,
};

const out = path.join(__dirname, 'payflow.postman_collection.json');
fs.writeFileSync(out, JSON.stringify(collection, null, 2) + '\n');
const count = folders.reduce((n, f) => n + f.item.length, 0);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${count} requests)`);
