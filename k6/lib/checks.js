import { check } from 'k6';

/** Checks the status code (and that the body parses as JSON). Returns the parsed body or null. */
export function expectJson(res, expectedStatus, label) {
  let body = null;
  const ok = check(res, {
    [`${label}: status ${expectedStatus}`]: (r) => r.status === expectedStatus,
    [`${label}: JSON body`]: (r) => {
      try {
        body = r.json();
        return body !== null && typeof body === 'object';
      } catch {
        return false;
      }
    },
  });
  return ok ? body : null;
}

/** Named boolean assertion, so failures show up in the checks summary. */
export function expectTrue(label, condition) {
  return check(null, { [label]: () => condition });
}
