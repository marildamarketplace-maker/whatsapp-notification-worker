import { randomUUID } from 'node:crypto';
import { beforeAll,beforeEach,afterAll,it,expect } from 'vitest';
import pg from 'pg';
import { createPrisma } from '../src/database/prisma.js';
import { PostgresNotificationRepository } from '../src/repositories/notification.repository.js';

const connectionString=process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL é obrigatório; use o PostgreSQL de testes local.');
const url=new URL(connectionString);
if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname!=='/worker_test' || url.username!=='worker_test')
 throw new Error('Testes destrutivos permitidos somente em worker_test@localhost/worker_test. Nunca use produção.');
const admin=new pg.Pool({connectionString,ssl:false});
const db=createPrisma(connectionString,false);
const secondDb=createPrisma(connectionString,false);
const repository=new PostgresNotificationRepository(db);
const secondRepository=new PostgresNotificationRepository(secondDb);
const worker=randomUUID();
beforeAll(async()=>{
 await admin.query(`DROP TABLE IF EXISTS public.notification;
 DROP TYPE IF EXISTS public."NotificationType"; DROP TYPE IF EXISTS public."NotificationStatus";
 CREATE TYPE public."NotificationType" AS ENUM ('WHATSAPP','OTHER_TEST_ONLY');
 CREATE TYPE public."NotificationStatus" AS ENUM ('PENDENTE','ERRO','SUCESSO');
 CREATE TABLE public.notification (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tipo public."NotificationType" NOT NULL,
 "to" varchar(30) NOT NULL, titulo text NOT NULL, mensagem text NOT NULL,
 data timestamptz(6) NOT NULL DEFAULT now(), status public."NotificationStatus" NOT NULL DEFAULT 'PENDENTE',
 tentativas integer NOT NULL DEFAULT 0, ultimo_erro text, processando_em timestamptz(6),worker_id uuid,
 created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now());
 CREATE INDEX idx_notification_status_data ON public.notification(status,data);
 CREATE INDEX idx_notification_processando_em ON public.notification(processando_em);`);
});
beforeEach(async()=>{await admin.query('TRUNCATE public.notification');});
afterAll(async()=>{await Promise.all([db.$disconnect(),secondDb.$disconnect(),admin.end()]);});
async function insert(overrides: Record<string,unknown>={}) {
 const value={id:randomUUID(),tipo:'WHATSAPP',to:'120363412284116447-group',titulo:'✅ título',mensagem:'ação\n teste',...overrides};
 const keys=Object.keys(value);
 // Identifiers come only from test literals, never external input.
 await admin.query(`INSERT INTO public.notification (${keys.map(key=>`"${key}"`).join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(value));
 return value.id;
}
it('reads WHATSAPP and excludes SUCESSO, ERRO, other types, future, exhausted, and locked rows',async()=>{
 const id=await insert();await insert({status:'SUCESSO'});await insert({status:'ERRO'});await insert({tipo:'OTHER_TEST_ONLY'});
 await insert({data:new Date(Date.now()+3600000)});await insert({tentativas:3});
 await insert({worker_id:randomUUID()});await insert({processando_em:new Date()});
 expect((await repository.claim(worker,3,120))?.id).toBe(id);
 expect(await repository.claim(worker,3,120)).toBeNull();
});
it('atomically increments attempts, keeps PENDENTE, and retains microseconds',async()=>{
 const id=await insert();const item=await repository.claim(worker,3,120);expect(item?.id).toBe(id);
 expect(item?.tentativas).toBe(1);expect(item?.worker_id).toBe(worker);
 const {rows:[row]}=await admin.query('SELECT status,processando_em::text AS token FROM public.notification WHERE id=$1',[id]);
 expect(row.status).toBe('PENDENTE');expect(item?.reservation).toBe(row.token);
 expect(await repository.owns(item!,120)).toBe(true);
 expect(await repository.finish(item!,'SUCESSO',null,120)).toBe(true);
});
it('orders by data, created_at, id',async()=>{
 const when=new Date(Date.now()-60000);const created=new Date(Date.now()-50000);
 await insert({id:'ffffffff-ffff-4fff-8fff-ffffffffffff',data:when,created_at:created});
 await insert({id:'00000000-0000-4000-8000-000000000001',data:when,created_at:created});
 const oldest=await insert({data:new Date(when.getTime()-1000)});
 expect((await repository.claim(worker,3,120))?.id).toBe(oldest);
 expect((await repository.claim(worker,3,120))?.id).toBe('00000000-0000-4000-8000-000000000001');
});
it('two Prisma clients cannot claim the same row under concurrent load',async()=>{
 for(let i=0;i<30;i++)await insert();
 const claims=await Promise.all(Array.from({length:40},(_,i)=>(i%2?repository:secondRepository).claim(randomUUID(),3,120)));
 const ids=claims.filter(item=>item!==null).map(item=>item.id);
 expect(ids).toHaveLength(30);expect(new Set(ids).size).toBe(30);
});
it('SKIP LOCKED skips a row locked by a different transaction',async()=>{
 const first=await insert({data:new Date(Date.now()-5000)});const second=await insert();
 const locker=await admin.connect();
 try {
  await locker.query('BEGIN');await locker.query('SELECT id FROM public.notification WHERE id=$1 FOR UPDATE',[first]);
  expect((await secondRepository.claim(randomUUID(),3,120))?.id).toBe(second);
 } finally {await locker.query('ROLLBACK');locker.release();}
});
it('guards worker, timestamp, state and stale ownership',async()=>{
 await insert();const item=(await repository.claim(worker,3,120))!;
 expect(await repository.finish({...item,worker_id:randomUUID()},'SUCESSO',null,120)).toBe(false);
 expect(await repository.finish({...item,reservation:'2000-01-01 00:00:00+00'},'SUCESSO',null,120)).toBe(false);
 expect(await repository.finish(item,'SUCESSO',null,120)).toBe(true);
 expect(await repository.finish(item,'ERRO','late stale write',120)).toBe(false);
});
it('does not reuse expired claims or uncertain work after restart',async()=>{
 const id=await insert({processando_em:new Date(Date.now()-3600000),worker_id:randomUUID()});
 expect(await secondRepository.claim(randomUUID(),3,120)).toBeNull();expect((await repository.stats(120,3)).stale).toBe(1);
 const {rows:[row]}=await admin.query('SELECT * FROM public.notification WHERE id=$1',[id]);
 expect(row.status).toBe('PENDENTE');expect(row.worker_id).not.toBeNull();
});
it('expired owner cannot finalize; quarantine preserves the original claim',async()=>{
 await insert();const item=(await repository.claim(worker,3,120))!;
 await admin.query("UPDATE public.notification SET processando_em=now()-interval '1 hour'");
 expect(await repository.owns(item,120)).toBe(false);expect(await repository.finish(item,'SUCESSO',null,120)).toBe(false);
 expect(await repository.quarantine(item,'stale token')).toBe(false);
 expect(await repository.claim(worker,3,120)).toBeNull();
});
it('quarantine blocks reclaim and preserves recipient and scheduled data',async()=>{
 await insert();const item=(await repository.claim(worker,3,120))!;
 const before=await admin.query('SELECT data,"to" FROM public.notification WHERE id=$1',[item.id]);
 expect(await repository.quarantine(item,'TRANSPORT_UNCERTAIN')).toBe(true);
 expect(await secondRepository.claim(randomUUID(),3,120)).toBeNull();
 const {rows:[after]}=await admin.query('SELECT data,"to",status,worker_id,ultimo_erro FROM public.notification WHERE id=$1',[item.id]);
 expect(after.data).toEqual(before.rows[0].data);expect(after.to).toBe(before.rows[0].to);
 expect(after.status).toBe('PENDENTE');expect(after.worker_id).toBe(worker);expect(after.ultimo_erro).toMatch(/^QUARENTENA:/);
});
it('safe retry releases only its own claim and respects maximum attempts',async()=>{
 await insert();const first=(await repository.claim(worker,3,120))!;
 expect(await repository.finish(first,'PENDENTE','INSTANCE_DISCONNECTED',120)).toBe(true);
 const second=(await secondRepository.claim(randomUUID(),3,120))!;expect(second.tentativas).toBe(2);
 expect(await repository.finish(first,'SUCESSO',null,120)).toBe(false);
 expect(await secondRepository.finish(second,'PENDENTE','INSTANCE_DISCONNECTED',120)).toBe(true);
 const third=(await repository.claim(worker,3,120))!;expect(third.tentativas).toBe(3);
 expect(await repository.finish(third,'ERRO','RETRIES_EXHAUSTED',120)).toBe(true);
 expect(await secondRepository.claim(randomUUID(),3,120)).toBeNull();
});

it('runs built worker end to end, drains on SIGTERM and does not resend after process restart',async()=>{
 const {createServer}=await import('node:http');const {spawn}=await import('node:child_process');
 let sends=0;
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET'){res.end(JSON.stringify({instance:{state:'open'}}));return;}
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
   sends++;const {number,text}=JSON.parse(body);
   expect(number).toBe('120363412284116447@g.us');expect(text).toBe('✅ título\n\nação\n teste');
   res.statusCode=201;res.end(JSON.stringify({key:{id:'runtime-msg',remoteJid:number,fromMe:true},status:'PENDING'}));
  });
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw new Error();
 const id=await insert();
 const start=()=>spawn(process.execPath,['dist/src/index.js'],{env:{...process.env,NODE_ENV:'test',DATABASE_URL:connectionString!,
  EVOLUTION_API_URL:`http://127.0.0.1:${address.port}`,EVOLUTION_API_KEY:'test-key',EVOLUTION_INSTANCE:'test',
  POLL_INTERVAL_MS:'20',SEND_DELAY_MS:'1',REQUEST_TIMEOUT_MS:'1000',RETRY_BASE_DELAY_MS:'10',LOG_LEVEL:'silent'},stdio:'pipe'});
 async function stop(child:ReturnType<typeof start>){
  const closed=new Promise<number|null>(resolve=>child.once('exit',resolve));child.kill('SIGTERM');expect(await closed).toBe(0);
 }
 let child=start();
 try {
  await expect.poll(async()=>{const {rows:[row]}=await admin.query('SELECT status FROM public.notification WHERE id=$1',[id]);return row.status;},{timeout:10000}).toBe('SUCESSO');
  await stop(child);child=start();
  // Wait for restart to connect and run cycles, then stop gracefully.
  await new Promise(resolve=>setTimeout(resolve,500));await stop(child);
  expect(sends).toBe(1);
 } finally {child.kill('SIGKILL');server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},15000);

