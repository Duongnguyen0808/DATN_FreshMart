import { z } from 'zod';

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có định dạng YYYY-MM-DD.').refine(value => {
  const [year, month, day] = value.split('-').map(Number); const date = new Date(year!, month! - 1, day!);
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day;
}, 'Ngày không hợp lệ.');

export const revenueReportInput = z.object({
  from: dateText.optional(),
  to: dateText.optional(),
  storeId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (!value.from || !value.to) return;
  const from = new Date(`${value.from}T00:00:00`);
  const to = new Date(`${value.to}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) context.addIssue({ code: 'custom', path: ['to'], message: 'Khoảng thời gian không hợp lệ.' });
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > 366) context.addIssue({ code: 'custom', path: ['to'], message: 'Chỉ hỗ trợ báo cáo tối đa 366 ngày.' });
});

export const inventoryReportInput = z.object({
  q: z.string().trim().max(100).optional(),
  storeId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  status: z.enum(['all', 'NORMAL', 'LOW', 'OUT', 'HIGH', 'SHORTAGE']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const debtReportInput = z.object({
  q: z.string().trim().max(100).optional(),
  storeId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  timing: z.enum(['all', 'CURRENT', 'DUE_SOON', 'OVERDUE', 'PAID']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const productPerformanceInput = z.object({
  from: dateText.optional(),
  to: dateText.optional(),
  q: z.string().trim().max(100).optional(),
  storeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  status: z.enum(['all', 'TOP_SELLING', 'SLOW_MOVING', 'NO_SALES', 'HIGH_STOCK']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().superRefine((value, context) => {
  if (!value.from || !value.to) return;
  const from = new Date(`${value.from}T00:00:00`); const to = new Date(`${value.to}T00:00:00`);
  if (from > to) context.addIssue({ code: 'custom', path: ['to'], message: 'Khoảng thời gian không hợp lệ.' });
  if (Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1 > 366) context.addIssue({ code: 'custom', path: ['to'], message: 'Chỉ hỗ trợ báo cáo tối đa 366 ngày.' });
});

export const branchComparisonInput = z.object({
  from: dateText.optional(),
  to: dateText.optional(),
  categoryId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (!value.from || !value.to) return;
  const from = new Date(`${value.from}T00:00:00`); const to = new Date(`${value.to}T00:00:00`);
  if (from > to) context.addIssue({ code: 'custom', path: ['to'], message: 'Khoảng thời gian không hợp lệ.' });
  if (Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1 > 366) context.addIssue({ code: 'custom', path: ['to'], message: 'Chỉ hỗ trợ báo cáo tối đa 366 ngày.' });
});
