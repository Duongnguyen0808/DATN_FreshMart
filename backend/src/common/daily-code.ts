import type { Prisma } from '../generated/prisma/client.js';

/** Generates readable document IDs with a per-type, per-day increasing sequence. */
export async function nextDailyCode(
  tx: Prisma.TransactionClient,
  prefix: string,
  findExisting: (dayPrefix: string) => Promise<Array<{ code: string }>>,
  at = new Date(),
) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at).replaceAll('-', '');
  const dayPrefix = `${prefix}-${date}`;

  // Serialize only this document type and day inside the current transaction
  // using SQL Server's transaction-scoped application lock.
  await tx.$executeRaw`EXEC sp_getapplock @Resource = ${dayPrefix}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000`;
  const existing = await findExisting(dayPrefix);
  // Ignore legacy timestamp suffixes and continue only the new four-digit IDs.
  const current = existing.reduce((max, row) => {
    const suffix = row.code.slice(dayPrefix.length + 1);
    return /^\d{4}$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
  }, 0);
  return `${dayPrefix}-${String(current + 1).padStart(4, '0')}`;
}
