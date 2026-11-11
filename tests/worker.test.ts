import { it,expect,vi } from 'vitest';
import { NotificationWorker } from '../src/workers/notification.worker.js';
import { config,log,item,mocks } from './helpers.js';
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
