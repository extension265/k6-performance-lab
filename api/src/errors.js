export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new HttpError(400, code, message, details);
export const unauthorized = (message = 'Missing or invalid credentials') =>
  new HttpError(401, 'unauthorized', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (code, message) => new HttpError(409, code, message);
export const unprocessable = (code, message) => new HttpError(422, code, message);

// Express error handler: consistent JSON error envelope.
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Body too large' } });
  }
  // pg pool checkout timed out: the service is saturated, not broken.
  if (/timeout exceeded when trying to connect/i.test(err?.message ?? '')) {
    return res
      .status(503)
      .json({ error: { code: 'db_pool_timeout', message: 'Database connection pool exhausted' } });
  }
  console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err);
  return res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
}
