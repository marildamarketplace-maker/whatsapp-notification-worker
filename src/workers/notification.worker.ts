import type { Logger } from 'pino';
import type { Config } from '../config/env.js';
import type { NotificationRepository } from '../types/notification.js';
import type { NotificationService } from '../services/notification.service.js';
import { sleep } from '../utils/retry.js';
export class NotificationWorker {
  constructor(private readonly repository: NotificationRepository, private readonly service: Pick<NotificationService,'process'>,
    private readonly config: Config, private readonly workerId: string, private readonly log: Logger,
    private readonly progress:(budgetMs:number,healthy?:boolean)=>void = () => {},
    private readonly wait: typeof sleep = sleep,
    private readonly now: () => number = () => performance.now()) {}
  async run(signal: AbortSignal): Promise<void> {
    let idleDelayMs = this.config.POLL_INTERVAL_MS;
    let nextStatsAt = 0;
    while (!signal.aborted) {
      // Monitoring failure must not prevent claiming work. Retry only at its own cadence.
      if (this.now() >= nextStatsAt) {
        this.progress(15000);
        try {
          const stats = await this.repository.stats(this.config.LOCK_TIMEOUT_SECONDS,this.config.MAX_RETRIES);
          this.log.info(stats,'queue_status');
          if (stats.stale) this.log.warn({count:stats.stale},'manual_reconciliation_required');
        } catch {
          this.log.warn({code:'QUEUE_STATS_FAILED'},'queue_stats_failed');
        } finally {
          nextStatsAt = this.now() + this.config.STATS_INTERVAL_MS;
        }
      }
      let healthy = true;
      let reserved = 0;
      let payloadBytes = 0;
      try {
        // Logical batch, just-in-time reservation: no claimed work expires waiting in memory.
        for (let index=0; index<this.config.BATCH_SIZE && !signal.aborted; index++) {
          this.progress(15000);
          const item = await this.repository.claim(this.workerId,this.config.MAX_RETRIES,this.config.LOCK_TIMEOUT_SECONDS);
          if (!item) break;
          reserved++;
          // UTF-8 content received from PostgreSQL, including Base64 and retry reads.
          // This is an estimate of payload traffic, not protocol/TLS or billed egress.
          payloadBytes += Buffer.byteLength(item.titulo,'utf8') + Buffer.byteLength(item.mensagem,'utf8');
          if (signal.aborted) break;
          await this.service.process(item,signal);
        }
      } catch {
        healthy = false;
        this.log.error({code:'CYCLE_FAILED',reserved,payloadBytes},'cycle_failed');
      }
      let pollIntervalMs = this.config.POLL_INTERVAL_MS;
      if (healthy && reserved === 0) {
        pollIntervalMs = idleDelayMs;
        idleDelayMs = Math.min(idleDelayMs * 2,this.config.POLL_MAX_INTERVAL_MS);
      } else {
        // Work or failures reset idle backoff; an outage is not an empty queue.
        idleDelayMs = this.config.POLL_INTERVAL_MS;
      }
      if (healthy) this.log.info({reserved,payloadBytes,pollIntervalMs},'cycle_completed');
      if (!signal.aborted) {
        this.progress(pollIntervalMs,healthy);
        await this.wait(pollIntervalMs,signal);
      }
    }
  }
}
