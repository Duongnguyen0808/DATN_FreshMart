import 'dotenv/config';
import { z } from 'zod';
import { prisma } from './common/database.js';
import { hashPassword } from './modules/auth/password.js';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is for local development only');
  const email = z.string().email().parse(process.env.SEED_CASHIER_EMAIL).toLowerCase();
  const passwordHash = await hashPassword(z.string().min(10).max(128).parse(process.env.SEED_CASHIER_PASSWORD));
  await prisma.$transaction(async tx => {
    const role = await tx.role.findUniqueOrThrow({ where: { code: 'EMPLOYEE' }, include: { permissions: true } });
    const expectedPermissions = ['shifts.manage', 'shifts.read', 'invoices.create', 'stores.read', 'warehouses.read', 'products.read'];
    if (!expectedPermissions.every(code => role.permissions.some(item => item.permissionCode === code))) {
      throw new Error('EMPLOYEE permissions have been customized; demo seed will not change them');
    }
    const store = await tx.store.findFirstOrThrow({ where: { code: 'CN001', active: true } });
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) { console.log('Demo account already exists; credentials and assignments preserved.'); return; }
    const user = await tx.user.create({ data: {
      email, name: 'Thu ngân kiểm thử', passwordHash,
      roles: { create: { roleId: role.id } }, stores: { create: { storeId: store.id } },
    } });
    await tx.auditLog.create({ data: { action: 'demo.cashier.create', targetId: user.id } });
    console.log('Employee demo created for CN001. Credentials are in backend/.env.');
  });
}
main().catch(error => { console.error(error instanceof z.ZodError ? 'Invalid demo seed environment.' : error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
