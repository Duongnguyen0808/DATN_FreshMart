import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('RBAC and branch scope on PostgreSQL', () => {
  let db: typeof import('./common/database.js').prisma;
  let app: ReturnType<typeof import('./app.js').createApp>;
  const run = randomUUID();
  const users: string[] = [], stores: string[] = [], roles: string[] = [];
  let ownerToken: string, cashierToken: string, readerToken: string, unassignedToken: string;
  let cashierId: string, cashierRole: string;
  beforeAll(async () => {
    if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/smart_store_auth_test') throw new Error('Expected test database');
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma: db } = await import('./common/database.js'));
    const { hashPassword } = await import('./modules/auth/password.js');
    const codes = ['stores.read', 'users.read', 'users.manage', 'roles.read', 'roles.manage', 'permissions.read'];
    for (const code of codes) await db.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
    let owner = await db.role.findUnique({ where: { code: 'OWNER' } });
    if (!owner) { owner = await db.role.create({ data: { code: 'OWNER', name: 'Owner', system: true, permissions: { create: codes.map(permissionCode => ({ permissionCode })) } } }); roles.push(owner.id); }
    cashierRole = (await db.role.create({ data: { code: `CASH_${run}`, name: 'Thu ngân', permissions: { create: { permissionCode: 'stores.read' } } } })).id;
    roles.push(cashierRole);
    const readerRole = (await db.role.create({ data: { code: `READ_${run}`, name: 'Quản lý theo chi nhánh', permissions: { create: [{ permissionCode: 'stores.read' }, { permissionCode: 'users.read' }] } } })).id;
    roles.push(readerRole);
    for (const code of ['A', 'B']) stores.push((await db.store.create({ data: { code: `${code}_${run}`, name: code, warehouses: { create: { code: `W${code}_${run}`, name: code } } } })).id);
    const password = 'Test-only-rbac-password-123';
    const passwordHash = await hashPassword(password);
    app = (await import('./app.js')).createApp(async () => {});
    const createUser = async (label: string, roleId: string, branchIds: string[]) => {
      const email = `${label}-${run}@test.local`;
      const user = await db.user.create({ data: { email, name: label, passwordHash, roles: { create: { roleId } }, stores: { create: branchIds.map(storeId => ({ storeId })) } } });
      users.push(user.id);
      const response = await request(app).post('/api/v1/auth/login').send({ email, password, client: 'mobile' });
      expect(response.status).toBe(200);
      return { id: user.id, token: response.body.data.accessToken as string };
    };
    ownerToken = (await createUser('owner', owner.id, [])).token;
    const cashier = await createUser('cashier', cashierRole, [stores[0]!]);
    cashierId = cashier.id; cashierToken = cashier.token;
    readerToken = (await createUser('reader', readerRole, [stores[0]!])).token;
    unassignedToken = (await createUser('unassigned', cashierRole, [])).token;
    await createUser('branch-b', cashierRole, [stores[1]!]);
    await createUser('both-branches', cashierRole, stores);
  }, 30000);
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.role.deleteMany({ where: { id: { in: roles } } });
    await db.warehouse.deleteMany({ where: { storeId: { in: stores } } });
    await db.store.deleteMany({ where: { id: { in: stores } } });
    await db.$disconnect();
  });
  const get = (path: string, token: string) => request(app).get(`/api/v1/${path}`).auth(token, { type: 'bearer' });
  it('requires authentication for protected endpoints', async () => {
    for (const path of ['users', 'roles', 'permissions', 'stores']) expect((await request(app).get(`/api/v1/${path}`)).status).toBe(401);
  });
  it('allows owner to read administration and all active branches', async () => {
    for (const path of ['users', 'roles', 'permissions']) expect((await get(path, ownerToken)).status).toBe(200);
    const result = await get('stores', ownerToken);
    expect(result.body.data.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining(stores));
  });
  it('blocks cashier from reading and writing administration', async () => {
    for (const path of ['users', 'roles', 'permissions']) expect((await get(path, cashierToken)).status).toBe(403);
    for (const path of ['users', 'roles']) expect((await request(app).post(`/api/v1/${path}`).auth(cashierToken, { type: 'bearer' }).send({})).status).toBe(403);
    expect((await request(app).put(`/api/v1/users/${cashierId}`).auth(cashierToken, { type: 'bearer' }).send({})).status).toBe(403);
    expect((await request(app).delete(`/api/v1/roles/${cashierRole}`).auth(cashierToken, { type: 'bearer' })).status).toBe(403);
  });
  it('filters branch lists and denies direct cross-branch IDs (BR-10)', async () => {
    const result = await get('stores', cashierToken);
    expect(result.body.data.map((s: { id: string }) => s.id)).toEqual([stores[0]]);
    expect((await get(`stores/${stores[0]}`, cashierToken)).status).toBe(200);
    expect((await get(`stores/${stores[1]}`, cashierToken)).body.code).toBe('STORE_FORBIDDEN');
    expect((await get(`stores?storeId=${stores[1]}&globalAccess=true`, cashierToken)).body.data.map((s: { id: string }) => s.id)).toEqual([stores[0]]);
  });
  it('does not give an unassigned employee any branch access', async () => {
    expect((await get('stores', unassignedToken)).body.data).toEqual([]);
    expect((await get(`stores/${stores[0]}`, unassignedToken)).status).toBe(403);
  });
  it('limits a delegated user reader to employees entirely within their scope', async () => {
    const result = await get('users', readerToken);
    expect(result.status).toBe(200);
    expect(result.body.data.map((u: { name: string }) => u.name).sort()).toEqual(['cashier', 'reader']);
    expect(result.text).not.toContain('passwordHash');
    expect(result.text).not.toContain('refreshHash');
  });
  it('applies permission changes immediately without reissuing the access token', async () => {
    await db.rolePermission.delete({ where: { roleId_permissionCode: { roleId: cashierRole, permissionCode: 'stores.read' } } });
    try { expect((await get('stores', cashierToken)).status).toBe(403); }
    finally { await db.rolePermission.create({ data: { roleId: cashierRole, permissionCode: 'stores.read' } }); }
    expect((await get('stores', cashierToken)).status).toBe(200);
  });
  it('applies branch reassignment immediately', async () => {
    await db.userStore.update({ where: { userId_storeId: { userId: cashierId, storeId: stores[0]! } }, data: { storeId: stores[1] } });
    try {
      expect((await get(`stores/${stores[0]}`, cashierToken)).status).toBe(403);
      expect((await get(`stores/${stores[1]}`, cashierToken)).status).toBe(200);
    } finally { await db.userStore.update({ where: { userId_storeId: { userId: cashierId, storeId: stores[1]! } }, data: { storeId: stores[0] } }); }
  });
  it('excludes deactivated branches and rejects disabled users', async () => {
    await db.store.update({ where: { id: stores[0] }, data: { active: false } });
    try {
      expect((await get('stores', cashierToken)).body.data).toEqual([]);
      expect((await get(`stores/${stores[0]}`, cashierToken)).status).toBe(403);
      expect((await get(`stores/${stores[0]}`, ownerToken)).status).toBe(404);
    } finally { await db.store.update({ where: { id: stores[0] }, data: { active: true } }); }
    await db.user.update({ where: { id: cashierId }, data: { active: false } });
    try { expect((await get('stores', cashierToken)).status).toBe(401); }
    finally { await db.user.update({ where: { id: cashierId }, data: { active: true } }); }
  });
  it('documents the permission and branch checks with bearer security', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json')).body;
    for (const path of ['users', 'roles', 'permissions', 'stores', 'stores/{id}']) {
      const operation = spec.paths[`/api/v1/${path}`].get;
      expect(operation.security).toEqual([{ bearerAuth: [] }]);
      expect(operation.responses).toHaveProperty('403');
    }
  });
});
