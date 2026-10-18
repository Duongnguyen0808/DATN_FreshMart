import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { approveShift, closeShift, getShift, listShifts, listShiftStaff, openShift } from './shifts.service.js';
import { approveShiftInput, closeShiftInput, openShiftInput, shiftIdInput, shiftListInput, shiftStaffInput } from './shifts.schemas.js';

export const shiftRoutes = Router();
const ok = (data: unknown) => ({ success: true, message: 'Success', data });
shiftRoutes.use(authenticate);
shiftRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
shiftRoutes.get('/shift-staff', requirePermission('shifts.read'), async (request, response) => response.json(ok(await listShiftStaff(request.currentUser, shiftStaffInput.parse(request.query)))));
shiftRoutes.get('/shifts', requirePermission('shifts.read'), async (request, response) => response.json(ok(await listShifts(request.currentUser, shiftListInput.parse(request.query)))));
shiftRoutes.get('/shifts/:id', requirePermission('shifts.read'), async (request, response) => response.json(ok(await getShift(request.currentUser, shiftIdInput.parse(request.params.id)))));
shiftRoutes.post('/shifts', requirePermission('shifts.manage'), async (request, response) => response.status(201).json(ok(await openShift(request.currentUser, openShiftInput.parse(request.body)))));
shiftRoutes.post('/shifts/:id/close', requirePermission('shifts.manage'), async (request, response) => response.json(ok(await closeShift(request.currentUser, shiftIdInput.parse(request.params.id), closeShiftInput.parse(request.body)))));
shiftRoutes.post('/shifts/:id/approve', requirePermission('shifts.approve'), async (request, response) => response.json(ok(await approveShift(request.currentUser, shiftIdInput.parse(request.params.id), approveShiftInput.parse(request.body)))));
