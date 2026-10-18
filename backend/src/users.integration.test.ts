import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('User management lifecycle on PostgreSQL', () => {
  let db: typeof import('./common/database.js').prisma;
  let app: ReturnType<typeof import('./app.js').createApp>;
  const run = randomUUID(), suffix = `-${run}@test.local`, password = 'Test-only-users-password-123', newPassword = 'New-test-password-456789';
  const ids: string[] = [], roles: string[] = [], stores: string[] = [];
  let ownerId: string, ownerRole: string, cashierRole: string, managerRole: string, higherRole: string;
  let ownerToken: string, cashierToken: string, managerToken: string;
  const login = (email: string, pass = password) => request(app).post('/api/v1/auth/login').send({ email, password: pass, client: 'mobile' });
  const me = (token: string) => request(app).get('/api/v1/auth/me').auth(token, { type: 'bearer' });
  const refresh = (refreshToken: string) => request(app).post('/api/v1/auth/refresh').send({ client: 'mobile', refreshToken });
  const put = (id: string, body: unknown, token = ownerToken) => request(app).put(`/api/v1/users/${id}`).auth(token, { type: 'bearer' }).send(body);
  const status = (id: string, active: boolean, token = ownerToken) => request(app).patch(`/api/v1/users/${id}/status`).auth(token, { type: 'bearer' }).send({ active });
  const reset = (id: string, pass = newPassword, token = ownerToken) => request(app).put(`/api/v1/users/${id}/password`).auth(token, { type: 'bearer' }).send({ password: pass });
  const get = (path: string, token = ownerToken) => request(app).get(`/api/v1/${path}`).auth(token, { type: 'bearer' });
  const make = async (label: string, roleId = cashierRole, branchIds = [stores[0]!]) => {
    const email = label + suffix;
    const result = await request(app).post('/api/v1/users').auth(ownerToken, { type: 'bearer' }).send({ email, name: label, password, roleIds: [roleId], storeIds: branchIds });
    expect(result.status).toBe(201); ids.push(result.body.data.id);
    return result.body.data as { id: string; email: string; name: string };
  };
  const body = (u: { name: string; email: string }) => ({ name: u.name, email: u.email, active: true, roleIds: [cashierRole], storeIds: [stores[0]!] });
  beforeAll(async () => {
    if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/smart_store_users_test') throw new Error('Expected isolated user-management database');
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma: db } = await import('./common/database.js'));
    // This suite needs a single initial owner to verify the last-owner invariant.
    if (await db.user.count() !== 0) throw new Error('User test database is not empty; refusing to alter existing users');
    const codes = ['users.read', 'users.manage', 'stores.read', 'roles.read', 'roles.manage', 'permissions.read'];
    for (const code of codes) await db.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
    for (const [code, permissions] of [['OWNER', codes], [`CASH_${run}`, ['stores.read']], [`MGR_${run}`, ['users.read', 'users.manage', 'stores.read']], [`HIGH_${run}`, codes]] as const) {
      roles.push((await db.role.create({ data: { code, name: code, permissions: { create: permissions.map(permissionCode => ({ permissionCode })) } } })).id);
    }
    [ownerRole, cashierRole, managerRole, higherRole] = roles as [string, string, string, string];
    for (const code of ['A', 'B']) stores.push((await db.store.create({ data: { code: `${code}_${run}`, name: code, warehouses: { create: { code: `W${code}_${run}`, name: code } } } })).id);
    const { hashPassword } = await import('./modules/auth/password.js');
    const ownerEmail = 'owner' + suffix;
    ownerId = (await db.user.create({ data: { email: ownerEmail, name: 'Owner', passwordHash: await hashPassword(password), roles: { create: { roleId: ownerRole } } } })).id; ids.push(ownerId);
    app = (await import('./app.js')).createApp(async () => {});
    ownerToken = (await login(ownerEmail)).body.data.accessToken;
    cashierToken = (await login((await make('cashier')).email)).body.data.accessToken;
    managerToken = (await login((await make('manager', managerRole)).email)).body.data.accessToken;
  }, 30000);
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.role.deleteMany({ where: { id: { in: roles } } });
    await db.warehouse.deleteMany({ where: { storeId: { in: stores } } });
    await db.store.deleteMany({ where: { id: { in: stores } } });
    await db.$disconnect();
  });
  it('lists and filters with stable pagination without expanding scope', async () => {
    await make('page-one'); await make('page-two', cashierRole, [stores[1]!]);
    const first = await get('users?q=page-&pageSize=1');
    const second = await get('users?q=page-&pageSize=1&page=2');
    expect(first.body.pagination).toMatchObject({ total: 2, totalPages: 2, page: 1 });
    expect(first.body.data[0].id).not.toBe(second.body.data[0].id);
    expect((await get(`users?q=page-&storeId=${stores[1]}`, managerToken)).body.data).toEqual([]);
    expect((await get(`users?q=page-&roleId=${cashierRole}&active=true`)).body.pagination.total).toBe(2);
    expect((await get('users?pageSize=101')).status).toBe(400);
    expect((await get('users?active=invalid')).status).toBe(400);
  });
  it('returns details without secrets and checks scope, missing IDs and malformed IDs', async () => {
    const u = await make('details'); const outside = await make('outside', cashierRole, [stores[1]!]);
    const result = await get(`users/${u.id}`, managerToken);
    expect(result.status).toBe(200); expect(result.text).not.toContain('passwordHash');
    expect((await get(`users/${outside.id}`, managerToken)).status).toBe(403);
    expect((await get(`users/${ownerId}`, managerToken)).status).toBe(403);
    expect((await get(`users/${randomUUID()}`)).status).toBe(404);
    expect((await get('users/invalid')).status).toBe(400);
  });
  it('updates profile and assignments, revokes all sessions and preserves password if omitted', async () => {
    const u = await make('edit'); const one = (await login(u.email)).body.data; const two = (await login(u.email)).body.data;
    const result = await put(u.id, { ...body(u), name: 'Đã sửa', roleIds: [managerRole], storeIds: [stores[1]] });
    expect(result.status).toBe(200); expect(result.body.data.name).toBe('Đã sửa');
    for (const session of [one, two]) { expect((await me(session.accessToken)).status).toBe(401); expect((await refresh(session.refreshToken)).status).toBe(401); }
    const current = await login(u.email); expect(current.status).toBe(200);
    expect(current.body.data.user.stores.map((s: { id: string }) => s.id)).toEqual([stores[1]]);
    expect(current.body.data.user.permissions).toContain('users.manage');
  });
  it('rolls back assignment changes and session revocations on duplicate email', async () => {
    const u = await make('rollback'); const other = await make('duplicate');
    const token = (await login(u.email)).body.data.accessToken;
    const result = await put(u.id, { ...body(u), email: other.email, storeIds: [stores[1]] });
    expect(result.status).toBe(409); expect((await me(token)).status).toBe(200);
    const current = (await get(`users/${u.id}`)).body.data;
    expect(current.email).toBe(u.email); expect(current.stores[0].id).toBe(stores[0]);
    expect(await db.auditLog.count({ where: { targetId: u.id, action: 'user.update' } })).toBe(0);
  });
  it('locks and unlocks without restoring old sessions or repeating audit', async () => {
    const u = await make('lock'); const session = (await login(u.email)).body.data;
    expect((await status(u.id, false)).status).toBe(200);
    expect((await status(u.id, false)).status).toBe(200);
    expect((await login(u.email)).status).toBe(401); expect((await me(session.accessToken)).status).toBe(401);
    expect((await status(u.id, true)).status).toBe(200); expect((await login(u.email)).status).toBe(200);
    expect((await refresh(session.refreshToken)).status).toBe(401);
    expect(await db.auditLog.count({ where: { targetId: u.id, action: 'user.disable' } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: u.id, action: 'user.enable' } })).toBe(1);
  });
  it('resets password and invalidates every old session', async () => {
    const u = await make('password'); const a = (await login(u.email)).body.data; const b = (await login(u.email)).body.data;
    const result = await reset(u.id); expect(result.status).toBe(200); expect(result.text).not.toContain(newPassword);
    expect((await login(u.email)).status).toBe(401); expect((await login(u.email, newPassword)).status).toBe(200);
    for (const s of [a, b]) { expect((await me(s.accessToken)).status).toBe(401); expect((await refresh(s.refreshToken)).status).toBe(401); }
    expect(await db.auditLog.count({ where: { targetId: u.id, action: 'user.password.reset' } })).toBe(1);
  });
  it('does not unlock an account when its password is reset', async () => {
    const u = await make('locked-password'); await status(u.id, false);
    expect((await reset(u.id)).status).toBe(200); expect((await login(u.email, newPassword)).status).toBe(401);
    expect((await get(`users/${u.id}`)).body.data.active).toBe(false);
  });
  it('supports the optional password in full update and requires explicit active', async () => {
    const u = await make('full-password');
    const { active: _active, ...missingActive } = body(u);
    expect((await put(u.id, missingActive)).status).toBe(400);
    expect((await put(u.id, { ...body(u), password: newPassword })).status).toBe(200);
    expect((await login(u.email, newPassword)).status).toBe(200);
  });
  it('blocks cashier and scoped manager from out-of-scope mutations', async () => {
    const u = await make('forbidden', cashierRole, [stores[1]!]);
    for (const token of [cashierToken, managerToken]) {
      expect((await put(u.id, body(u), token)).status).toBe(403);
      expect((await status(u.id, false, token)).status).toBe(403);
      expect((await reset(u.id, newPassword, token)).status).toBe(403);
    }
    expect((await request(app).patch(`/api/v1/users/${u.id}/status`).send({ active: false })).status).toBe(401);
  });
  it('prevents takeover of a higher-privilege account in the same branch', async () => {
    const u = await make('higher', higherRole);
    expect((await reset(u.id, newPassword, managerToken)).status).toBe(403);
    expect((await status(u.id, false, managerToken)).status).toBe(403);
    expect((await put(u.id, body(u), managerToken)).status).toBe(403);
    expect((await login(u.email)).status).toBe(200);
  });
  it('allows delegated management of an equal or lower privilege target in scope', async () => {
    const u = await make('delegated-edit');
    expect((await put(u.id, { ...body(u), name: 'Delegated edit' }, managerToken)).status).toBe(200);
    expect((await reset(u.id, newPassword, managerToken)).status).toBe(200);
    expect((await status(u.id, false, managerToken)).status).toBe(200);
    expect((await status(u.id, true, managerToken)).status).toBe(200);
  });
  it('retains inactive branch assignments in administrator detail and supports locking them', async () => {
    const u = await make('inactive-branch');
    await db.store.update({ where: { id: stores[0] }, data: { active: false } });
    try {
      expect((await get(`users/${u.id}`)).body.data.stores[0]).toMatchObject({ id: stores[0], active: false });
      expect((await status(u.id, false)).status).toBe(200);
    } finally { await db.store.update({ where: { id: stores[0] }, data: { active: true } }); }
  });
  it('validates status and password payloads and nonexistent targets', async () => {
    const u = await make('invalid');
    expect((await reset(u.id, 'short')).status).toBe(400);
    expect((await request(app).patch(`/api/v1/users/${u.id}/status`).auth(ownerToken, { type: 'bearer' }).send({ active: 'false' })).status).toBe(400);
    expect((await reset(randomUUID())).status).toBe(404);
    expect((await status(randomUUID(), false)).status).toBe(404);
  });
  it('protects the last active OWNER against disabling or demotion', async () => {
    expect(await db.user.count({ where: { active: true, roles: { some: { role: { code: 'OWNER' } } } } })).toBe(1);
    expect((await status(ownerId, false)).body.code).toBe('LAST_OWNER');
    expect((await put(ownerId, { name: 'Owner', email: 'owner' + suffix, active: true, roleIds: [cashierRole], storeIds: [stores[0]] })).body.code).toBe('LAST_OWNER');
    expect((await me(ownerToken)).status).toBe(200);
  });
  it('documents every operation for a single review', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json')).body;
    for (const [path, method] of [['/users', 'get'], ['/users', 'post'], ['/users/{id}', 'get'], ['/users/{id}', 'put'], ['/users/{id}/status', 'patch'], ['/users/{id}/password', 'put']]) {
      expect(spec.paths[`/api/v1${path}`][method].security).toEqual([{ bearerAuth: [] }]);
    }
  });
  it('keeps an active OWNER when two owners are disabled concurrently', async () => {
    const second = await make('second-owner', ownerRole, []);
    const secondToken = (await login(second.email)).body.data.accessToken;
    const results = await Promise.all([status(ownerId, false), status(second.id, false, secondToken)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await db.user.count({ where: { active: true, roles: { some: { role: { code: 'OWNER' } } } } })).toBe(1);
  });
});
