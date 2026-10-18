import 'dotenv/config';
import { prisma } from './common/database.js';
import { hashPassword } from './modules/auth/password.js';

const managerEmail = process.env.DEMO_MANAGER_EMAIL?.trim().toLowerCase();
const managerPassword = process.env.DEMO_MANAGER_PASSWORD;
const employeeEmail = process.env.DEMO_EMPLOYEE_EMAIL?.trim().toLowerCase();
const employeePassword = process.env.DEMO_EMPLOYEE_PASSWORD;

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo users can only be created in a development environment.');
  if (!managerEmail || !managerPassword || !employeeEmail || !employeePassword) {
    throw new Error('Configure DEMO_MANAGER_EMAIL/PASSWORD and DEMO_EMPLOYEE_EMAIL/PASSWORD in backend/.env.');
  }
  if (managerEmail === employeeEmail) throw new Error('Demo accounts must use different email addresses.');

  const [managerHash, employeeHash] = await Promise.all([hashPassword(managerPassword), hashPassword(employeePassword)]);
  await prisma.$transaction(async tx => {
    const [managerRole, employeeRole, store] = await Promise.all([
      tx.role.findUniqueOrThrow({ where: { code: 'BRANCH_MANAGER' } }),
      tx.role.findUniqueOrThrow({ where: { code: 'EMPLOYEE' } }),
      tx.store.findFirstOrThrow({ where: { code: 'CN001', active: true } }),
    ]);
    const accounts = [
      { email: managerEmail, name: 'Quản lý chi nhánh demo', passwordHash: managerHash, roleId: managerRole.id },
      { email: employeeEmail, name: 'Nhân viên demo', passwordHash: employeeHash, roleId: employeeRole.id },
    ];
    for (const account of accounts) {
      const user = await tx.user.upsert({
        where: { email: account.email },
        create: {
          email: account.email, name: account.name, passwordHash: account.passwordHash, active: true,
          roles: { create: { roleId: account.roleId } }, stores: { create: { storeId: store.id } },
        },
        update: { name: account.name, passwordHash: account.passwordHash, active: true },
      });
      await tx.userRole.deleteMany({ where: { userId: user.id } });
      await tx.userStore.deleteMany({ where: { userId: user.id } });
      await tx.userRole.create({ data: { userId: user.id, roleId: account.roleId } });
      await tx.userStore.create({ data: { userId: user.id, storeId: store.id } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      console.log(`Ready: ${account.email} (${account.roleId === managerRole.id ? 'BRANCH_MANAGER' : 'EMPLOYEE'}) at ${store.code}`);
    }
  });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
