import { checkDatabase, prisma } from './common/database.js';

try {
  await checkDatabase();
  console.log('SQL Server connection successful');
} catch {
  console.error('SQL Server connection failed. Check DATABASE_URL and database availability.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
