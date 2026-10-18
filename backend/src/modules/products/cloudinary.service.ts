import { createHash } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import { env } from '../../config/env.js';

const folder = 'smart-store/products';

function config() {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new AppError(503, 'IMAGE_SERVICE_UNAVAILABLE', 'Dịch vụ lưu ảnh chưa được cấu hình.');
  }
  return { cloud: env.CLOUDINARY_CLOUD_NAME, key: env.CLOUDINARY_API_KEY, secret: env.CLOUDINARY_API_SECRET };
}

function signature(parameters: Record<string, string>, secret: string) {
  const value = Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${key}=${item}`).join('&');
  return createHash('sha1').update(value + secret).digest('hex');
}

export function validateProductImage(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp|avif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new AppError(400, 'INVALID_PRODUCT_IMAGE', 'Ảnh phải có định dạng JPG, PNG, WEBP hoặc AVIF.');
  const size = Math.floor(match[2].length * 3 / 4) - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
  if (size > 5 * 1024 * 1024) throw new AppError(413, 'PRODUCT_IMAGE_TOO_LARGE', 'Ảnh sản phẩm không được vượt quá 5 MB.');
}

export async function uploadProductImage(dataUrl: string) {
  validateProductImage(dataUrl);
  const { cloud, key, secret } = config();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const parameters = { folder, timestamp };
  const body = new FormData();
  body.set('file', dataUrl);
  body.set('api_key', key);
  body.set('timestamp', timestamp);
  body.set('folder', folder);
  body.set('signature', signature(parameters, secret));
  let response: Response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new AppError(504, 'IMAGE_UPLOAD_TIMEOUT', 'Cloudinary phản hồi quá chậm. Kiểm tra kết nối rồi thử lại; sản phẩm chưa được lưu.');
  }
  const result = await response.json() as { secure_url?: string; public_id?: string; error?: { message?: string } };
  if (!response.ok || !result.secure_url || !result.public_id) {
    throw new AppError(502, 'IMAGE_UPLOAD_FAILED', result.error?.message || 'Không thể tải ảnh sản phẩm lên Cloudinary.');
  }
  return { imageUrl: result.secure_url, imagePublicId: result.public_id };
}

export async function uploadOperationalEvidence(dataUrl: string) {
  validateProductImage(dataUrl);
  const { cloud, key, secret } = config();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const evidenceFolder = 'smart-store/operation-evidence';
  const parameters = { folder: evidenceFolder, timestamp };
  const body = new FormData();
  body.set('file', dataUrl);
  body.set('api_key', key);
  body.set('timestamp', timestamp);
  body.set('folder', evidenceFolder);
  body.set('signature', signature(parameters, secret));
  let response: Response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new AppError(504, 'EVIDENCE_UPLOAD_TIMEOUT', 'Không tải được ảnh chứng từ; phiếu chưa được xác nhận.');
  }
  const result = await response.json() as { secure_url?: string; error?: { message?: string } };
  if (!response.ok || !result.secure_url) throw new AppError(502, 'EVIDENCE_UPLOAD_FAILED', result.error?.message || 'Không thể lưu ảnh chứng từ.');
  return result.secure_url;
}

export async function destroyProductImage(publicId: string) {
  const { cloud, key, secret } = config();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const parameters = { public_id: publicId, timestamp };
  const body = new FormData();
  body.set('public_id', publicId);
  body.set('api_key', key);
  body.set('timestamp', timestamp);
  body.set('signature', signature(parameters, secret));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, { method: 'POST', body, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new AppError(502, 'IMAGE_DELETE_FAILED', 'Không thể xóa ảnh cũ trên Cloudinary.');
}
