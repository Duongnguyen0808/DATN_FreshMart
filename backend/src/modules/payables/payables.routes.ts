import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { getPayable, listPayables, payPayable } from './payables.service.js';
import { createPayablePaymentInput, payableIdInput, payableListInput } from './payables.schemas.js';
export const payableRoutes = Router(); const ok = (data: unknown) => ({ success: true, message: 'Success', data });
payableRoutes.use(authenticate); payableRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
payableRoutes.get('/payables', requirePermission('payables.read'), async (request, response) => response.json(ok(await listPayables(request.currentUser, payableListInput.parse(request.query)))));
payableRoutes.get('/payables/:id', requirePermission('payables.read'), async (request, response) => response.json(ok(await getPayable(request.currentUser, payableIdInput.parse(request.params.id)))));
payableRoutes.post('/payables/:id/payments', requirePermission('payables.pay'), async (request, response) => response.status(201).json(ok(await payPayable(request.currentUser, payableIdInput.parse(request.params.id), createPayablePaymentInput.parse(request.body)))));
