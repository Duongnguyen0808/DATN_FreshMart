import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { adjustStock, getInventory, listInventory, listTransactions, setSafetyStock } from './inventory.service.js';
import { inventoryIdInput, inventoryListInput, safetyStockInput, stockAdjustmentInput, transactionListInput } from './inventory.schemas.js';
import { forecastInput } from '../forecasts/forecasts.schemas.js';
import { getShortageAlerts } from '../forecasts/forecasts.service.js';
export const inventoryRoutes = Router(); const ok = (data: unknown) => ({ success: true, message: 'Success', data });
inventoryRoutes.use(authenticate); inventoryRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
inventoryRoutes.get('/inventory', requirePermission('inventory.read'), async (request, response) => response.json(ok(await listInventory(request.currentUser, inventoryListInput.parse(request.query)))));
// Endpoint đọc dành cho app kho; quyền kiểm tra vẫn theo inventory.read và phạm vi chi nhánh.
inventoryRoutes.get('/inventory/forecast-alerts', requirePermission('inventory.read'), async (request, response) => response.json(ok(await getShortageAlerts(request.currentUser, forecastInput.parse(request.query)))));
inventoryRoutes.get('/inventory-transactions', requirePermission('inventory.read'), async (request, response) => response.json(ok(await listTransactions(request.currentUser, transactionListInput.parse(request.query)))));
inventoryRoutes.get('/inventory/:id', requirePermission('inventory.read'), async (request, response) => response.json(ok(await getInventory(request.currentUser, inventoryIdInput.parse(request.params.id)))));
inventoryRoutes.patch('/inventory/:id/safety-stock', requirePermission('warehouses.manage'), async (request, response) => response.json(ok(await setSafetyStock(request.currentUser, inventoryIdInput.parse(request.params.id), safetyStockInput.parse(request.body).safetyStock))));
inventoryRoutes.post('/inventory/:id/adjustments', requirePermission('stocktakes.approve'), async (request, response) => { const input = stockAdjustmentInput.parse(request.body); response.json(ok(await adjustStock(request.currentUser, inventoryIdInput.parse(request.params.id), input.actualQuantity, input.reason))); });
inventoryRoutes.get('/inventory/:id/transactions', requirePermission('inventory.read'), async (request, response) => response.json(ok(await listTransactions(request.currentUser, transactionListInput.parse(request.query), inventoryIdInput.parse(request.params.id)))));
