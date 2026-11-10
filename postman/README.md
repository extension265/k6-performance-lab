# Newman contract gate

A functional and contract check that runs **before** any load test. If the API is functionally broken, a load test against it measures nothing useful.

```
npm run stack:up
npm run test:contract     # CLI output + reports/newman/contract.html
```

What it covers (33 requests, run in order, sharing state through collection variables):

- **Every endpoint** is checked for status codes and a strict JSON schema on each body (`additionalProperties: false`).
- **Idempotency:**
  - The same key replays the original payment (`200`, `Idempotent-Replayed: true`, same id).
  - Reusing a key for another order returns `422`.
  - A new key on an already-paid order returns `409`.
  - The final order has exactly one payment.
- **Negative cases:**
  - A missing `Idempotency-Key` returns `400`.
  - A missing or bad token returns `401`.
  - An invalid or malformed body returns `400`.
  - Unknown ids return `404`.
  - A bad webhook signature returns `401`.
  - An invalid state transition returns `409`.
- **Webhooks:**
  - Bodies are HMAC-signed in a pre-request script.
  - A duplicate delivery is a no-op.
- **Deterministic outcomes:** `X-Test-Force-Outcome` takes the 2% random declines out of the picture.

## Files

- `build-collection.js` is the source of truth. The schemas and test scripts are plain JS here. Run `npm run contract:build` after editing it.
- `payflow.postman_collection.json` is the generated collection. It is committed and can be imported into Postman.
- `local.postman_environment.json` points at `http://localhost:3000` (for the Postman app). `test:contract` overrides `baseUrl` to `http://api:3000`.
- `Dockerfile` defines Newman 6.2.3 + htmlextra 1.23.1 on the pinned Node 24 image. `test:contract` runs it as the `newman` compose service, so Newman is not an npm dependency of this repo.
