import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { createPurchaseOrder, createSupplierReturn, getPurchaseOrder, listGoodsReceipts, listPurchaseOrders, listSupplierReturns, receivePurchaseOrder } from './purchase-orders.service.js';
import { createPurchaseOrderInput, createSupplierReturnInput, goodsReceiptListInput, purchaseOrderIdInput, purchaseOrderListInput, receivePurchaseOrderInput, supplierReturnListInput } from './purchase-orders.schemas.js';

export const purchaseOrderRoutes = Router();
const ok = (data: unknown) => ({ success: true, message: 'Success', data });
purchaseOrderRoutes.use(authenticate);
purchaseOrderRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
purchaseOrderRoutes.get('/purchase-orders', requirePermission('purchase_orders.read'), async (request, response) => response.json(ok(await listPurchaseOrders(request.currentUser, purchaseOrderListInput.parse(request.query)))));
purchaseOrderRoutes.get('/goods-receipts', requirePermission('purchase_orders.read'), async (request, response) => response.json(ok(await listGoodsReceipts(request.currentUser, goodsReceiptListInput.parse(request.query)))));
purchaseOrderRoutes.get('/purchase-orders/:id', requirePermission('purchase_orders.read'), async (request, response) => response.json(ok(await getPurchaseOrder(request.currentUser, purchaseOrderIdInput.parse(request.params.id)))));
purchaseOrderRoutes.post('/purchase-orders', requirePermission('purchase_orders.create'), async (request, response) => response.status(201).json(ok(await createPurchaseOrder(request.currentUser, createPurchaseOrderInput.parse(request.body)))));
purchaseOrderRoutes.post('/purchase-orders/:id/receipts', requirePermission('purchase_orders.receive'), async (request, response) => response.status(201).json(ok(await receivePurchaseOrder(request.currentUser, purchaseOrderIdInput.parse(request.params.id), receivePurchaseOrderInput.parse(request.body)))));
purchaseOrderRoutes.get('/supplier-returns', requirePermission('purchase_orders.read'), async (request, response) => response.json(ok(await listSupplierReturns(request.currentUser, supplierReturnListInput.parse(request.query)))));
purchaseOrderRoutes.post('/purchase-orders/:id/returns', requirePermission('purchase_orders.receive'), async (request, response) => response.status(201).json(ok(await createSupplierReturn(request.currentUser, purchaseOrderIdInput.parse(request.params.id), createSupplierReturnInput.parse(request.body)))));
