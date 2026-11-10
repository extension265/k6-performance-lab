// Shared request params. Every request carries a `name` tag (the route template), so URLs with
// ids collapse into one metric series per endpoint instead of one per id.

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function params(name, token, extraHeaders = {}) {
  return {
    headers: {
      ...JSON_HEADERS,
      ...(token && { Authorization: `Bearer ${token}` }),
      ...extraHeaders,
    },
    tags: { name },
  };
}

// The endpoint names used as tags; thresholds and the summary refer to these.
export const ENDPOINTS = [
  'POST /auth/token',
  'POST /orders',
  'POST /payments',
  'POST /payments (replay)',
  'GET /payments/:id',
  'POST /webhooks/payment',
  'GET /orders/:id',
];
