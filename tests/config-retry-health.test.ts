import { it,expect,afterEach } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { environmentSchema,loadConfig } from '../src/config/env.js';
import { retryDelay,sleep } from '../src/utils/retry.js';
import { checkHealth,reportProgress,healthPath } from '../src/utils/health.js';
import { config } from './helpers.js';
afterEach(()=>rmSync(healthPath,{force:true}));
it('rejects missing secrets',()=>{expect(environmentSchema.safeParse({}).success).toBe(false);});
it.each(['',undefined,config.DATABASE_URL])('accepts optional DIRECT_URL %s',directUrl=>{
 expect(environmentSchema.safeParse({...config,DIRECT_URL:directUrl}).success).toBe(true);
});
it.each(['DATABASE_URL','DIRECT_URL','EVOLUTION_API_URL'])('rejects malformed %s without throwing a URL parser error',field=>{
 const result=environmentSchema.safeParse({...config,[field]:'not-a-url-with-secret'});
 expect(result.success).toBe(false);
});
it.each(['DATABASE_URL','EVOLUTION_API_URL'])('rejects empty required %s without throwing a URL parser error',field=>{
 expect(environmentSchema.safeParse({...config,[field]:''}).success).toBe(false);
});
it('reports invalid fields without leaking malformed credential values',()=>{
 const source={NODE_ENV:'test',DATABASE_URL:'invalid-sensitive-password',DIRECT_URL:'',
  EVOLUTION_API_URL:'http://localhost:8080',EVOLUTION_API_KEY:'private-api-key',EVOLUTION_INSTANCE:'test'};
 expect(()=>loadConfig(source)).toThrow('Configuração inválida: DATABASE_URL');
 try {loadConfig(source);} catch(error) {
  expect(String(error)).not.toContain('invalid-sensitive-password');
  expect(String(error)).not.toContain('private-api-key');
 }
});
it('requires HTTPS in production',()=>{expect(environmentSchema.safeParse({...config,NODE_ENV:'production'}).success).toBe(false);});
it('rejects unsupported concurrency',()=>{expect(environmentSchema.safeParse({...config,MAX_CONCURRENT_SENDS:2}).success).toBe(false);});
it('rejects unsafe lease duration',()=>{expect(environmentSchema.safeParse({...config,LOCK_TIMEOUT_SECONDS:20}).success).toBe(false);});
it('rejects URL credentials',()=>{expect(environmentSchema.safeParse({...config,EVOLUTION_API_URL:'https://user:password@example.com'}).success).toBe(false);});
it('uses exponential backoff and bounded positive jitter',()=>{
 expect(retryDelay(1,30000,()=>0)).toBe(30000);expect(retryDelay(2,30000,()=>1)).toBe(75000);
 expect(retryDelay(20,30000,()=>1)).toBe(3600000);
});
it('interrupts waits on shutdown',async()=>{const stop=new AbortController();stop.abort();await expect(sleep(30000,stop.signal)).resolves.toBeUndefined();});
it('health observes progress deadline and process',()=>{reportProgress(1000);expect(checkHealth()).toBe(true);});
it('health rejects stale progress despite a live process',()=>{writeFileSync(healthPath,JSON.stringify({pid:process.pid,deadline:Date.now()-1,healthy:true}));expect(checkHealth()).toBe(false);});
it('health rejects dependency failure and missing state',()=>{expect(checkHealth()).toBe(false);reportProgress(10000,false);expect(checkHealth()).toBe(false);});
