import { afterEach,it,expect,vi } from 'vitest';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { createPrisma } from '../src/database/prisma.js';

vi.mock('@prisma/adapter-pg',()=>({PrismaPg:vi.fn(class {})}));
vi.mock('@prisma/client',()=>({PrismaClient:vi.fn(class {})}));
afterEach(()=>vi.clearAllMocks());

it('keeps pooled connections idle for two minutes by default',()=>{
 createPrisma('postgresql://test:local@localhost/worker_test',false);
 expect(PrismaPg).toHaveBeenCalledWith(expect.objectContaining({idleTimeoutMillis:120000,max:3,ssl:false}));
});
it('passes a configured pool timeout without changing query and connection deadlines',()=>{
 createPrisma('postgresql://test:local@localhost/worker_test',false,undefined,360000);
 expect(PrismaPg).toHaveBeenCalledWith(expect.objectContaining({idleTimeoutMillis:360000,
  connectionTimeoutMillis:10000,statement_timeout:10000,query_timeout:12000}));
});
it('identifies the worker through the actual pg parser and preserves verified TLS',()=>{
 createPrisma('postgresql://test:local@localhost/worker_test?application_name=old-app&sslmode=disable');
 const options=vi.mocked(PrismaPg).mock.calls[0]![0] as pg.PoolConfig;
 // Client construction parses options but opens no socket until connect().
 const parameters=Reflect.get(new pg.Client(options),'connectionParameters') as {
  application_name:string;ssl:{rejectUnauthorized:boolean};
 };
 expect(parameters.application_name).toBe('whatsapp-notification-worker');
 expect(parameters.ssl.rejectUnauthorized).toBe(true);
});
