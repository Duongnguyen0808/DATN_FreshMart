import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('POST /api/v1/users on PostgreSQL', () => {
  let db: typeof import('./common/database.js').prisma;
  let app: ReturnType<typeof import('./app.js').createApp>;
  const run = randomUUID();
  const suffix = `-${run}@test.local`;
  const password = 'Test-only-create-user-123';
  const roleIds: string[] = [], storeIds: string[] = [];
  let ownerRole: string, cashierRole: string, managerRole: string;
  let ownerToken: string, cashierToken: string, managerToken: string, ownerId: string;
  const input = (label = randomUUID()) => ({ email: label + suffix, name: 'Nhân viên thử', password, roleIds: [cashierRole], storeIds: [storeIds[0]!] });
  const create = (body: unknown, token = ownerToken) => request(app).post('/api/v1/users').auth(token, { type: 'bearer' }).send(body);
  beforeAll(async () => {
    if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/smart_store_auth_test') throw new Error('Expected test database');
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma: db } = await import('./common/database.js'));
    const { hashPassword } = await import('./modules/auth/password.js');
    const codes = ['users.manage', 'users.read', 'stores.read', 'roles.read', 'roles.manage', 'permissions.read'];
    for (const code of codes) await db.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
    let owner = await db.role.findUnique({ where: { code: 'OWNER' } });
    if (!owner) { owner = await db.role.create({ data: { code: 'OWNER', name: 'Owner', system: true, permissions: { create: codes.map(permissionCode => ({ permissionCode })) } } }); roleIds.push(owner.id); }
    ownerRole = owner.id;
    for (const [code, permissions] of [['CASH', ['stores.read']], ['MGR', ['users.manage', 'stores.read']]] as const) {
      roleIds.push((await db.role.create({ data: { code: `${code}_${run}`, name: code, permissions: { create: permissions.map(permissionCode => ({ permissionCode })) } } })).id);
    }
    cashierRole = roleIds.at(-2)!; managerRole = roleIds.at(-1)!;
    for (const code of ['A', 'B', 'INACTIVE']) storeIds.push((await db.store.create({ data: { code: `${code}_${run}`, name: code, active: code !== 'INACTIVE', warehouses: { create: { code: `W${code}_${run}`, name: code } } } })).id);
    app = (await import('./app.js')).createApp(async () => {});
    const passwordHash = await hashPassword(password);
    const fixture = async (label: string, roleId: string, stores: string[]) => {
      const email = label + suffix;
      const user = await db.user.create({ data: { email, name: label, passwordHash, roles: { create: { roleId } }, stores: { create: stores.map(storeId => ({ storeId })) } } });
      const result = await request(app).post('/api/v1/auth/login').send({ email, password, client: 'mobile' });
      expect(result.status).toBe(200);
      return { id: user.id, token: result.body.data.accessToken as string };
    };
    const ownerUser = await fixture('owner', ownerRole, []); ownerId = ownerUser.id; ownerToken = ownerUser.token;
    cashierToken = (await fixture('cashier', cashierRole, [storeIds[0]!])).token;
    managerToken = (await fixture('manager', managerRole, [storeIds[0]!])).token;
  }, 30000);
  afterAll(async () => {
    if (!db) return;
    const users = await db.user.findMany({ where: { email: { endsWith: suffix } }, select: { id: true } });
    const ids = users.map(u => u.id);
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.role.deleteMany({ where: { id: { in: roleIds } } });
    await db.warehouse.deleteMany({ where: { storeId: { in: storeIds } } });
    await db.store.deleteMany({ where: { id: { in: storeIds } } });
    await db.$disconnect();
  });
  it('creates user, assignments and audit, and the new employee can log in with scoped permissions', async () => {
    const body = input('success');
    const result = await create(body);
    expect(result.status).toBe(201);
    expect(result.body.data.active).toBe(true);
    expect(result.text).not.toContain(password);
    expect(result.text).not.toContain('passwordHash');
    const user = await db.user.findUniqueOrThrow({ where: { email: body.email }, include: { roles: true, stores: true } });
    expect(user.passwordHash).not.toBe(password);
    expect(user.roles.map(r => r.roleId)).toEqual([cashierRole]);
    expect(user.stores.map(s => s.storeId)).toEqual([storeIds[0]]);
    expect(await db.auditLog.count({ where: { actorId: ownerId, targetId: user.id, action: 'user.create' } })).toBe(1);
    const login = await request(app).post('/api/v1/auth/login').send({ email: body.email, password, client: 'mobile' });
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken;
    expect((await request(app).get('/api/v1/users').auth(token, { type: 'bearer' })).status).toBe(403);
    expect((await request(app).get('/api/v1/stores').auth(token, { type: 'bearer' })).body.data.map((s: { id: string }) => s.id)).toEqual([storeIds[0]]);
  });
  it('normalizes email and rejects duplicates without another user or audit', async () => {
    const body = input('duplicate');
    expect((await create({ ...body, email: ` ${body.email.toUpperCase()} ` })).status).toBe(201);
    const count = await db.auditLog.count({ where: { actorId: ownerId, action: 'user.create' } });
    expect((await create(body)).status).toBe(409);
    expect(await db.user.count({ where: { email: body.email } })).toBe(1);
    expect(await db.auditLog.count({ where: { actorId: ownerId, action: 'user.create' } })).toBe(count);
  });
  it('validates fields and rejects mass assignment', async () => {
    const body = input('invalid');
    for (const bad of [
      { ...body, password: 'short' }, { ...body, email: 'invalid' }, { ...body, name: '  ' },
      { ...body, roleIds: [] }, { ...body, roleIds: [cashierRole, cashierRole] },
      { ...body, storeIds: [storeIds[0], storeIds[0]] }, { ...body, roleIds: ['CASHIER'] },
      { ...body, globalAccess: true }, { ...body, passwordHash: 'injected' },
    ]) expect((await create(bad)).status).toBe(400);
    expect(await db.user.count({ where: { email: body.email } })).toBe(0);
  });
  it('rejects nonexistent roles, missing branches and inactive branches without partial writes', async () => {
    const body = input('assignment');
    for (const bad of [
      { ...body, roleIds: [randomUUID()] }, { ...body, storeIds: [randomUUID()] },
      { ...body, storeIds: [storeIds[2]] }, { ...body, storeIds: [] },
    ]) expect((await create(bad)).status).toBe(400);
    expect(await db.user.count({ where: { email: body.email } })).toBe(0);
  });
  it('requires authentication and users.manage', async () => {
    expect((await request(app).post('/api/v1/users').send(input())).status).toBe(401);
    expect((await create(input(), cashierToken)).status).toBe(403);
  });
  it('permits delegated creation within scope and prevents granting OWNER, higher rights or another branch', async () => {
    expect((await create(input('delegated'), managerToken)).status).toBe(201);
    expect((await create({ ...input(), storeIds: [storeIds[1]] }, managerToken)).status).toBe(403);
    expect((await create({ ...input(), roleIds: [ownerRole], storeIds: [] }, managerToken)).status).toBe(403);
    const elevated = await db.role.create({ data: { code: `HIGH_${run}`, name: 'Higher privilege', permissions: { create: { permissionCode: 'roles.manage' } } } }); roleIds.push(elevated.id);
    expect((await create({ ...input(), roleIds: [elevated.id] }, managerToken)).status).toBe(403);
  });
  it('allows OWNER creation without a branch only when the actor is authorized', async () => {
    const result = await create({ ...input('new-owner'), roleIds: [ownerRole], storeIds: [] });
    expect(result.status).toBe(201);
    expect(result.body.data.globalAccess).toBe(true);
  });
  it('creates an inactive account that cannot log in', async () => {
    const body = { ...input('inactive'), active: false };
    expect((await create(body)).status).toBe(201);
    expect((await request(app).post('/api/v1/auth/login').send({ email: body.email, password, client: 'mobile' })).status).toBe(401);
  });
  it('creates only one account when duplicate requests arrive concurrently', async () => {
    const body = input('concurrent');
    const results = await Promise.all([create(body), create(body)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await db.user.count({ where: { email: body.email } })).toBe(1);
    const user = await db.user.findUniqueOrThrow({ where: { email: body.email } });
    expect(await db.auditLog.count({ where: { targetId: user.id, action: 'user.create' } })).toBe(1);
  });
  it('exposes creation in Swagger while preserving the user list operation', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json')).body;
    const path = spec.paths['/api/v1/users'];
    expect(path.get).toBeDefined();
    expect(path.post.security).toEqual([{ bearerAuth: [] }]);
    expect(path.post.responses).toHaveProperty('201');
    expect(path.post.responses).toHaveProperty('409');
    expect(path.post.requestBody.content['application/json'].schema.properties.password.writeOnly).toBe(true);
  });
});
