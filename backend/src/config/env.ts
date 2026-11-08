import 'dotenv/config';
import { z } from 'zod';

export const env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().refine(value => /^postgres(ql)?:/.test(value)),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  IOT_INGEST_TOKEN: z.preprocess(value => value === '' ? undefined : value, z.string().min(32).optional()),
  ACCESS_WINDOW_SECONDS: z.coerce.number().int().min(2).max(120).default(10),
  MAX_DOOR_OPEN_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  WAREHOUSE_OPEN_HOUR: z.coerce.number().int().min(0).max(23).default(7),
  WAREHOUSE_CLOSE_HOUR: z.coerce.number().int().min(1).max(24).default(22),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
  AI_SERVICE_URL: z.string().url().default('http://127.0.0.1:8000'),
  PAYOS_CLIENT_ID: z.string().optional(),
  PAYOS_API_KEY: z.string().optional(),
  PAYOS_CHECKSUM_KEY: z.string().optional(),
  PAYOS_RETURN_URL: z.string().url().default('http://localhost:3000/thanh-toan/payos'),
  PAYOS_CANCEL_URL: z.string().url().default('http://localhost:3000/thanh-toan/payos'),
}).parse(process.env);
