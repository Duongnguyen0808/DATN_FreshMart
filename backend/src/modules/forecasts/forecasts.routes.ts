import { Router } from 'express';
import { env } from '../../config/env.js';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/authenticate.js';
import { forecastHistoryInput, forecastInput } from './forecasts.schemas.js';
import { createForecast, getForecastById, getLatestForecast, getShortageAlerts, listForecastRuns } from './forecasts.service.js';
import { decideRecommendation, generateRecommendations, listRecommendations } from './recommendations.service.js';
import { recommendationDecisionInput, recommendationIdInput } from './recommendations.schemas.js';

export const forecastRoutes = Router();
// This router shares /api/v1 with administration and customer routes.
// Restrict its permission gate to forecasting endpoints only.
forecastRoutes.use(['/forecasts', '/recommendations'], authenticate, requirePermission('reports.read'));
forecastRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
forecastRoutes.get('/forecasts/experiment', async (_request, response) => {
  try {
    const upstream = await fetch(`${env.AI_SERVICE_URL}/ai/experiment`, { signal: AbortSignal.timeout(15000) });
    if (!upstream.ok) {
      return response.status(upstream.status === 404 ? 404 : 502).json({ success: false, message: upstream.status === 404 ? 'Chưa có báo cáo khảo sát. Chạy python train_ai.py trong ai-service.' : 'Không đọc được báo cáo AI.' });
    }
    return response.json({ success: true, message: 'Success', data: await upstream.json() });
  } catch {
    return response.status(503).json({ success: false, message: 'Chưa kết nối được AI Service. Vui lòng thử lại.' });
  }
});
forecastRoutes.get('/forecasts/demand', async (request, response) => response.json({ success: true, message: 'Success', data: await getLatestForecast(request.currentUser, forecastInput.parse(request.query)) }));
forecastRoutes.post('/forecasts/demand', async (request, response) => response.status(201).json({ success: true, message: 'Success', data: await createForecast(request.currentUser, forecastInput.parse(request.body)) }));
forecastRoutes.get('/forecasts/demand/runs', async (request, response) => response.json({ success: true, message: 'Success', data: await listForecastRuns(request.currentUser, forecastHistoryInput.parse(request.query)) }));
forecastRoutes.get('/forecasts/demand/:id', async (request, response) => response.json({ success: true, message: 'Success', data: await getForecastById(request.currentUser, z.string().uuid().parse(request.params.id)) }));
forecastRoutes.get('/forecasts/shortages', async (request, response) => response.json({ success: true, message: 'Success', data: await getShortageAlerts(request.currentUser, forecastInput.parse(request.query)) }));
forecastRoutes.get('/recommendations', async (request, response) => response.json({ success: true, message: 'Success', data: await listRecommendations(request.currentUser, forecastInput.parse(request.query)) }));
forecastRoutes.post('/recommendations/generate', async (request, response) => response.status(201).json({ success: true, message: 'Success', data: await generateRecommendations(request.currentUser, forecastInput.parse(request.body)) }));
forecastRoutes.post('/recommendations/:id/decision', async (request, response) => response.json({ success: true, message: 'Success', data: await decideRecommendation(request.currentUser, recommendationIdInput.parse(request.params.id), recommendationDecisionInput.parse(request.body)) }));
