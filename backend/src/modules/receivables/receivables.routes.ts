import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { collectCustomerReceivables, collectReceivable, getReceivable, listReceivables } from './receivables.service.js';
import { createReceivablePaymentInput, customerReceivablePaymentInput, receivableIdInput, receivableListInput } from './receivables.schemas.js';

export const receivableRoutes = Router(); const ok = (data: unknown) => ({ success: true, message: 'Success', data });
receivableRoutes.use(authenticate); receivableRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
receivableRoutes.get('/receivables', requirePermission('receivables.read'), async (request, response) => response.json(ok(await listReceivables(request.currentUser, receivableListInput.parse(request.query)))));
receivableRoutes.get('/receivables/:id', requirePermission('receivables.read'), async (request, response) => response.json(ok(await getReceivable(request.currentUser, receivableIdInput.parse(request.params.id)))));
receivableRoutes.post('/receivables/:id/payments', requirePermission('receivables.pay'), async (request, response) => response.status(201).json(ok(await collectReceivable(request.currentUser, receivableIdInput.parse(request.params.id), createReceivablePaymentInput.parse(request.body)))));
receivableRoutes.post('/customers/:customerId/receivable-payments', requirePermission('receivables.pay'), async (request, response) => response.status(201).json(ok(await collectCustomerReceivables(request.currentUser, receivableIdInput.parse(request.params.customerId), customerReceivablePaymentInput.parse(request.body)))));
