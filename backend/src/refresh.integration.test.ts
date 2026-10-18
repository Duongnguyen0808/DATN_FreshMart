import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { jwtVerify } from 'jose';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('POST /api/v1/auth/refresh on PostgreSQL', () => {
  let db: typeof import('./common/database.js').prisma;
  let app: ReturnType<typeof import('./app.js').createApp>;
  let service: typeof import('./modules/auth/auth.service.js');
  let userId: string;
  const email = `refresh-${randomUUID()}@test.local`;
  const password = 'Test-only-refresh-password-123';
  const login = async () => {
    const result = await request(app).post('/api/v1/auth/login').send({ email, password, client: 'mobile' });
    expect(result.status).toBe(200);
    return result.body.data as { accessToken: string; refreshToken: string };
  };
  const refresh = (token?: string) => request(app).post('/api/v1/auth/refresh').send({ client: 'mobile', refreshToken: token });
  const me = (token: string) => request(app).get('/api/v1/auth/me').auth(token, { type: 'bearer' });
  beforeAll(async () => {
    if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/smart_store_auth_test') throw new Error('Expected dedicated test database');
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:4000';
    ({ prisma: db } = await import('./common/database.js'));
    service = await import('./modules/auth/auth.service.js');
    const { hashPassword } = await import('./modules/auth/password.js');
    userId = (await db.user.create({ data: { email, name: 'Refresh fixture', passwordHash: await hashPassword(password) } })).id;
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
  it('issues distinct valid tokens, stores only refresh hash and keeps the absolute expiry', async () => {
    const session = await login();
    const id = session.refreshToken.split('.')[0]!;
    const before = await db.session.findUniqueOrThrow({ where: { id } });
    const result = await refresh(session.refreshToken).set('Origin', 'http://localhost:4000');
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    const tokens = result.body.data;
    expect(tokens.accessToken).not.toBe(session.accessToken);
    expect(tokens.refreshToken).not.toBe(session.refreshToken);
    const { payload } = await jwtVerify(tokens.accessToken, new TextEncoder().encode(process.env.JWT_SECRET), { issuer: 'smart-store', audience: 'smart-store-app' });
    expect(payload.sub).toBe(userId);
    expect(payload.sid).toBe(id);
    expect(payload.exp! - payload.iat!).toBe(900);
    const after = await db.session.findUniqueOrThrow({ where: { id } });
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect(after.refreshHash).toBe(createHash('sha256').update(tokens.refreshToken).digest('hex'));
    expect((await me(tokens.accessToken)).status).toBe(200);
    expect((await refresh(tokens.refreshToken)).status).toBe(200);
  });
  it('works when the access token has expired', async () => {
    const session = await login();
    const expired = await service.signAccess(userId, session.refreshToken.split('.')[0]!, '-1s');
    expect((await me(expired)).status).toBe(401);
    const result = await refresh(session.refreshToken).auth(expired, { type: 'bearer' });
    expect(result.status).toBe(200);
    expect((await me(result.body.data.accessToken)).status).toBe(200);
  });
  it('rejects replay and revokes that session while keeping another device usable', async () => {
    const first = await login();
    const second = await login();
    const rotated = await refresh(first.refreshToken);
    expect(rotated.status).toBe(200);
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await me(rotated.body.data.accessToken)).status).toBe(401);
    expect((await refresh(rotated.body.data.refreshToken)).status).toBe(401);
    expect((await refresh(second.refreshToken)).status).toBe(200);
  });
  it('does not revive expired or logged-out sessions', async () => {
    const expired = await login();
    await db.session.update({ where: { id: expired.refreshToken.split('.')[0] }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await refresh(expired.refreshToken)).status).toBe(401);
    const revoked = await login();
    expect((await request(app).post('/api/v1/auth/logout').auth(revoked.accessToken, { type: 'bearer' })).status).toBe(200);
    expect((await refresh(revoked.refreshToken)).status).toBe(401);
  });
  it('refuses a disabled account without rotating its token', async () => {
    const session = await login();
    const id = session.refreshToken.split('.')[0]!;
    const before = await db.session.findUniqueOrThrow({ where: { id } });
    await db.user.update({ where: { id: userId }, data: { active: false } });
    try {
      expect((await refresh(session.refreshToken)).status).toBe(401);
      expect((await db.session.findUniqueOrThrow({ where: { id } })).refreshHash).toBe(before.refreshHash);
    } finally { await db.user.update({ where: { id: userId }, data: { active: true } }); }
  });
  it('rejects missing, malformed, unknown tokens and invalid bodies', async () => {
    for (const token of [undefined, '', 'invalid', `${randomUUID()}.${'x'.repeat(43)}`]) {
      expect((await refresh(token)).status).toBe(401);
    }
    expect((await request(app).post('/api/v1/auth/refresh').send({ client: 'unsupported' })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/refresh').send({ client: 'mobile', refreshToken: 123 })).status).toBe(400);
  });
  it('allows only one concurrent rotation and revokes the contested session', async () => {
    const session = await login();
    const results = await Promise.all([refresh(session.refreshToken), refresh(session.refreshToken)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 401]);
    const winner = results.find(r => r.status === 200)!;
    expect((await me(winner.body.data.accessToken)).status).toBe(401);
    expect((await refresh(winner.body.data.refreshToken)).status).toBe(401);
  });
  it('rotates Web cookies and clears them after invalid authentication', async () => {
    const browser = request.agent(app);
    const initial = await browser.post('/api/v1/auth/login').set('Origin', 'http://localhost:3000').send({ email, password, client: 'web' });
    const oldCookie = initial.headers['set-cookie'][0].split(';')[0];
    const result = await browser.post('/api/v1/auth/refresh').set('Origin', 'http://localhost:3000').send({ client: 'web' });
    expect(result.status).toBe(200);
    expect(result.body.data.refreshToken).toBeUndefined();
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(result.headers['set-cookie'][0].split(';')[0]).not.toBe(oldCookie);
    const replay = await request(app).post('/api/v1/auth/refresh').set('Origin', 'http://localhost:3000').set('Cookie', oldCookie).send({ client: 'web' });
    expect(replay.status).toBe(401);
    expect(replay.headers['set-cookie'][0]).toContain('refreshToken=;');
  });
  it('rejects untrusted or missing Web origin without consuming a valid token', async () => {
    const session = await login();
    expect((await refresh(session.refreshToken).set('Origin', 'http://untrusted.local')).status).toBe(403);
    expect((await request(app).post('/api/v1/auth/refresh').send({ client: 'web' })).status).toBe(403);
    expect((await refresh(session.refreshToken)).status).toBe(200);
  });
  it('documents refresh in Swagger without requiring bearer authentication', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json')).body;
    const operation = spec.paths['/api/v1/auth/refresh'].post;
    expect(operation.security).toEqual([]);
    expect(operation.responses).toHaveProperty('401');
    expect(operation.requestBody.content['application/json'].examples.mobile.value.client).toBe('mobile');
  });
});
