import { afterEach,it,expect,vi } from 'vitest';
import type { Config } from '../src/config/env.js';
import { NotificationWorker } from '../src/workers/notification.worker.js';
import { config,log,item,mocks } from './helpers.js';
afterEach(()=>vi.restoreAllMocks());

// Advance a monotonic clock with each wait, without timers or real database access.
function loop(cycles: number, overrides: Partial<Config> = {}) {
 const {repo}=mocks();const stop=new AbortController();const process=vi.fn().mockResolvedValue(undefined);
 const progress=vi.fn();const delays:number[]=[];let clock=0;
 const wait=vi.fn(async(ms:number,signal?:AbortSignal)=>{
  expect(signal).toBe(stop.signal);delays.push(ms);clock+=ms;
  if(delays.length===cycles)stop.abort();
 });
 const worker=new NotificationWorker(repo,{process},{...config,...overrides},item.worker_id,log,progress,wait,()=>clock);
 return {repo,stop,process,progress,delays,wait,run:()=>worker.run(stop.signal),advance:(ms:number)=>{clock+=ms;}};
}
it('runs sequentially and stops claiming on shutdown',async()=>{
 const {repo}=mocks();const stop=new AbortController();repo.claim.mockResolvedValue(item);let active=0;
 const process=vi.fn(async()=>{active++;expect(active).toBe(1);await Promise.resolve();active--;stop.abort();});
 await new NotificationWorker(repo,{process},config,item.worker_id,log).run(stop.signal);
 expect(repo.claim).toHaveBeenCalledTimes(1);expect(process).toHaveBeenCalledTimes(1);
});
it('restart does not recover stale work automatically',async()=>{
 const {repo}=mocks();repo.stats.mockResolvedValue({pending:0,stale:2});const stop=new AbortController();
 repo.claim.mockImplementation(async()=>{stop.abort();return null;});const process=vi.fn();
 await new NotificationWorker(repo,{process},config,item.worker_id,log).run(stop.signal);
 expect(process).not.toHaveBeenCalled();expect(repo.finish).not.toHaveBeenCalled();expect(repo.quarantine).not.toHaveBeenCalled();
});
it('does not overlap cycles while a handler is blocked',async()=>{
 const {repo}=mocks();repo.claim.mockResolvedValue(item);const stop=new AbortController();
 let release!:()=>void;const blocked=new Promise<void>(resolve=>release=resolve);
 const process=vi.fn(async()=>{await blocked;stop.abort();});
 const running=new NotificationWorker(repo,{process},config,item.worker_id,log).run(stop.signal);
 await vi.waitFor(()=>expect(process).toHaveBeenCalledTimes(1));expect(repo.claim).toHaveBeenCalledTimes(1);
 release();await running;
});
it('backs off empty cycles from 10 to 60 seconds and caps the wait',async()=>{
 const run=loop(6);await run.run();
 expect(run.delays).toEqual([10000,20000,40000,60000,60000,60000]);
 expect(run.repo.claim).toHaveBeenCalledTimes(6);expect(run.process).not.toHaveBeenCalled();
 expect(run.progress).toHaveBeenCalledWith(60000,true);
});
it('resets the idle delay when work arrives, including after reaching the cap',async()=>{
 const run=loop(8);
 run.repo.claim.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
  .mockResolvedValueOnce(null).mockResolvedValueOnce(item).mockResolvedValueOnce(null);
 await run.run();
 expect(run.delays).toEqual([10000,20000,40000,60000,10000,10000,20000,40000]);
 expect(run.process).toHaveBeenCalledExactlyOnceWith(item,run.stop.signal);
});
it('keeps active batches sequential, bounded and at the base interval',async()=>{
 const run=loop(3,{BATCH_SIZE:2});run.repo.claim.mockResolvedValue(item);
 await run.run();
 expect(run.delays).toEqual([10000,10000,10000]);
 expect(run.repo.claim).toHaveBeenCalledTimes(6);expect(run.process).toHaveBeenCalledTimes(6);
});
it('supports a fixed polling interval when the cap equals the base',async()=>{
 const run=loop(4,{POLL_MAX_INTERVAL_MS:10000});await run.run();
 expect(run.delays).toEqual([10000,10000,10000,10000]);
});
it('reads statistics at startup and every five minutes, not every cycle',async()=>{
 const run=loop(32,{POLL_MAX_INTERVAL_MS:10000});const observed:number[]=[];let calls=0;
 run.repo.claim.mockImplementation(async()=>{calls++;return null;});
 run.repo.stats.mockImplementation(async()=>{observed.push(calls);return {pending:0,stale:0};});
 await run.run();
 expect(observed).toEqual([0,30]);expect(run.repo.stats).toHaveBeenCalledTimes(2);
});
it('continues processing when statistics fail and throttles their retries',async()=>{
 const run=loop(32,{POLL_MAX_INTERVAL_MS:10000});const warn=vi.spyOn(log,'warn');
 run.repo.stats.mockRejectedValue(new Error('sensitive database details'));
 run.repo.claim.mockResolvedValueOnce(item).mockResolvedValue(null);
 await run.run();
 expect(run.process).toHaveBeenCalledExactlyOnceWith(item,run.stop.signal);
 expect(run.repo.stats).toHaveBeenCalledTimes(2);
 expect(warn).toHaveBeenCalledWith({code:'QUEUE_STATS_FAILED'},'queue_stats_failed');
 expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive');
 expect(run.progress).not.toHaveBeenCalledWith(expect.any(Number),false);
});
it('does not run catch-up statistics queries after a long processing cycle',async()=>{
 const run=loop(3);run.repo.claim.mockResolvedValueOnce(item).mockResolvedValue(null);
 run.process.mockImplementation(async()=>run.advance(900000));await run.run();
 expect(run.repo.stats).toHaveBeenCalledTimes(2);
});
it('resets idle backoff after a claim failure and reports unhealthy progress',async()=>{
 const run=loop(6);const error=vi.spyOn(log,'error');
 run.repo.claim.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
  .mockRejectedValueOnce(new Error('private database failure'));
 await run.run();
 expect(run.delays).toEqual([10000,20000,40000,10000,10000,20000]);
 expect(run.progress).toHaveBeenCalledWith(10000,false);
 expect(error).toHaveBeenCalledWith({code:'CYCLE_FAILED',reserved:0,payloadBytes:0},'cycle_failed');
 expect(JSON.stringify(error.mock.calls)).not.toContain('private');
});
it('records UTF-8 payload bytes including Base64, without message contents or recipients',async()=>{
 const run=loop(1,{BATCH_SIZE:2});const info=vi.spyOn(log,'info');
 const photo={...item,mensagem:'whatsapp:image:v1\n'+JSON.stringify({media:'iVBORw0KGgo=',mimetype:'image/png'})};
 run.repo.claim.mockResolvedValueOnce(item).mockResolvedValueOnce(photo);await run.run();
 const payloadBytes=Buffer.byteLength(item.titulo)*2+Buffer.byteLength(item.mensagem)+Buffer.byteLength(photo.mensagem);
 expect(info).toHaveBeenCalledWith({reserved:2,payloadBytes,pollIntervalMs:10000},'cycle_completed');
 const logs=JSON.stringify(info.mock.calls);
 for(const secret of [item.to,item.titulo,item.mensagem,'iVBORw0KGgo='])expect(logs).not.toContain(secret);
});
it('keeps partial payload metrics when processing fails without releasing a reservation',async()=>{
 const run=loop(1);const error=vi.spyOn(log,'error');run.repo.claim.mockResolvedValueOnce(item);
 run.process.mockRejectedValue(new Error('private payload'));await run.run();
 expect(error).toHaveBeenCalledWith({code:'CYCLE_FAILED',reserved:1,
  payloadBytes:Buffer.byteLength(item.titulo)+Buffer.byteLength(item.mensagem)},'cycle_failed');
 expect(run.repo.finish).not.toHaveBeenCalled();expect(run.repo.quarantine).not.toHaveBeenCalled();
});
it('does not start queries if shutdown was already requested',async()=>{
 const run=loop(1);run.stop.abort();await run.run();
 expect(run.repo.stats).not.toHaveBeenCalled();expect(run.repo.claim).not.toHaveBeenCalled();
 expect(run.wait).not.toHaveBeenCalled();
});
it('shutdown after claiming retains the reservation and counts the received payload',async()=>{
 const run=loop(1);const info=vi.spyOn(log,'info');
 run.repo.claim.mockImplementation(async()=>{run.stop.abort();return item;});await run.run();
 expect(run.process).not.toHaveBeenCalled();expect(run.wait).not.toHaveBeenCalled();
 expect(run.repo.finish).not.toHaveBeenCalled();expect(run.repo.quarantine).not.toHaveBeenCalled();
 expect(info).toHaveBeenCalledWith(expect.objectContaining({reserved:1,
  payloadBytes:Buffer.byteLength(item.titulo)+Buffer.byteLength(item.mensagem)}),'cycle_completed');
});
it('interrupts the real adaptive wait on shutdown without another claim',async()=>{
 const {repo}=mocks();const stop=new AbortController();const process=vi.fn();let sleeping!:()=>void;
 const startedSleep=new Promise<void>(resolve=>sleeping=resolve);
 const progress=(budget:number)=>{if(budget===60000)sleeping();};
 const running=new NotificationWorker(repo,{process},{...config,POLL_INTERVAL_MS:60000},item.worker_id,log,progress).run(stop.signal);
 await startedSleep;stop.abort();await running;
 expect(repo.claim).toHaveBeenCalledTimes(1);expect(process).not.toHaveBeenCalled();
});
