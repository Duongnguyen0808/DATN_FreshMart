import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('Product management on PostgreSQL', () => {
  let db: typeof import('./common/database.js').prisma;
  let app: ReturnType<typeof import('./app.js').createApp>;
  let adminToken: string;
  let readerToken: string;
  let forbiddenToken: string;
  let categoryId: string;
  let productId: string;
  let skuId: string;
  const run = randomUUID().slice(0, 8).toUpperCase();
  const barcode = `89${Date.now().toString().slice(-11)}`;
  const password = 'Product-Test-Password-123';
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (url.pathname !== '/smart_store_products_test') throw new Error('Refusing to test against a non-product test database');
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma: db } = await import('./common/database.js'));
    const { hashPassword } = await import('./modules/auth/password.js');
    app = (await import('./app.js')).createApp(async () => { await db.$queryRaw`SELECT 1`; });
    for (const code of ['products.read', 'products.manage', 'categories.manage', 'stores.read']) {
      await db.permission.upsert({ where: { code }, update: {}, create: { code, name: code } });
    }
    const role = async (code: string, permissions: string[]) => (await db.role.create({ data: { code: `${code}_${run}`, name: code, permissions: { create: permissions.map(permissionCode => ({ permissionCode })) } } })).id;
    const [adminRole, readerRole, forbiddenRole] = await Promise.all([
      role('PADMIN', ['products.read', 'products.manage', 'categories.manage']),
      role('PREADER', ['products.read']),
      role('PNONE', ['stores.read']),
    ]);
    const passwordHash = await hashPassword(password);
    const createUser = async (label: string, roleId: string) => db.user.create({ data: { email: `${label}-${run.toLowerCase()}@test.local`, name: label, passwordHash, roles: { create: { roleId } } } });
    const users = await Promise.all([createUser('admin', adminRole), createUser('reader', readerRole), createUser('forbidden', forbiddenRole)]);
    const login = async (email: string) => (await request(app).post('/api/v1/auth/login').send({ email, password, client: 'mobile' })).body.data.accessToken;
    [adminToken, readerToken, forbiddenToken] = await Promise.all(users.map(user => login(user.email)));
  }, 30000);

  afterAll(async () => { await db?.$disconnect(); });

  it('enforces authentication and product permissions', async () => {
    expect((await request(app).get('/api/v1/products')).status).toBe(401);
    expect((await request(app).get('/api/v1/products').set(auth(forbiddenToken))).status).toBe(403);
  });

  it('creates a category and product with a first price-history entry', async () => {
    const category = await request(app).post('/api/v1/categories').set(auth(adminToken)).send({ code: `CAT_${run}`, name: `Danh mục ${run}` });
    expect(category.status).toBe(201);
    categoryId = category.body.data.id;
    const nextCode = await request(app).get('/api/v1/products/next-code').set(auth(adminToken));
    expect(nextCode.status).toBe(200);
    const product = await request(app).post('/api/v1/products').set(auth(adminToken)).send({
      name: `Sản phẩm ${run}`, unit: 'Hộp', categoryId,
      sku: { barcode, sellingPrice: 120000, costPrice: 90000 },
    });
    expect(product.status).toBe(201);
    expect(product.body.data.code).toBe(nextCode.body.data);
    expect(product.body.data.code).toMatch(/^\d+$/);
    expect(product.body.data.skus[0].code).toBe(product.body.data.code);
    productId = product.body.data.id;
    skuId = product.body.data.skus[0].id;
    const detail = await request(app).get(`/api/v1/products/${productId}`).set(auth(adminToken));
    expect(detail.body.data.skus[0].priceHistory).toHaveLength(1);
  });

  it('rejects duplicate SKU and barcode and invalid prices', async () => {
    const original = (await request(app).get(`/api/v1/products/${productId}`).set(auth(adminToken))).body.data;
    const duplicate = { name: 'Trùng barcode', unit: 'Hộp', categoryId, sku: { barcode: original.skus[0].barcode, sellingPrice: 100, costPrice: 90 } };
    expect((await request(app).post('/api/v1/products').set(auth(adminToken)).send(duplicate)).status).toBe(409);
    expect((await request(app).post('/api/v1/products').set(auth(adminToken)).send({ ...duplicate, sku: { ...duplicate.sku, barcode: '8934567890123', sellingPrice: 80, costPrice: 90 } })).status).toBe(400);
  });

  it('searches, filters and paginates products', async () => {
    const result = await request(app).get(`/api/v1/products?q=${run}&active=true&page=1&pageSize=1`).set(auth(readerToken));
    expect(result.status).toBe(200);
    expect(result.body.data.items).toHaveLength(1);
    expect(result.body.data.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
  });

  it('updates product and records changed prices atomically', async () => {
    const current = (await request(app).get(`/api/v1/products/${productId}`).set(auth(adminToken))).body.data;
    const response = await request(app).put(`/api/v1/products/${productId}`).set(auth(adminToken)).send({
      name: `${current.name} cập nhật`, unit: 'Thùng', categoryId,
      sku: { id: skuId, code: current.skus[0].code, barcode: current.skus[0].barcode, sellingPrice: 130000, costPrice: 95000 },
    });
    expect(response.status).toBe(200);
    const detail = await request(app).get(`/api/v1/products/${productId}`).set(auth(adminToken));
    expect(detail.body.data.name).toContain('cập nhật');
    expect(detail.body.data.skus[0].priceHistory).toHaveLength(2);
  });

  it('lets readers view but not mutate and supports stopping/reopening sales', async () => {
    expect((await request(app).post('/api/v1/products').set(auth(readerToken)).send({})).status).toBe(403);
    expect((await request(app).patch(`/api/v1/products/${productId}/status`).set(auth(adminToken)).send({ active: false })).status).toBe(200);
    expect((await request(app).get(`/api/v1/products/barcode/${barcode}`).set(auth(adminToken))).status).toBe(404);
    const inactive = await request(app).get(`/api/v1/products?active=false&q=${run}`).set(auth(adminToken));
    expect(inactive.body.data.items[0].active).toBe(false);
    expect((await request(app).patch(`/api/v1/products/${productId}/status`).set(auth(adminToken)).send({ active: true })).status).toBe(200);
    expect((await request(app).get(`/api/v1/products/barcode/${barcode}`).set(auth(adminToken))).status).toBe(200);
    expect(await db.auditLog.count({ where: { targetId: productId } })).toBeGreaterThanOrEqual(3);
  });
});
