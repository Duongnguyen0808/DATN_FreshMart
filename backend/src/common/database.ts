import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
export const prisma = new PrismaClient({ adapter });
export async function checkDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
