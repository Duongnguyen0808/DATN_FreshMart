import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { openapi } from './config/openapi.js';
import { logger } from './common/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import cookieParser from 'cookie-parser';
import { authRoutes } from './modules/auth/auth.routes.js';
import { adminRoutes } from './modules/users/admin.routes.js';
import { organizationRoutes } from './modules/organization/organization.routes.js';
import { productRoutes } from './modules/products/products.routes.js';
import { shiftRoutes } from './modules/shifts/shifts.routes.js';
import { invoiceRoutes } from './modules/invoices/invoices.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { stocktakeRoutes } from './modules/stocktakes/stocktakes.routes.js';
import { transferRoutes } from './modules/transfers/transfers.routes.js';
import { supplierRoutes } from './modules/suppliers/suppliers.routes.js';
import { purchaseRequestRoutes } from './modules/purchase-requests/purchase-requests.routes.js';
import { purchaseOrderRoutes } from './modules/purchase-orders/purchase-orders.routes.js';
import { payableRoutes } from './modules/payables/payables.routes.js';
import { receivableRoutes } from './modules/receivables/receivables.routes.js';
import { reconciliationRoutes } from './modules/reconciliations/reconciliations.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { reportRoutes } from './modules/reports/reports.routes.js';
import { customerRoutes } from './modules/customers/customers.routes.js';
import { forecastRoutes } from './modules/forecasts/forecasts.routes.js';
import { notificationRoutes } from './modules/notifications/notifications.routes.js';
import { payosRoutes } from './modules/payos/payos.routes.js';
import { iotRoutes } from './modules/iot/iot.routes.js';

export function createApp(checkDatabase: () => Promise<void>) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: {
    upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
  } } }));
  app.use(cors({ origin: env.CORS_ORIGINS.split(',').map(value => value.trim()), credentials: true }));
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());
  app.use('/api/v1/auth', authRoutes);
  app.get(['/health', '/api/v1/health'], (_request, response) => {
    response.json({ success: true, message: 'Success', data: { service: 'backend', status: 'ok' } });
  });
  app.get('/api/v1/health/ready', async (_request, response) => {
    try {
      await checkDatabase();
      response.json({ success: true, message: 'Success', data: { database: 'connected' } });
    } catch {
      logger.warn('Database readiness check failed');
      response.status(503).json({ success: false, message: 'Database unavailable', code: 'DATABASE_UNAVAILABLE' });
    }
  });
  app.get('/api/v1/openapi.json', (_request, response) => response.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
  app.use('/api/v1', payosRoutes);
  app.use('/api/v1', iotRoutes);
  app.use('/api/v1', organizationRoutes);
  app.use('/api/v1', productRoutes);
  app.use('/api/v1', shiftRoutes);
  app.use('/api/v1', invoiceRoutes);
  app.use('/api/v1', inventoryRoutes);
  app.use('/api/v1', stocktakeRoutes);
  app.use('/api/v1', transferRoutes);
  app.use('/api/v1', supplierRoutes);
  app.use('/api/v1', purchaseRequestRoutes);
  app.use('/api/v1', purchaseOrderRoutes);
  app.use('/api/v1', payableRoutes);
  app.use('/api/v1', receivableRoutes);
  app.use('/api/v1', reconciliationRoutes);
  app.use('/api/v1', dashboardRoutes);
  app.use('/api/v1', reportRoutes);
  app.use('/api/v1', forecastRoutes);
  app.use('/api/v1', notificationRoutes);
  app.use('/api/v1', customerRoutes);
  app.use('/api/v1', adminRoutes);
  app.use((_request, response) => response.status(404).json({
    success: false, message: 'Route not found', code: 'NOT_FOUND',
  }));
  app.use(errorHandler);
  return app;
}
