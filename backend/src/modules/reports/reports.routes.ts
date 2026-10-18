import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { branchComparisonInput, debtReportInput, inventoryReportInput, productPerformanceInput, revenueReportInput } from './reports.schemas.js';
import { getBranchComparison, getDebtReport, getInventoryReport, getProductPerformance, getRevenueReport } from './reports.service.js';

export const reportRoutes = Router();
reportRoutes.use(authenticate);
reportRoutes.get('/reports/revenue', requirePermission('reports.read'), async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ success: true, message: 'Success', data: await getRevenueReport(request.currentUser, revenueReportInput.parse(request.query)) });
});
reportRoutes.get('/reports/inventory', requirePermission('reports.read'), async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ success: true, message: 'Success', data: await getInventoryReport(request.currentUser, inventoryReportInput.parse(request.query)) });
});
reportRoutes.get('/reports/debt', requirePermission('reports.read'), async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ success: true, message: 'Success', data: await getDebtReport(request.currentUser, debtReportInput.parse(request.query)) });
});
reportRoutes.get('/reports/products', requirePermission('reports.read'), async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ success: true, message: 'Success', data: await getProductPerformance(request.currentUser, productPerformanceInput.parse(request.query)) });
});
reportRoutes.get('/reports/branches', requirePermission('reports.read'), async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ success: true, message: 'Success', data: await getBranchComparison(request.currentUser, branchComparisonInput.parse(request.query)) });
});
