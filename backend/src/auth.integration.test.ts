import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('Authentication, RBAC and branch access on PostgreSQL', () => {
  let db: typeof import('./common/database.js').prisma;
  let app: ReturnType<typeof import('./app.js').createApp>;
  let signAccess: typeof import('./modules/auth/auth.service.js').signAccess;
  let ownerId: string, cashierId: string, storeA: string, storeB: string, ownerRoleId: string, cashierRoleId: string;
  let ownerToken: string, cashierToken: string;
  const prefix = randomUUID();
  const ownerEmail = `owner-${prefix}@test.local`;
  const cashierEmail = `cashier-${prefix}@test.local`;
  const password = 'Integration-Test-Password-123';
  const login = (email = cashierEmail, pass = password) => request(app).post('/api/v1/auth/login').send({ email, password: pass, client: 'mobile' });
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (url.pathname !== '/smart_store_auth_test') throw new Error('Refusing to test against a non-test database');
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma: db } = await import('./common/database.js'));
    const { hashPassword } = await import('./modules/auth/password.js');
    ({ signAccess } = await import('./modules/auth/auth.service.js'));
    app = (await import('./app.js')).createApp(async () => { await db.$queryRaw`SELECT 1`; });
    const codes = ['users.read', 'users.manage', 'roles.read', 'roles.manage', 'permissions.read', 'stores.read'];
    for (const code of codes) await db.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
    const ownerRole = await db.role.upsert({ where: { code: 'OWNER' }, update: {}, create: { code: 'OWNER', name: 'Owner', system: true, permissions: { create: codes.map(permissionCode => ({ permissionCode })) } } });
    ownerRoleId = ownerRole.id;
    cashierRoleId = (await db.role.create({ data: { code: `TEST_${prefix}`, name: 'Cashier', permissions: { create: { permissionCode: 'stores.read' } } } })).id;
    storeA = (await db.store.create({ data: { code: `A_${prefix}`, name: 'Store A', warehouses: { create: { code: `WA_${prefix}`, name: 'A warehouse' } } } })).id;
    storeB = (await db.store.create({ data: { code: `B_${prefix}`, name: 'Store B', warehouses: { create: { code: `WB_${prefix}`, name: 'B warehouse' } } } })).id;
    const passwordHash = await hashPassword(password);
    ownerId = (await db.user.create({ data: { email: ownerEmail, name: 'Owner', passwordHash, roles: { create: { roleId: ownerRoleId } } } })).id;
    cashierId = (await db.user.create({ data: { email: cashierEmail, name: 'Cashier', passwordHash, roles: { create: { roleId: cashierRoleId } }, stores: { create: { storeId: storeA } } } })).id;
    ownerToken = (await login(ownerEmail)).body.data.accessToken;
    cashierToken = (await login()).body.data.accessToken;
  }, 30000);
  afterAll(async () => { await db?.$disconnect(); });
  it('never returns password hashes and rejects unauthenticated requests', async () => {
    const result = await request(app).get('/api/v1/auth/me').auth(cashierToken, { type: 'bearer' });
    expect(result.status).toBe(200);
    expect(result.body.data.email).toBe(cashierEmail);
    expect(result.text).not.toContain('passwordHash');
    expect((await request(app).get('/api/v1/users')).status).toBe(401);
  });
  it('rejects wrong passwords and malformed inputs', async () => {
    expect((await login(cashierEmail, 'wrong')).status).toBe(401);
    expect((await login('missing@test.local', 'wrong')).body.code).toBe('INVALID_CREDENTIALS');
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'invalid' })).status).toBe(400);
  });
  it('blocks cashier from every administration endpoint', async () => {
    for (const path of ['users', 'roles', 'permissions']) {
      expect((await request(app).get(`/api/v1/${path}`).auth(cashierToken, { type: 'bearer' })).status).toBe(403);
    }
    expect((await request(app).post('/api/v1/users').auth(cashierToken, { type: 'bearer' }).send({})).status).toBe(403);
    expect((await request(app).put(`/api/v1/roles/${ownerRoleId}`).auth(cashierToken, { type: 'bearer' }).send({})).status).toBe(403);
  });
  it('filters branches and rejects direct cross-branch access (BR-10)', async () => {
    const result = await request(app).get('/api/v1/stores').auth(cashierToken, { type: 'bearer' });
    expect(result.body.data.map((s: { id: string }) => s.id)).toEqual([storeA]);
    expect((await request(app).get(`/api/v1/stores/${storeB}`).auth(cashierToken, { type: 'bearer' })).status).toBe(403);
    const global = await request(app).get('/api/v1/stores').auth(ownerToken, { type: 'bearer' });
    expect(global.body.data.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining([storeA, storeB]));
  });
  it('rejects expired and tampered access tokens', async () => {
    const sid = (await db.session.findFirstOrThrow({ where: { userId: cashierId, revokedAt: null } })).id;
    const expired = await signAccess(cashierId, sid, '-1s');
    expect((await request(app).get('/api/v1/auth/me').auth(expired, { type: 'bearer' })).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').auth(`${cashierToken}x`, { type: 'bearer' })).status).toBe(401);
  });
  it('rotates refresh tokens and revokes replayed sessions', async () => {
    const initial = (await login()).body.data;
    const rotated = await request(app).post('/api/v1/auth/refresh').send({ client: 'mobile', refreshToken: initial.refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(initial.refreshToken);
    expect((await request(app).post('/api/v1/auth/refresh').send({ client: 'mobile', refreshToken: initial.refreshToken })).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').auth(rotated.body.data.accessToken, { type: 'bearer' })).status).toBe(401);
  });
  it('logout revokes access and refresh tokens', async () => {
    const session = (await login()).body.data;
    expect((await request(app).post('/api/v1/auth/logout').auth(session.accessToken, { type: 'bearer' }).send({})).status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').auth(session.accessToken, { type: 'bearer' })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').send({ client: 'mobile', refreshToken: session.refreshToken })).status).toBe(401);
  });
  it('uses HttpOnly cookies for Web and rejects untrusted origins', async () => {
    const session = await request(app).post('/api/v1/auth/login').set('Origin', 'http://localhost:3000').send({ client: 'web', email: cashierEmail, password });
    expect(session.status).toBe(200);
    expect(session.body.data.refreshToken).toBeUndefined();
    const cookie = session.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect((await request(app).post('/api/v1/auth/refresh').set('Origin', 'http://evil.local').set('Cookie', cookie).send({ client: 'web' })).status).toBe(403);
    expect((await request(app).post('/api/v1/auth/refresh').set('Origin', 'http://localhost:3000').set('Cookie', cookie).send({ client: 'web' })).status).toBe(200);
  });
  it('creates users, validates branch assignment and rejects duplicates', async () => {
    const input = { email: `new-${prefix}@test.local`, name: 'Employee', password, roleIds: [cashierRoleId], storeIds: [storeA], active: true };
    expect((await request(app).post('/api/v1/users').auth(ownerToken, { type: 'bearer' }).send({ ...input, storeIds: [] })).body.code).toBe('STORE_REQUIRED');
    expect((await request(app).post('/api/v1/users').auth(ownerToken, { type: 'bearer' }).send(input)).status).toBe(201);
    expect((await request(app).post('/api/v1/users').auth(ownerToken, { type: 'bearer' }).send(input)).status).toBe(409);
  });
  it('grants and revokes role permissions immediately, and protects OWNER', async () => {
    const body = { code: `EDIT_${prefix.replaceAll('-', '_')}`, name: 'Scoped reader', permissionCodes: ['stores.read', 'users.read'] };
    const result = await request(app).put(`/api/v1/roles/${cashierRoleId}`).auth(ownerToken, { type: 'bearer' }).send(body);
    expect(result.status).toBe(200);
    const users = await request(app).get('/api/v1/users').auth(cashierToken, { type: 'bearer' });
    expect(users.status).toBe(200);
    expect(users.body.data.some((u: { id: string }) => u.id === ownerId)).toBe(false);
    expect((await request(app).put(`/api/v1/roles/${cashierRoleId}`).auth(ownerToken, { type: 'bearer' }).send({ ...body, permissionCodes: ['stores.read'] })).status).toBe(200);
    expect((await request(app).get('/api/v1/users').auth(cashierToken, { type: 'bearer' })).status).toBe(403);
    expect((await request(app).put(`/api/v1/roles/${ownerRoleId}`).auth(ownerToken, { type: 'bearer' }).send({ code: 'OWNER', name: 'Owner', permissionCodes: [] })).body.code).toBe('SYSTEM_ROLE');
    expect((await request(app).delete(`/api/v1/roles/${cashierRoleId}`).auth(ownerToken, { type: 'bearer' })).body.code).toBe('ROLE_IN_USE');
  });
  it('disabled users cannot log in or use existing sessions', async () => {
    const body = { email: cashierEmail, name: 'Cashier', roleIds: [cashierRoleId], storeIds: [storeA], active: false };
    expect((await request(app).put(`/api/v1/users/${cashierId}`).auth(ownerToken, { type: 'bearer' }).send(body)).status).toBe(200);
    expect((await login()).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').auth(cashierToken, { type: 'bearer' })).status).toBe(401);
    expect(await db.auditLog.count({ where: { targetId: cashierId, action: 'user.update' } })).toBeGreaterThan(0);
  });
});
