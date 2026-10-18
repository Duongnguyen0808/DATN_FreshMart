import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let createApp: typeof import('./app.js').createApp;
beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgresql://localhost:5432/smart_store';
  process.env.LOG_LEVEL = 'silent';
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-characters';
  ({ createApp } = await import('./app.js'));
});
describe('infrastructure HTTP contract', () => {
  it('reports liveness without querying the database', async () => {
    const database = vi.fn();
    const response = await request(createApp(database)).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
    expect(database).not.toHaveBeenCalled();
  });
  it('checks database readiness', async () => {
    const database = vi.fn().mockResolvedValue(undefined);
    expect((await request(createApp(database)).get('/api/v1/health/ready')).status).toBe(200);
    expect(database).toHaveBeenCalledOnce();
  });
  it('returns 503 without leaking database errors', async () => {
    const response = await request(createApp(async () => { throw new Error('secret connection'); }))
      .get('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('DATABASE_UNAVAILABLE');
    expect(response.text).not.toContain('secret');
  });
  it('normalizes invalid JSON and unknown routes', async () => {
    const app = createApp(async () => {});
    expect((await request(app).post('/missing').set('Content-Type', 'application/json').send('{')).status).toBe(400);
    expect((await request(app).get('/missing')).body.code).toBe('NOT_FOUND');
  });
  it('publishes the API specification and Swagger UI', async () => {
    const app = createApp(async () => {});
    expect((await request(app).get('/api/v1/openapi.json')).body.openapi).toBe('3.0.3');
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/warehouses']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/products']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/customers']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/invoices/{id}/returns']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/returns']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/receivables']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/receivables/{id}/payments']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/reconciliations/debt']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/shifts']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/transfers']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/transfers/{id}/cancel']?.post).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/suppliers']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/purchase-requests']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/purchase-orders'].get.parameters.find((item: { name: string }) => item.name === 'status').schema.enum).toContain('OVERDUE');
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/notifications']).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/iot/events']?.post).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/iot/tag-mappings']?.post).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/inventory/{id}/safety-stock']?.patch).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/inventory/{id}/adjustments']?.post).toBeTruthy();
    expect((await request(app).get('/api/v1/openapi.json')).body.paths['/api/v1/inventory/forecast-alerts']?.get).toBeTruthy();
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
    expect((await request(app).get('/api/v1/iot/events')).status).toBe(401);
    expect((await request(app).post('/api/v1/iot/simulate').send({})).status).toBe(401);
    expect([401, 503]).toContain((await request(app).post('/api/v1/iot/events').send({})).status);
    expect((await request(app).patch('/api/v1/inventory/11111111-1111-4111-8111-111111111111/safety-stock').send({ safetyStock: 10 })).status).toBe(401);
    expect((await request(app).post('/api/v1/inventory/11111111-1111-4111-8111-111111111111/adjustments').send({ actualQuantity: 10, reason: 'Kiểm kê bổ sung' })).status).toBe(401);
    expect((await request(app).post('/api/v1/transfers/11111111-1111-4111-8111-111111111111/cancel').send({ note: 'Không còn nhu cầu' })).status).toBe(401);
    expect((await request(app).get('/docs/')).status).toBe(200);
  });
});
