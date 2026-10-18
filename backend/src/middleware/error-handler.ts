import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../common/logger.js';
import { AppError } from '../common/app-error.js';

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.status).json({ success: false, message: error.message, code: error.code });
    return;
  }
  if (error?.code === 'P2002' || error?.code === 'P2003' || error?.code === 'P2034') {
    response.status(409).json({ success: false, message: 'Dữ liệu trùng, đang được sử dụng hoặc vừa thay đổi. Vui lòng tải lại.', code: 'CONFLICT' });
    return;
  }
  if (error?.code === 'P2025') {
    response.status(404).json({ success: false, message: 'Không tìm thấy dữ liệu.', code: 'NOT_FOUND' });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({ success: false, message: 'Invalid input', code: 'VALIDATION_ERROR' });
    return;
  }
  if (error?.type === 'entity.parse.failed') {
    response.status(400).json({ success: false, message: 'Invalid JSON', code: 'INVALID_JSON' });
    return;
  }
  if (error?.type === 'entity.too.large') {
    response.status(413).json({ success: false, message: 'Request too large', code: 'PAYLOAD_TOO_LARGE' });
    return;
  }
  logger.error({ err: error }, 'Request failed');
  response.status(500).json({ success: false, message: 'Internal server error', code: 'INTERNAL_ERROR' });
};
