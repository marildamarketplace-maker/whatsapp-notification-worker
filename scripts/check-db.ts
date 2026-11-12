import { loadConfig } from '../src/config/env.js';
import { createPrisma } from '../src/database/prisma.js';
const config = loadConfig();
const db = createPrisma(config.DATABASE_URL,config.NODE_ENV!=='test',config.PG_CA_FILE);
let stage = 'connection';
try {
  await db.$queryRaw`SELECT 1`;
  await db.$transaction(async tx => {
    stage = 'read_only_transaction';
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    stage = 'enums';
    // Catalog identifiers use PostgreSQL's name type; expose portable text values.
    const enums = await tx.$queryRaw`SELECT t.typname::text,e.enumlabel::text FROM pg_type t
      JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typname IN ('NotificationType','NotificationStatus') ORDER BY t.typname,e.enumsortorder`;
    stage = 'columns';
    const columns = await tx.$queryRaw`SELECT column_name::text,data_type::text FROM information_schema.columns
      WHERE table_schema='public' AND table_name='notification' ORDER BY ordinal_position`;
    stage = 'notification_read';
    const counts = await tx.$queryRaw`SELECT tipo::text,status::text,count(*)::int FROM public.notification GROUP BY tipo,status`;
    console.log(JSON.stringify({enums,columns,counts},null,2));
  });
} catch (error) {
  const codes = new Set<string>();
  const seen = new Set<object>();
  let certificateError = false;
  function inspect(value: unknown, depth = 0): void {
    if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string,unknown>;
    for (const key of ['code','originalCode','sqlState']) {
      const code = record[key];
      if (typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code)) codes.add(code);
    }
    if (typeof record.message === 'string' && /certificate|self.signed/i.test(record.message)) certificateError = true;
    for (const key of ['cause','meta','driverAdapterError']) inspect(record[key],depth+1);
    if (Array.isArray(record.errors)) for (const nested of record.errors) inspect(nested,depth+1);
  }
  inspect(error);
  // Never print error messages, SQL parameters, URLs, or credentials.
  console.error(JSON.stringify({ok:false,stage,codes:[...codes],certificateError,caConfigured:Boolean(config.PG_CA_FILE)}));
  process.exitCode=1;
}
finally {await db.$disconnect();}
