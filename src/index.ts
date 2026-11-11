import { randomUUID } from 'node:crypto';
import { loadConfig } from './config/env.js';
import { createPrisma } from './database/prisma.js';
import { EvolutionClient } from './clients/evolution.client.js';
import { PostgresNotificationRepository } from './repositories/notification.repository.js';
import { NotificationService } from './services/notification.service.js';
import { NotificationWorker } from './workers/notification.worker.js';
import { createLogger } from './utils/logger.js';
import { reportProgress } from './utils/health.js';
async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.LOG_LEVEL);
  const workerId = randomUUID();
  const controller = new AbortController();
  const db = createPrisma(config.DATABASE_URL,config.NODE_ENV!=='test',config.PG_CA_FILE);
  let shutdownTimer: NodeJS.Timeout | undefined;
  const shutdown = (signal: string) => {
    if (controller.signal.aborted) return;
    log.info({signal,workerId},'shutdown_requested');
    controller.abort();
    // Bounded HTTP + DB completion. Fatal exits retain claims for manual reconciliation.
    shutdownTimer = setTimeout(() => {log.fatal('shutdown_deadline'); process.exit(1);},config.REQUEST_TIMEOUT_MS+30000);
    shutdownTimer.unref();
  };
  const onTerm = () => shutdown('SIGTERM'); const onInt = () => shutdown('SIGINT');
  process.once('SIGTERM',onTerm); process.once('SIGINT',onInt);
  try {
    reportProgress(30000);
    log.info({workerId},'worker_starting');
    await db.$connect(); await db.$queryRaw`SELECT 1`;
    log.info('database_connected');
    const repository = new PostgresNotificationRepository(db);
    const gateway = new EvolutionClient(config);
    try {log.info({connected:await gateway.connected()},'evolution_state');}
    catch {log.warn({code:'CONNECTION_CHECK_FAILED'},'evolution_unavailable');}
    const service = new NotificationService(repository,gateway,config,log,reportProgress);
    const worker = new NotificationWorker(repository,service,config,workerId,log,reportProgress);
    await worker.run(controller.signal);
  } finally {
    reportProgress(0,false);
    await db.$disconnect();
    if (shutdownTimer) clearTimeout(shutdownTimer);
    process.removeListener('SIGTERM',onTerm); process.removeListener('SIGINT',onInt);
    log.info({workerId},'worker_stopped');
  }
}
main().catch(() => {
  // Do not print Zod inputs, connection URLs, Axios errors, or raw DB errors.
  console.error(JSON.stringify({level:'fatal',code:'STARTUP_OR_RUNTIME_FAILURE',msg:'Verifique configuração, TLS e conectividade; valores omitidos por segurança.'}));
  process.exitCode=1;
});
