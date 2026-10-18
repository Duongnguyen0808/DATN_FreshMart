import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { changeStoreStatus, changeWarehouseStatus, createStore, createWarehouse, getStore, idInput, listStores, listWarehouses, statusInput, storeInput, storeListInput, storeUpdate, updateStore, updateWarehouse, warehouseInput, warehouseListInput, warehouseUpdate } from './organization.service.js';

export const organizationRoutes = Router();
organizationRoutes.use(authenticate);
organizationRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
const ok = (data: unknown) => ({ success: true, message: 'Success', data });
organizationRoutes.get('/stores', requirePermission('stores.read'), async (req, res) => res.json(ok(await listStores(req.currentUser, storeListInput.parse(req.query)))));
organizationRoutes.get('/stores/:id', requirePermission('stores.read'), async (req, res) => res.json(ok(await getStore(req.currentUser, idInput.parse(req.params.id)))));
organizationRoutes.post('/stores', requirePermission('stores.manage'), async (req, res) => res.status(201).json(ok(await createStore(req.currentUser, storeInput.parse(req.body)))));
organizationRoutes.put('/stores/:id', requirePermission('stores.manage'), async (req, res) => res.json(ok(await updateStore(req.currentUser, idInput.parse(req.params.id), storeUpdate.parse(req.body)))));
organizationRoutes.patch('/stores/:id/status', requirePermission('stores.manage'), async (req, res) => res.json(ok(await changeStoreStatus(req.currentUser, idInput.parse(req.params.id), statusInput.parse(req.body).active))));
organizationRoutes.get('/warehouses', requirePermission('warehouses.read'), async (req, res) => res.json(ok(await listWarehouses(req.currentUser, warehouseListInput.parse(req.query)))));
organizationRoutes.post('/warehouses', requirePermission('warehouses.manage'), async (req, res) => res.status(201).json(ok(await createWarehouse(req.currentUser, warehouseInput.parse(req.body)))));
organizationRoutes.put('/warehouses/:id', requirePermission('warehouses.manage'), async (req, res) => res.json(ok(await updateWarehouse(req.currentUser, idInput.parse(req.params.id), warehouseUpdate.parse(req.body)))));
organizationRoutes.patch('/warehouses/:id/status', requirePermission('warehouses.manage'), async (req, res) => res.json(ok(await changeWarehouseStatus(req.currentUser, idInput.parse(req.params.id), statusInput.parse(req.body).active))));
