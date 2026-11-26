import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { publishMobileOpsEvent } from '../iot/iot.realtime.js';
import {
  createIncidentReport,
  createQuickStocktake,
  getDailyChecklist,
  listIncidentReports,
  listPersonalActivities,
  listQuickStocktakes,
  logMobileActivity,
  reviewQuickStocktake,
  toggleChecklistItem,
  updateIncidentStatus,
} from './mobile-ops.service.js';

export const mobileOpsRoutes = Router();
const ok = (data: unknown) => ({ success: true, message: 'Success', data });

mobileOpsRoutes.use('/mobile-ops', authenticate);
mobileOpsRoutes.use('/mobile-ops', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal(''))
  .transform((v) => v || undefined);

// 1. Daily Operations Checklist
mobileOpsRoutes.get('/mobile-ops/checklist', requirePermission('inventory.read'), async (req, res) => {
  const q = z
    .object({
      storeId: optionalUuid,
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .parse(req.query);
  res.json(ok(await getDailyChecklist(req.currentUser, q.storeId, q.date)));
});

mobileOpsRoutes.patch('/mobile-ops/checklist/:id/toggle', requirePermission('inventory.read'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = z
    .object({
      completed: z.boolean(),
      note: z.string().trim().max(500).optional().nullable(),
    })
    .strict()
    .parse(req.body);
  const result = await toggleChecklistItem(req.currentUser, id, body.completed, body.note);
  publishMobileOpsEvent('ops:checklist', result, result.storeId);
  res.json(ok(result));
});

// 2. Quick Stocktaking (Never mutates inventory directly)
mobileOpsRoutes.get('/mobile-ops/quick-stocktakes', requirePermission('stocktakes.read'), async (req, res) => {
  const q = z
    .object({
      storeId: optionalUuid,
      status: z.enum(['ALL', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
      mineOnly: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
    })
    .parse(req.query);
  res.json(ok(await listQuickStocktakes(req.currentUser, q)));
});

mobileOpsRoutes.post('/mobile-ops/quick-stocktakes', requirePermission('stocktakes.create'), async (req, res) => {
  const body = z
    .object({
      storeId: optionalUuid,
      warehouseId: optionalUuid,
      barcode: z.string().trim().min(1).max(120),
      actualQuantity: z.coerce.number().int().min(0).max(1_000_000),
      note: z.string().trim().max(500).optional().nullable(),
    })
    .strict()
    .parse(req.body);
  const result = await createQuickStocktake(req.currentUser, body);
  publishMobileOpsEvent('ops:stocktake', result, result.warehouseId);
  res.status(201).json(ok(result));
});

mobileOpsRoutes.patch(
  '/mobile-ops/quick-stocktakes/:id/review',
  requirePermission('stocktakes.approve'),
  async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        status: z.enum(['APPROVED', 'REJECTED']),
        reviewNote: z.string().trim().max(500).optional().nullable(),
      })
      .strict()
      .parse(req.body);
    const result = await reviewQuickStocktake(req.currentUser, id, body.status, body.reviewNote);
    publishMobileOpsEvent('ops:stocktake', result, result.warehouseId);
    res.json(ok(result));
  }
);

// 3. Incident Reports
mobileOpsRoutes.get('/mobile-ops/incidents', requirePermission('inventory.read'), async (req, res) => {
  const q = z
    .object({
      storeId: optionalUuid,
      status: z.enum(['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED']).optional(),
      type: z.enum(['ALL', 'DAMAGED', 'EXPIRED', 'STOCK_MISMATCH', 'IOT_DEVICE']).optional(),
      mineOnly: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
    })
    .parse(req.query);
  res.json(ok(await listIncidentReports(req.currentUser, q)));
});

mobileOpsRoutes.post('/mobile-ops/incidents', requirePermission('inventory.read'), async (req, res) => {
  const body = z
    .object({
      storeId: optionalUuid,
      warehouseId: optionalUuid,
      type: z.enum(['DAMAGED', 'EXPIRED', 'STOCK_MISMATCH', 'IOT_DEVICE']),
      title: z.string().trim().min(3).max(200),
      description: z.string().trim().min(3).max(2000),
      relatedCode: z.string().trim().max(120).optional().nullable(),
      relatedName: z.string().trim().max(200).optional().nullable(),
      imageUrl: z.string().max(10_000_000).optional().nullable(),
    })
    .strict()
    .parse(req.body);
  const result = await createIncidentReport(req.currentUser, body);
  publishMobileOpsEvent('ops:incident', result, result.warehouseId);
  res.status(201).json(ok(result));
});

mobileOpsRoutes.patch('/mobile-ops/incidents/:id/status', requirePermission('inventory.read'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = z
    .object({
      status: z.enum(['IN_PROGRESS', 'RESOLVED']),
      resolutionNote: z.string().trim().max(1000).optional().nullable(),
    })
    .strict()
    .parse(req.body);
  const result = await updateIncidentStatus(req.currentUser, id, body.status, body.resolutionNote);
  publishMobileOpsEvent('ops:incident', result, result.warehouseId);
  res.json(ok(result));
});

// 4. Personal Activity History
mobileOpsRoutes.get('/mobile-ops/activities', async (req, res) => {
  const q = z
    .object({
      range: z.enum(['today', '7d', '30d', 'all']).default('7d'),
    })
    .parse(req.query);
  res.json(ok(await listPersonalActivities(req.currentUser, q.range)));
});

mobileOpsRoutes.post('/mobile-ops/activities', async (req, res) => {
  const body = z
    .object({
      storeId: optionalUuid,
      activityType: z.enum(['BARCODE_SCAN', 'CHECKLIST_DONE', 'STOCKTAKE_SUBMIT', 'INCIDENT_REPORT']),
      title: z.string().trim().min(1).max(200),
      detail: z.string().trim().max(500).optional().nullable(),
      targetCode: z.string().trim().max(120).optional().nullable(),
    })
    .strict()
    .parse(req.body);
  res.status(201).json(ok(await logMobileActivity(req.currentUser, body)));
});