it('abrupt process death after HTTP starts preserves quarantine across restart',async()=>{
 const {createServer}=await import('node:http');const {spawn}=await import('node:child_process');
 let sends=0;const server=createServer((req,res)=>{
  if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({instance:{state:'open'}}));return;}
  sends++;req.resume(); // No response: acceptance/delivery is unknowable to the worker.
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw new Error();
 const id=await insert();
 const start=()=>spawn(process.execPath,['dist/src/index.js'],{env:{...process.env,NODE_ENV:'test',DATABASE_URL:connectionString!,
  EVOLUTION_API_URL:`http://127.0.0.1:${address.port}`,EVOLUTION_API_KEY:'test-key',EVOLUTION_INSTANCE:'test',
  POLL_INTERVAL_MS:'20',SEND_DELAY_MS:'1',REQUEST_TIMEOUT_MS:'1000',RETRY_BASE_DELAY_MS:'10',LOG_LEVEL:'silent'},stdio:'pipe'});
 let child=start();
 try {
  await expect.poll(()=>sends,{timeout:10000}).toBe(1);
  const died=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await died;
  child=start();await new Promise(resolve=>setTimeout(resolve,500));
  const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await stopped;
  expect(sends).toBe(1);
  const {rows:[row]}=await admin.query('SELECT status,worker_id,processando_em FROM public.notification WHERE id=$1',[id]);
  expect(row.status).toBe('PENDENTE');expect(row.worker_id).not.toBeNull();expect(row.processando_em).not.toBeNull();
 } finally {child.kill('SIGKILL');server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},15000);
