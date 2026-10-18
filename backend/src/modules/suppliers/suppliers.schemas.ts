import { z } from 'zod';
export const supplierIdInput=z.string().uuid();
export const supplierListInput=z.object({q:z.string().trim().max(100).optional(),active:z.enum(['true','false','all']).default('all'),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict();
const supplierFields={name:z.string().trim().min(2).max(200),contactName:z.string().trim().min(2).max(120),phone:z.string().trim().min(8).max(30),email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),address:z.string().trim().min(3).max(300),currentDebt:z.coerce.number().min(0).max(999_999_999_999.99)};
export const createSupplierInput=z.object({code:z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/).transform(v=>v.toUpperCase()),...supplierFields}).strict();
export const updateSupplierInput=z.object(supplierFields).strict();
export const supplierStatusInput=z.object({active:z.boolean()}).strict();
