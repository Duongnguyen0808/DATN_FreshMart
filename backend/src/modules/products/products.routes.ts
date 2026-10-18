import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import {
  availabilityInput, barcodeInput, categoryInput, categoryListInput, categoryUpdate, changeCategoryStatus, changeProductStatus, changeSkuStatus, checkProductAvailability,
  createCategory, createProduct, createSku, findByBarcode, getNextProductCode, getProduct, idInput, listCategories, listInput, listProducts,
  productInput, productUpdate, skuCreateInput, skuUpdateInput, statusInput, updateCategory, updateProduct, updateSku,
} from './products.service.js';

export const productRoutes = Router();
productRoutes.use(authenticate);
productRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
const ok = (data: unknown) => ({ success: true, message: 'Success', data });

productRoutes.get('/categories', requirePermission('products.read'), async (request, response) => response.json(ok(await listCategories(categoryListInput.parse(request.query)))));
productRoutes.post('/categories', requirePermission('categories.manage'), async (request, response) => response.status(201).json(ok(await createCategory(request.currentUser, categoryInput.parse(request.body)))));
productRoutes.put('/categories/:id', requirePermission('categories.manage'), async (request, response) => response.json(ok(await updateCategory(request.currentUser, idInput.parse(request.params.id), categoryUpdate.parse(request.body)))));
productRoutes.patch('/categories/:id/status', requirePermission('categories.manage'), async (request, response) => response.json(ok(await changeCategoryStatus(request.currentUser, idInput.parse(request.params.id), statusInput.parse(request.body).active))));

productRoutes.get('/products/barcode/:barcode', requirePermission('products.read'), async (request, response) => response.json(ok(await findByBarcode(barcodeInput.parse(request.params.barcode)))));
productRoutes.get('/products/availability', requirePermission('products.read'), async (request, response) => response.json(ok(await checkProductAvailability(availabilityInput.parse(request.query)))));
productRoutes.get('/products/next-code', requirePermission('products.manage'), async (_request, response) => response.json(ok(await getNextProductCode())));
productRoutes.get('/products', requirePermission('products.read'), async (request, response) => response.json(ok(await listProducts(listInput.parse(request.query), request.currentUser))));
productRoutes.get('/products/:id', requirePermission('products.read'), async (request, response) => response.json(ok(await getProduct(idInput.parse(request.params.id)))));
productRoutes.post('/products', requirePermission('products.manage'), async (request, response) => response.status(201).json(ok(await createProduct(request.currentUser, productInput.parse(request.body)))));
productRoutes.put('/products/:id', requirePermission('products.manage'), async (request, response) => response.json(ok(await updateProduct(request.currentUser, idInput.parse(request.params.id), productUpdate.parse(request.body)))));
productRoutes.patch('/products/:id/status', requirePermission('products.manage'), async (request, response) => response.json(ok(await changeProductStatus(request.currentUser, idInput.parse(request.params.id), statusInput.parse(request.body).active))));
productRoutes.post('/products/:id/skus', requirePermission('products.manage'), async (request, response) => response.status(201).json(ok(await createSku(request.currentUser, idInput.parse(request.params.id), skuCreateInput.parse(request.body)))));
productRoutes.put('/products/:id/skus/:skuId', requirePermission('products.manage'), async (request, response) => response.json(ok(await updateSku(request.currentUser, idInput.parse(request.params.id), idInput.parse(request.params.skuId), skuUpdateInput.parse(request.body)))));
productRoutes.patch('/products/:id/skus/:skuId/status', requirePermission('products.manage'), async (request, response) => response.json(ok(await changeSkuStatus(request.currentUser, idInput.parse(request.params.id), idInput.parse(request.params.skuId), statusInput.parse(request.body).active))));
