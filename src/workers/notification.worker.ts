import type { Logger } from 'pino';
import type { Config } from '../config/env.js';
import type { NotificationRepository } from '../types/notification.js';
import type { NotificationService } from '../services/notification.service.js';
import { sleep } from '../utils/retry.js';
export class NotificationWorker {
  constructor(private readonly repository: NotificationRepository, private readonly service: Pick<NotificationService,'process'>,
    private readonly config: Config, private readonly workerId: string, private readonly log: Logger,
    private readonly progress:(budgetMs:number,healthy?:boolean)=>void = () => {}) {}
  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let healthy = true;
      try {
        this.progress(15000);
        const stats = await this.repository.stats(this.config.LOCK_TIMEOUT_SECONDS,this.config.MAX_RETRIES);
        this.log.info(stats,'queue_status');
        if (stats.stale) this.log.warn({count:stats.stale},'manual_reconciliation_required');
        let reserved = 0;
        // Logical batch, just-in-time reservation: no claimed work expires waiting in memory.
        for (let index=0; index<this.config.BATCH_SIZE && !signal.aborted; index++) {
          this.progress(15000);
          const item = await this.repository.claim(this.workerId,this.config.MAX_RETRIES,this.config.LOCK_TIMEOUT_SECONDS);
          if (!item) break;
          reserved++;
          if (signal.aborted) break;
          await this.service.process(item,signal);
        }
        this.log.info({reserved},'cycle_completed');
      } catch {
        healthy = false;
        this.log.error({code:'CYCLE_FAILED'},'cycle_failed');
      }
      if (!signal.aborted) {
        this.progress(this.config.POLL_INTERVAL_MS,healthy);
        await sleep(this.config.POLL_INTERVAL_MS,signal);
      }
    }
  }
}
