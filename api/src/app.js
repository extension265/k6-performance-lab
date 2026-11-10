import express from 'express';
import { issueToken, requireAuth } from './auth.js';
import { publicConfig } from './config.js';
import { query } from './db.js';
import { errorHandler, notFound } from './errors.js';
import { httpRequestDuration, register } from './metrics.js';
import { createOrder, getOrder } from './routes/orders.js';
import { createPayment, getPayment } from './routes/payments.js';
import { paymentWebhook } from './routes/webhooks.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  // Request duration by route *template* (/orders/:id), so ids don't explode label cardinality.
  app.use((req, res, next) => {
    const end = httpRequestDuration.startTimer();
    res.on('finish', () => {
      end({ method: req.method, route: req.route?.path ?? 'unmatched', status_code: res.statusCode });
    });
    next();
  });

  // Keep the raw body: webhook signatures are computed over the exact bytes received.
  app.use(
    express.json({
      limit: '10kb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.get('/health', async (_req, res) => {
    try {
      await query('health', 'SELECT 1');
      res.json({ status: 'ok', db: 'up', uptimeSeconds: Math.round(process.uptime()), config: publicConfig() });
    } catch (err) {
      res.status(503).json({ status: 'degraded', db: 'down', error: err.message });
    }
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  });

  app.post('/auth/token', async (req, res) => res.json(await issueToken(req.body)));

  app.post('/orders', requireAuth, createOrder);
  app.get('/orders/:id', requireAuth, getOrder);
  app.post('/payments', requireAuth, createPayment);
  app.get('/payments/:id', requireAuth, getPayment);
  app.post('/webhooks/payment', paymentWebhook);

  app.use((_req, _res, next) => next(notFound('Route')));
  app.use(errorHandler);
  return app;
}
