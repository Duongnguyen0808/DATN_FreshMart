import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { jwtVerify } from 'jose';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('POST /api/v1/auth/login on PostgreSQL', () => {
  let db: typeof import('./common/database.js').prisma;
  let app: ReturnType<typeof import('./app.js').createApp>;
  const suffix = randomUUID();
  const email = `login-${suffix}@test.local`;
  const disabledEmail = `disabled-${suffix}@test.local`;
  const password = 'Test-only-password-12345';
  const userIds: string[] = [];
  const login = (body: unknown = { email, password, client: 'mobile' }) => request(app).post('/api/v1/auth/login').send(body);
  beforeAll(async () => {
    if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/smart_store_auth_test') throw new Error('Expected dedicated test database');
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:4000';
    ({ prisma: db } = await import('./common/database.js'));
    const { hashPassword } = await import('./modules/auth/password.js');
    const passwordHash = await hashPassword(password);
    for (const [value, active] of [[email, true], [disabledEmail, false]] as const) {
      userIds.push((await db.user.create({ data: { email: value, name: 'Login fixture', active, passwordHash } })).id);
    }
    app = (await import('./app.js')).createApp(async () => { await db.$queryRaw`SELECT 1`; });
  }, 30000);
  afterAll(async () => {
    if (!db) return;
    // Remove only records created by this test run in the dedicated test database.
    await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });
  it('returns valid JWT, stores only a refresh hash and records login', async () => {
    const result = await login();
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    const { accessToken, refreshToken, user } = result.body.data;
    expect(user.email).toBe(email);
    expect(result.text).not.toContain(password);
    expect(result.text).not.toContain('passwordHash');
    const { payload } = await jwtVerify(accessToken, new TextEncoder().encode(process.env.JWT_SECRET), { issuer: 'smart-store', audience: 'smart-store-app' });
    expect(payload.sub).toBe(userIds[0]);
    expect(payload.exp! - payload.iat!).toBe(900);
    const session = await db.session.findUniqueOrThrow({ where: { id: payload.sid as string } });
    expect(session.refreshHash).toBe(createHash('sha256').update(refreshToken).digest('hex'));
    expect(session.refreshHash).not.toBe(refreshToken);
    expect(await db.auditLog.count({ where: { actorId: userIds[0], action: 'auth.login', targetId: session.id } })).toBe(1);
  });
  it('normalizes email casing and surrounding spaces', async () => {
    expect((await login({ email: ` ${email.toUpperCase()} `, password, client: 'mobile' })).status).toBe(200);
  });
  it('rejects wrong password, unknown account and disabled account equally without creating sessions', async () => {
    const before = await db.session.count({ where: { userId: { in: userIds } } });
    const wrong = await login({ email, password: 'wrong-password', client: 'mobile' });
    const missing = await login({ email: `missing-${suffix}@test.local`, password, client: 'mobile' });
    const disabled = await login({ email: disabledEmail, password, client: 'mobile' });
    for (const result of [wrong, missing, disabled]) { expect(result.status).toBe(401); expect(result.body.code).toBe('INVALID_CREDENTIALS'); }
    expect(disabled.body).toEqual(wrong.body);
    expect(missing.body).toEqual(wrong.body);
    expect(await db.session.count({ where: { userId: { in: userIds } } })).toBe(before);
  });
  it('rejects missing and invalid input', async () => {
    expect((await login({ email, client: 'mobile' })).status).toBe(400);
    expect((await login({ email: 'not-email', password, client: 'mobile' })).status).toBe(400);
  });
  it('supports Swagger origin and Web HttpOnly cookie login', async () => {
    const swagger = await login().set('Origin', 'http://localhost:4000');
    expect(swagger.status).toBe(200);
    const browser = await login({ email, password, client: 'web' }).set('Origin', 'http://localhost:3000');
    expect(browser.status).toBe(200);
    expect(browser.body.data.refreshToken).toBeUndefined();
    const cookie = browser.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });
  it('rejects untrusted browser origins before creating a session', async () => {
    const before = await db.session.count({ where: { userId: { in: userIds } } });
    expect((await login().set('Origin', 'http://untrusted.local')).status).toBe(403);
    expect((await login({ email, password, client: 'web' })).status).toBe(403);
    expect(await db.session.count({ where: { userId: { in: userIds } } })).toBe(before);
  });
  it('serves executable Swagger login documentation', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json')).body;
    const operation = spec.paths['/api/v1/auth/login'].post;
    expect(operation.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/LoginInput');
    expect(operation.responses).toHaveProperty('401');
    expect(spec.components.schemas.LoginInput.required).toEqual(['email', 'password', 'client']);
    const page = await request(app).get('/docs/');
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect((await request(app).get('/docs/swagger-ui-bundle.js')).status).toBe(200);
  });
  it('limits repeated unsuccessful login attempts', async () => {
    let result;
    for (let attempt = 0; attempt < 11; attempt++) {
      result = await login({ email, password: 'wrong-password', client: 'mobile' });
      if (result.status === 429) break;
    }
    expect(result?.status).toBe(429);
    expect(result?.body.code).toBe('RATE_LIMITED');
    expect(result?.headers['retry-after']).toBeDefined();
  });
});
