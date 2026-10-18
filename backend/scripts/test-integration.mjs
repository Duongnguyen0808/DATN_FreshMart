import 'dotenv/config';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Uses a dedicated test database; never resets the application database.
const url = new URL(process.env.DATABASE_URL);
const testFiles = { login: 'src/login.integration.test.ts', logout: 'src/logout.integration.test.ts', refresh: 'src/refresh.integration.test.ts', rbac: 'src/rbac.integration.test.ts', 'create-user': 'src/create-user.integration.test.ts', users: 'src/users.integration.test.ts', organization: 'src/organization.integration.test.ts', products: 'src/products.integration.test.ts', all: 'src/auth.integration.test.ts' };
const selection = process.argv[2] ?? 'all';
if (!(selection in testFiles)) throw new Error('Unknown test selection');
const testName = selection === 'users' ? 'smart_store_users_test' : selection === 'organization' ? 'smart_store_organization_test' : selection === 'products' ? 'smart_store_products_test' : 'smart_store_auth_test';
url.pathname = '/postgres';
url.search = '';
const client = new pg.Client({ connectionString: url.toString() });
try {
  await client.connect();
  if (!(await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [testName])).rowCount) {
    await client.query(`CREATE DATABASE "${testName}"`);
  }
} finally { await client.end(); }
url.pathname = `/${testName}`;
const env = { ...process.env, DATABASE_URL: url.toString(), TEST_DATABASE_URL: url.toString(), NODE_ENV: 'test', LOG_LEVEL: 'silent', JWT_SECRET: 'integration-test-secret-not-for-production-123456' };
try {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy'], { stdio: 'inherit', env });
  execFileSync(process.execPath, [fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url)), 'run', testFiles[selection]], { stdio: 'inherit', env });
} catch { process.exitCode = 1; }
