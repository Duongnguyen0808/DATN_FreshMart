import type { RequestHandler } from 'express';
import { authenticateToken } from '../modules/auth/auth.service.js';
import type { CurrentUser } from '../modules/auth/auth.repository.js';
import { AppError } from '../common/app-error.js';

declare global { namespace Express { interface Request { currentUser: CurrentUser; sessionId: string } } }
export const authenticate: RequestHandler = async (request, _response, next) => {
  const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
  if (!match) throw new AppError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập.');
  const result = await authenticateToken(match[1]!);
  request.currentUser = result.user;
  request.sessionId = result.sessionId;
  next();
};
export const requirePermission = (permission: string): RequestHandler => (request, _response, next) => {
  if (!request.currentUser.permissions.includes(permission)) throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
  next();
};
