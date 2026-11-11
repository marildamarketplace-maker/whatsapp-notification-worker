import { loadConfig } from '../src/config/env.js';
import { createPrisma } from '../src/database/prisma.js';
const config = loadConfig();
const db = createPrisma(config.DATABASE_URL,config.NODE_ENV!=='test',config.PG_CA_FILE);
try {
  await db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const enums = await tx.$queryRaw`SELECT t.typname,e.enumlabel FROM pg_type t
      JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typname IN ('NotificationType','NotificationStatus') ORDER BY t.typname,e.enumsortorder`;
    const columns = await tx.$queryRaw`SELECT column_name,data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='notification' ORDER BY ordinal_position`;
    const counts = await tx.$queryRaw`SELECT tipo,status,count(*)::int FROM public.notification GROUP BY tipo,status`;
    console.log(JSON.stringify({enums,columns,counts},null,2));
  });
} catch { console.error('Leitura falhou; detalhes sensíveis omitidos.'); process.exitCode=1; }
finally {await db.$disconnect();}
