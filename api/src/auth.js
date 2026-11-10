import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';
import { badRequest, unauthorized } from './errors.js';

let dummyHash; // compared against when the email is unknown, so timing doesn't leak user existence

/**
 * Make sure the seeded test user has a password hash at the configured bcrypt cost.
 * Re-hashes when BCRYPT_COST changes, so the bcrypt bottleneck can be toggled without re-seeding.
 */
export async function ensureTestUser() {
  const { email, password } = config.testUser;
  dummyHash = await bcrypt.hash('dummy-password', config.bcryptCost);

  const { rows } = await query('user_by_email', 'SELECT id, password_hash FROM users WHERE email = $1', [email]);
  const current = rows[0]?.password_hash;
  const upToDate =
    current && bcrypt.getRounds(current) === config.bcryptCost && (await bcrypt.compare(password, current));
  if (upToDate) return;

  const hash = await bcrypt.hash(password, config.bcryptCost);
  await query(
    'upsert_test_user',
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email, hash],
  );
  console.log(`[auth] test user ${email} hashed with bcrypt cost ${config.bcryptCost}`);
}

export async function issueToken(body) {
  const { email, password } = body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw badRequest('invalid_request', 'email and password are required');
  }
  const { rows } = await query('user_by_email', 'SELECT id, password_hash FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? dummyHash);
  if (!user?.password_hash || !ok) throw unauthorized('Invalid email or password');

  const accessToken = jwt.sign({ sub: String(user.id) }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtTtlSeconds,
  });
  return { accessToken, tokenType: 'Bearer', expiresIn: config.jwtTtlSeconds };
}

/** Express middleware: requires "Authorization: Bearer <jwt>", sets req.userId. */
export function requireAuth(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    req.userId = Number(payload.sub);
    return next();
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }
}
