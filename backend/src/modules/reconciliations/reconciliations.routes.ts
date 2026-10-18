import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { reconciliationListInput } from './reconciliations.schemas.js';
import { listReconciliations } from './reconciliations.service.js';

export const reconciliationRoutes = Router();
reconciliationRoutes.use(authenticate);
reconciliationRoutes.get('/reconciliations/debt', requirePermission('reports.read'), async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ success: true, message: 'Success', data: await listReconciliations(request.currentUser, reconciliationListInput.parse(request.query)) });
});
