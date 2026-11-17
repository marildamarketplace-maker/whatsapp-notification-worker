import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
export function createPrisma(connectionString: string, production = true, caFile?: string, idleTimeoutMillis = 120000) {
  const url = new URL(connectionString);
  // Do not let URL options override certificate verification in node-postgres.
  for (const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat']) url.searchParams.delete(key);
  // Connection-string parameters override pg options; keep attribution deterministic.
  url.searchParams.set('application_name','whatsapp-notification-worker');
  const adapter = new PrismaPg({connectionString: url.toString(), max: 3,
    connectionTimeoutMillis: 10000, idleTimeoutMillis,
    statement_timeout: 10000, query_timeout: 12000,
    ssl: production ? {rejectUnauthorized:true, ...(caFile ? {ca:readFileSync(caFile,'utf8')} : {})} : false,
  });
  return new PrismaClient({adapter, log:[]});
}
