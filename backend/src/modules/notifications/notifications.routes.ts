import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { listOperationalNotifications } from './notifications.service.js';

export const notificationRoutes = Router();
notificationRoutes.get('/notifications', authenticate, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ success: true, message: 'Success', data: await listOperationalNotifications(request.currentUser) });
});
