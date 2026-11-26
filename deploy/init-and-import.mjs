import sql from 'mssql';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const dbUrl = process.env.DATABASE_URL || '';
const raw = dbUrl.replace(/^sqlserver:\/\//, '');
const parts = raw.split(';').filter(Boolean);
const hostPort = parts[0];
const [server, portStr] = hostPort.includes(':') ? hostPort.split(':') : [hostPort, '1433'];
const kv = {};
for (const p of parts.slice(1)) {
  const eq = p.indexOf('=');
  if (eq > 0) kv[p.slice(0, eq).toLowerCase()] = p.slice(eq + 1);
}

const targetDb = kv.database || 'smart_store';
const baseConfig = {
  server,
  port: Number(portStr),
  user: kv.user,
  password: kv.password,
  requestTimeout: 120000,
  connectionTimeout: 30000,
  options: {
    encrypt: kv.encrypt === 'true',
    trustServerCertificate: kv.trustservercertificate !== 'false',
  },
};

console.log(`[init-db] Connecting to SQL Server ${server}:${portStr}...`);
const masterPool = await sql.connect({ ...baseConfig, database: 'master' });
await masterPool.request().query(`
  IF DB_ID(N'${targetDb.replace(/'/g, "''")}') IS NULL
  BEGIN
    CREATE DATABASE [${targetDb}];
  END
`);
await masterPool.close();

const pool = await sql.connect({ ...baseConfig, database: targetDb });
const tableCheck = await pool.request().query(`
  SELECT COUNT(*) AS cnt FROM sys.tables WHERE is_ms_shipped = 0 AND name = 'users'
`);

if (tableCheck.recordset[0].cnt === 0) {
  console.log('[init-db] Schema not found. Pushing Prisma schema...');
  execSync('npx prisma db push', { cwd: '/app/backend', stdio: 'inherit', env: process.env });
}

// Convert any single-column UNIQUE CONSTRAINT on a NULLABLE column into a filtered UNIQUE INDEX (WHERE [col] IS NOT NULL),
// matching Prisma migration behavior on SQL Server where multiple NULLs are allowed on optional @unique fields.
const nullableUqs = await pool.request().query(`
  SELECT
    OBJECT_NAME(kc.parent_object_id) AS tbl,
    kc.name AS uq_name,
    COL_NAME(ic.object_id, ic.column_id) AS col_name
  FROM sys.key_constraints kc
  JOIN sys.index_columns ic
    ON kc.parent_object_id = ic.object_id AND kc.unique_index_id = ic.index_id
  JOIN sys.columns c
    ON ic.object_id = c.object_id AND ic.column_id = c.column_id
  WHERE kc.type = 'UQ'
    AND c.is_nullable = 1
    AND (
      SELECT COUNT(*) FROM sys.index_columns ic2
      WHERE ic2.object_id = kc.parent_object_id AND ic2.index_id = kc.unique_index_id
    ) = 1
`);

for (const row of nullableUqs.recordset) {
  console.log(`[init-db] Converting nullable unique constraint ${row.tbl}.${row.uq_name} (${row.col_name}) to filtered unique index...`);
  await pool.request().query(`
    ALTER TABLE dbo.[${row.tbl}] DROP CONSTRAINT [${row.uq_name}];
    CREATE UNIQUE NONCLUSTERED INDEX [${row.uq_name}] ON dbo.[${row.tbl}]([${row.col_name}]) WHERE [${row.col_name}] IS NOT NULL;
  `);
}

const userCountRes = await pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.[users]`);
const existingUsers = userCountRes.recordset[0].cnt;
const snapshotPath = '/app/deploy/db-snapshot.json.gz';

if (existingUsers === 0 && fs.existsSync(snapshotPath)) {
  console.log('[init-db] Importing database snapshot from db-snapshot.json.gz...');
  const rawJson = zlib.gunzipSync(fs.readFileSync(snapshotPath)).toString('utf8');
  const dump = JSON.parse(rawJson);

  await pool.request().query(`EXEC sp_MSforeachtable "ALTER TABLE ? NOCHECK CONSTRAINT all"`);

  const targetTablesRes = await pool.request().query(`
    SELECT name FROM sys.tables WHERE is_ms_shipped = 0
  `);
  const existingTableSet = new Set(targetTablesRes.recordset.map(r => r.name));

  // Clean any partial rows from interrupted prior attempts
  for (const tbl of existingTableSet) {
    if (tbl === '_prisma_migrations') continue;
    await pool.request().query(`DELETE FROM dbo.[${tbl}]`);
  }

  let importedRows = 0;
  for (const [tableName, payload] of Object.entries(dump)) {
    if (tableName === '_prisma_migrations' || !existingTableSet.has(tableName)) continue;
    const { columns, rows } = payload;
    if (!rows || rows.length === 0) continue;

    const actualColsRes = await pool.request()
      .input('tbl', sql.NVarChar, tableName)
      .query(`
        SELECT c.name, c.is_identity, c.is_computed
        FROM sys.columns c
        WHERE c.object_id = OBJECT_ID('dbo.[' + @tbl + ']')
      `);
    const actualMap = new Map(actualColsRes.recordset.filter(c => !c.is_computed).map(c => [c.name, c]));
    const validCols = columns.filter(c => actualMap.has(c.name));
    if (validCols.length === 0) continue;

    const hasIdentity = validCols.some(c => actualMap.get(c.name)?.is_identity);
    const colSql = validCols.map(c => `[${c.name}]`).join(', ');
    const batchSize = Math.max(1, Math.min(50, Math.floor(1800 / validCols.length)));

    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);
      const req = pool.request();
      const valueTuples = [];
      let paramIdx = 0;

      for (const row of slice) {
        const placeholders = [];
        for (const col of validCols) {
          const pName = `p${paramIdx++}`;
          let val = row[col.name];
          if (val && typeof val === 'object') {
            if ('__buf' in val) val = Buffer.from(val.__buf, 'base64');
            else if ('__date' in val) val = new Date(val.__date);
            else if ('__bigint' in val) val = BigInt(val.__bigint);
          }
          req.input(pName, val === undefined ? null : val);
          placeholders.push(`@${pName}`);
        }
        valueTuples.push(`(${placeholders.join(', ')})`);
      }

      const prefix = hasIdentity ? `SET IDENTITY_INSERT dbo.[${tableName}] ON;\n` : '';
      const suffix = hasIdentity ? `\nSET IDENTITY_INSERT dbo.[${tableName}] OFF;` : '';
      await req.query(`${prefix}INSERT INTO dbo.[${tableName}] (${colSql}) VALUES ${valueTuples.join(', ')};${suffix}`);
      importedRows += slice.length;
    }
    console.log(`[init-db]   -> ${tableName}: ${rows.length} rows`);
  }

  await pool.request().query(`EXEC sp_MSforeachtable "ALTER TABLE ? WITH CHECK CHECK CONSTRAINT all"`);
  console.log(`[init-db] Snapshot import complete (${importedRows} total rows).`);
} else {
  console.log(`[init-db] Database already initialized (${existingUsers} users). Skipping snapshot import.`);
}

// Ensure Vietnamese accent-insensitive collation (Latin1_General_100_CI_AI) on all searchable text columns
// so unaccented queries like "banh", "sua", "dau", "nuoc mam", "quan 1" match accented Vietnamese text across Web & Mobile.
const prodColCheck = await pool.request().query(`
  SELECT collation_name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.products') AND name = 'name'
`);
if (prodColCheck.recordset[0]?.collation_name !== 'Latin1_General_100_CI_AI') {
  console.log('[init-db] Upgrading searchable NVARCHAR columns to Latin1_General_100_CI_AI (accent-insensitive Vietnamese search)...');
  await pool.request().query(`
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.products') AND name = 'products_name_idx')
      DROP INDEX [products_name_idx] ON dbo.[products];
    ALTER TABLE dbo.[products] ALTER COLUMN [name] NVARCHAR(191) COLLATE Latin1_General_100_CI_AI NOT NULL;
    CREATE NONCLUSTERED INDEX [products_name_idx] ON dbo.[products]([name]);

    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID('dbo.categories') AND name = 'categories_name_key')
      ALTER TABLE dbo.[categories] DROP CONSTRAINT [categories_name_key];
    ALTER TABLE dbo.[categories] ALTER COLUMN [name] NVARCHAR(191) COLLATE Latin1_General_100_CI_AI NOT NULL;
    ALTER TABLE dbo.[categories] ADD CONSTRAINT [categories_name_key] UNIQUE ([name]);

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.customers') AND name = 'customers_name_idx')
      DROP INDEX [customers_name_idx] ON dbo.[customers];
    ALTER TABLE dbo.[customers] ALTER COLUMN [name] NVARCHAR(191) COLLATE Latin1_General_100_CI_AI NOT NULL;
    CREATE NONCLUSTERED INDEX [customers_name_idx] ON dbo.[customers]([name]);

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.suppliers') AND name = 'suppliers_name_idx')
      DROP INDEX [suppliers_name_idx] ON dbo.[suppliers];
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.suppliers') AND name = 'suppliers_active_name_idx')
      DROP INDEX [suppliers_active_name_idx] ON dbo.[suppliers];
    ALTER TABLE dbo.[suppliers] ALTER COLUMN [name] NVARCHAR(191) COLLATE Latin1_General_100_CI_AI NOT NULL;
    CREATE NONCLUSTERED INDEX [suppliers_name_idx] ON dbo.[suppliers]([name]);
    CREATE NONCLUSTERED INDEX [suppliers_active_name_idx] ON dbo.[suppliers]([active], [name]);

    ALTER TABLE dbo.[suppliers] ALTER COLUMN [contactName] NVARCHAR(191) COLLATE Latin1_General_100_CI_AI NOT NULL;
    ALTER TABLE dbo.[stores] ALTER COLUMN [name] NVARCHAR(191) COLLATE Latin1_General_100_CI_AI NOT NULL;
    ALTER TABLE dbo.[warehouses] ALTER COLUMN [name] NVARCHAR(191) COLLATE Latin1_General_100_CI_AI NOT NULL;
    ALTER TABLE dbo.[users] ALTER COLUMN [name] NVARCHAR(191) COLLATE Latin1_General_100_CI_AI NOT NULL;
    ALTER TABLE dbo.[invoices] ALTER COLUMN [customerName] NVARCHAR(191) COLLATE Latin1_General_100_CI_AI NULL;
    ALTER TABLE dbo.[invoice_items] ALTER COLUMN [productName] NVARCHAR(191) COLLATE Latin1_General_100_CI_AI NOT NULL;
  `);
  console.log('[init-db] Accent-insensitive collation upgrade complete.');
}

await pool.close();
