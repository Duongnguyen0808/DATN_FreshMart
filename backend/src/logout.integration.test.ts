import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('POST /api/v1/auth/logout on PostgreSQL', () => {
  let db: typeof import('./common/database.js').prisma;
  let app: ReturnType<typeof import('./app.js').createApp>;
  let service: typeof import('./modules/auth/auth.service.js');
  let userId: string;
  const email = `logout-${randomUUID()}@test.local`;
  const password = 'Test-only-logout-password-123';
  const login = async () => {
    const response = await request(app).post('/api/v1/auth/login').send({ email, password, client: 'mobile' });
    expect(response.status).toBe(200);
    return response.body.data as { accessToken: string; refreshToken: string };
  };
  const me = (token: string) => request(app).get('/api/v1/auth/me').auth(token, { type: 'bearer' });
  const logout = (token: string) => request(app).post('/api/v1/auth/logout').auth(token, { type: 'bearer' });
  const refresh = (token: string) => request(app).post('/api/v1/auth/refresh').send({ client: 'mobile', refreshToken: token });
  beforeAll(async () => {
    if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/smart_store_auth_test') throw new Error('Expected dedicated test database');
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:4000';
    ({ prisma: db } = await import('./common/database.js'));
    service = await import('./modules/auth/auth.service.js');
    const { hashPassword } = await import('./modules/auth/password.js');
    userId = (await db.user.create({ data: { email, name: 'Logout fixture', passwordHash: await hashPassword(password) } })).id;
    app = (await import('./app.js')).createApp(async () => { await db.$queryRaw`SELECT 1`; });
  }, 30000);
  afterAll(async () => {
    if (!db) return;
    if (userId) {
      await db.auditLog.deleteMany({ where: { actorId: userId } });
      await db.user.delete({ where: { id: userId } });
    }
    await db.$disconnect();
  });
  it('revokes access and refresh tokens, records audit, and keeps the other device signed in', async () => {
    const first = await login();
    const second = await login();
    expect((await me(first.accessToken)).status).toBe(200);
    const response = await logout(first.accessToken);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: 'Đã đăng xuất.', data: null });
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await me(first.accessToken)).status).toBe(401);
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await me(second.accessToken)).status).toBe(200);
    expect((await refresh(second.refreshToken)).status).toBe(200);
    const id = first.refreshToken.split('.')[0]!;
    expect((await db.session.findUniqueOrThrow({ where: { id } })).revokedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { actorId: userId, action: 'auth.logout', targetId: id } })).toBe(1);
  });
  it('rejects reuse of the logged-out token without duplicate audit entries', async () => {
    const session = await login();
    expect((await logout(session.accessToken)).status).toBe(200);
    expect((await logout(session.accessToken)).status).toBe(401);
    expect(await db.auditLog.count({ where: { targetId: session.refreshToken.split('.')[0], action: 'auth.logout' } })).toBe(1);
  });
  it('rejects missing, invalid and expired access tokens without revoking the live session', async () => {
    const session = await login();
    const expired = await service.signAccess(userId, session.refreshToken.split('.')[0]!, '-1s');
    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(401);
    expect((await logout('invalid')).status).toBe(401);
    expect((await logout(expired)).status).toBe(401);
    expect((await me(session.accessToken)).status).toBe(200);
  });
  it('rejects a client-supplied target session and disallowed origins', async () => {
    const first = await login();
    const second = await login();
    expect((await logout(first.accessToken).send({ sessionId: second.refreshToken.split('.')[0] })).status).toBe(400);
    expect((await logout(first.accessToken).set('Origin', 'http://untrusted.local')).status).toBe(403);
    expect((await me(first.accessToken)).status).toBe(200);
    expect((await me(second.accessToken)).status).toBe(200);
  });
  it('clears the Web refresh cookie with the matching path and cookie flags', async () => {
    const browser = request.agent(app);
    const session = await browser.post('/api/v1/auth/login').set('Origin', 'http://localhost:3000').send({ email, password, client: 'web' });
    const response = await browser.post('/api/v1/auth/logout').set('Origin', 'http://localhost:3000').auth(session.body.data.accessToken, { type: 'bearer' }).send({});
    expect(response.status).toBe(200);
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('refreshToken=;');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
    expect((await browser.post('/api/v1/auth/refresh').set('Origin', 'http://localhost:3000').send({ client: 'web' })).status).toBe(401);
  });
  it('records a single logout event for concurrent revocations', async () => {
    const session = await login();
    const id = session.refreshToken.split('.')[0]!;
    await Promise.all([service.logout(id, userId), service.logout(id, userId)]);
    expect(await db.auditLog.count({ where: { targetId: id, action: 'auth.logout' } })).toBe(1);
    expect((await me(session.accessToken)).status).toBe(401);
  });
  it('exposes Swagger bearer authorization and logout operation', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json')).body;
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(spec.paths['/api/v1/auth/logout'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths['/api/v1/auth/logout'].post.responses).toHaveProperty('401');
    expect(spec.paths['/api/v1/auth/me'].get.security).toEqual([{ bearerAuth: [] }]);
  });
});
