import { PayOS } from '@payos/node';
import { env } from '../../config/env.js';
import { AppError } from '../../common/app-error.js';

export const payosConfigured = () => Boolean(env.PAYOS_CLIENT_ID?.trim() && env.PAYOS_API_KEY?.trim() && env.PAYOS_CHECKSUM_KEY?.trim());
let client: PayOS | undefined;
export function payosClient() {
  if (!payosConfigured()) throw new AppError(503, 'PAYOS_NOT_CONFIGURED', 'Chưa cấu hình kênh thanh toán payOS.');
  return client ??= new PayOS({ clientId: env.PAYOS_CLIENT_ID, apiKey: env.PAYOS_API_KEY, checksumKey: env.PAYOS_CHECKSUM_KEY, timeout: 15000, maxRetries: 0, logLevel: 'off' });
}
