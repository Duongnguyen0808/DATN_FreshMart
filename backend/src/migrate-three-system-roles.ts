import 'dotenv/config';
import { prisma } from './common/database.js';
import { synchronizeSystemRoles } from './modules/auth/system-roles.js';

try {
  await prisma.$transaction(async tx => synchronizeSystemRoles(tx), { timeout: 30000 });
  const summary = await prisma.role.findMany({ orderBy: [{ system: 'desc' }, { code: 'asc' }], select: { code: true, name: true, system: true, _count: { select: { users: true } }, permissions: { select: { permissionCode: true } } } });
  console.log('Roles after synchronization:', JSON.stringify(summary.map(role => ({ code: role.code, name: role.name, system: role.system, users: role._count.users, permissions: role.permissions.length }))));
} catch (error) {
  console.error('Unable to synchronize system roles.', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
