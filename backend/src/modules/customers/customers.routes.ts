import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { changeCustomerStatus, createCustomer, customerIdInput, customerInput, customerListInput, customerStatusInput, getCustomer, listCustomers, updateCustomer } from './customers.service.js';

export const customerRoutes = Router();
const ok = (data: unknown) => ({ success: true, message: 'Success', data });
customerRoutes.use(authenticate);
customerRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
customerRoutes.get('/customers', requirePermission('customers.read'), async (request, response) => response.json(ok(await listCustomers(customerListInput.parse(request.query)))));
customerRoutes.get('/customers/:id', requirePermission('customers.read'), async (request, response) => response.json(ok(await getCustomer(customerIdInput.parse(request.params.id)))));
customerRoutes.post('/customers', requirePermission('customers.manage'), async (request, response) => response.status(201).json(ok(await createCustomer(request.currentUser, customerInput.parse(request.body)))));
customerRoutes.put('/customers/:id', requirePermission('customers.manage'), async (request, response) => response.json(ok(await updateCustomer(request.currentUser, customerIdInput.parse(request.params.id), customerInput.parse(request.body)))));
customerRoutes.patch('/customers/:id/status', requirePermission('customers.manage'), async (request, response) => response.json(ok(await changeCustomerStatus(request.currentUser, customerIdInput.parse(request.params.id), customerStatusInput.parse(request.body).active))));
