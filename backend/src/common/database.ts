import { PrismaMssql } from '@prisma/adapter-mssql';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

const adapter = new PrismaMssql(env.DATABASE_URL);
export const prisma = new PrismaClient({ adapter });

export async function checkDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1 AS [ok]`;
}
