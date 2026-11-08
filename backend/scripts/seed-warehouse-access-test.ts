// Invoked only by test-integration.mjs against freshmart_warehouse_access_test.
import { prisma } from '../src/common/database.js';

if (new URL(process.env.DATABASE_URL!).pathname !== '/freshmart_warehouse_access_test') throw new Error('Refusing to seed outside the dedicated warehouse access test database');
const store = await prisma.store.upsert({ where: { code: 'ACCESS-TEST' }, update: { active: true }, create: { code: 'ACCESS-TEST', name: 'Chi nhánh kiểm thử' } });
await prisma.warehouse.upsert({ where: { code: 'ACCESS-TEST' }, update: { active: true, storeId: store.id }, create: { code: 'ACCESS-TEST', name: 'Kho kiểm thử', storeId: store.id } });
await prisma.permission.upsert({ where: { code: 'inventory.read' }, update: {}, create: { code: 'inventory.read', name: 'Xem tồn kho' } });
const role = await prisma.role.upsert({ where: { code: 'ACCESS_TEST' }, update: {}, create: { code: 'ACCESS_TEST', name: 'Nhân viên kiểm thử' } });
await prisma.rolePermission.upsert({ where: { roleId_permissionCode: { roleId: role.id, permissionCode: 'inventory.read' } }, update: {}, create: { roleId: role.id, permissionCode: 'inventory.read' } });
const employee = await prisma.user.upsert({ where: { email: 'access-test@example.invalid' }, update: { active: true }, create: { email: 'access-test@example.invalid', name: 'Nhân viên kiểm thử', passwordHash: 'not-a-login' } });
await prisma.userRole.upsert({ where: { userId_roleId: { userId: employee.id, roleId: role.id } }, update: {}, create: { userId: employee.id, roleId: role.id } });
await prisma.userStore.upsert({ where: { userId_storeId: { userId: employee.id, storeId: store.id } }, update: {}, create: { userId: employee.id, storeId: store.id } });
await prisma.$disconnect();
