import { Router } from 'express';
import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../common/app-error.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as service from './auth.service.js';

export const authRoutes = Router();
const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/v1/auth' };
const credentials = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(128), client: z.enum(['web', 'mobile']) }).strict();
const refreshInput = z.object({ client: z.enum(['web', 'mobile']), refreshToken: z.string().max(100).optional() }).strict();
authRoutes.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
authRoutes.use((request, _response, next) => {
  if (request.method !== 'GET' && request.headers.origin && !env.CORS_ORIGINS.split(',').map(v => v.trim()).includes(request.headers.origin)) {
    throw new AppError(403, 'INVALID_ORIGIN', 'Nguồn yêu cầu không được phép.');
  }
  next();
});
function sendSession(request: Request, response: Response, client: 'web' | 'mobile', result: Awaited<ReturnType<typeof service.login>>) {
  if (client === 'web') {
    // Browser sessions only use an HttpOnly refresh cookie, never browser storage.
    if (!request.headers.origin) throw new AppError(403, 'INVALID_ORIGIN', 'Thiếu origin của Web.');
    response.cookie('refreshToken', result.refreshToken, { ...cookieOptions, maxAge: service.sessionDays * 86400000 });
    response.json({ success: true, message: 'Success', data: { accessToken: result.accessToken, user: result.user } });
  } else response.json({ success: true, message: 'Success', data: result });
}
authRoutes.post('/login', rateLimit({ windowMs: 15 * 60000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { success: false, message: 'Thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.', code: 'RATE_LIMITED' },
}), async (request, response) => {
  const input = credentials.parse(request.body);
  if (input.client === 'web' && !request.headers.origin) throw new AppError(403, 'INVALID_ORIGIN', 'Thiếu origin của Web.');
  sendSession(request, response, input.client, await service.login(input.email, input.password));
});
authRoutes.post('/refresh', async (request, response) => {
  const input = refreshInput.parse(request.body);
  if (input.client === 'web' && !request.headers.origin) throw new AppError(403, 'INVALID_ORIGIN', 'Thiếu origin của Web.');
  const token = input.client === 'web' ? request.cookies.refreshToken : input.refreshToken;
  if (typeof token !== 'string') throw new AppError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập.');
  try { sendSession(request, response, input.client, await service.refresh(token)); }
  catch (error) {
    if (input.client === 'web' && error instanceof AppError && error.status === 401) {
      response.clearCookie('refreshToken', cookieOptions);
    }
    throw error;
  }
});
authRoutes.get('/me', authenticate, (request, response) => response.json({ success: true, message: 'Success', data: request.currentUser }));
authRoutes.post('/logout', authenticate, async (request, response) => {
  z.object({}).strict().parse(request.body ?? {});
  await service.logout(request.sessionId, request.currentUser.id);
  response.clearCookie('refreshToken', cookieOptions);
  response.json({ success: true, message: 'Đã đăng xuất.', data: null });
});
