import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { cancelInvoice, createInvoice, createSalesReturn, getInvoice, listFefoPromoCodes, listInvoicePayments, listInvoices, listSalesReturns, verifyFefoPromoForCart } from './invoices.service.js';
import { cancelInvoiceInput, createInvoiceInput, createSalesReturnInput, invoiceIdInput, invoiceListInput, paymentListInput, salesReturnListInput } from './invoices.schemas.js';

export const invoiceRoutes = Router(); const ok = (data: unknown) => ({ success: true, message: 'Success', data });
const fefoPromoListQuery = z.object({ warehouseId: z.string().uuid() });
const fefoPromoVerifyBody = z.object({
  warehouseId: z.string().uuid(),
  promoCodes: z.array(z.string().trim().min(3).max(80)).min(1).max(20),
  items: z.array(z.object({ skuId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(100_000) }).strict()).min(1).max(100),
}).strict();

invoiceRoutes.use(authenticate); invoiceRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
invoiceRoutes.get('/invoices', requirePermission('invoices.read'), async (request, response) => response.json(ok(await listInvoices(request.currentUser, invoiceListInput.parse(request.query)))));
invoiceRoutes.get('/invoices/fefo-promo-codes', requirePermission('invoices.create'), async (request, response) => response.json(ok(await listFefoPromoCodes(request.currentUser, fefoPromoListQuery.parse(request.query).warehouseId))));
invoiceRoutes.post('/invoices/verify-fefo-promo', requirePermission('invoices.create'), async (request, response) => response.json(ok(await verifyFefoPromoForCart(request.currentUser, fefoPromoVerifyBody.parse(request.body)))));
invoiceRoutes.get('/invoice-payments', requirePermission('invoices.read'), async (request, response) => response.json(ok(await listInvoicePayments(request.currentUser, paymentListInput.parse(request.query)))));
invoiceRoutes.get('/returns', requirePermission('returns.read'), async (request, response) => response.json(ok(await listSalesReturns(request.currentUser, salesReturnListInput.parse(request.query)))));
invoiceRoutes.get('/invoices/:id', requirePermission('invoices.read'), async (request, response) => response.json(ok(await getInvoice(request.currentUser, invoiceIdInput.parse(request.params.id)))));
invoiceRoutes.post('/invoices', requirePermission('invoices.create'), async (request, response) => response.status(201).json(ok(await createInvoice(request.currentUser, createInvoiceInput.parse(request.body)))));
invoiceRoutes.post('/invoices/:id/cancel', requirePermission('invoices.cancel'), async (request, response) => response.json(ok(await cancelInvoice(request.currentUser, invoiceIdInput.parse(request.params.id), cancelInvoiceInput.parse(request.body)))));
invoiceRoutes.post('/invoices/:id/returns', requirePermission('returns.manage'), async (request, response) => response.status(201).json(ok(await createSalesReturn(request.currentUser, invoiceIdInput.parse(request.params.id), createSalesReturnInput.parse(request.body)))));
