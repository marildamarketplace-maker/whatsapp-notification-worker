import type { PrismaClient } from '@prisma/client';
import type { Completion, NotificationRepository, ReservedNotification } from '../types/notification.js';
export class PostgresNotificationRepository implements NotificationRepository {
  constructor(private readonly db: PrismaClient) {}
  async claim(workerId: string, maxRetries: number, _leaseSeconds: number): Promise<ReservedNotification | null> {
    const rows = await this.db.$transaction(tx => tx.$queryRaw<ReservedNotification[]>`
      WITH candidate AS (
        SELECT id FROM public.notification
        WHERE tipo = 'WHATSAPP' AND status = 'PENDENTE' AND data <= NOW()
          AND tentativas < ${maxRetries} AND processando_em IS NULL AND worker_id IS NULL
        ORDER BY data ASC, created_at ASC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      UPDATE public.notification n SET processando_em = clock_timestamp(), worker_id = ${workerId}::uuid,
        tentativas = n.tentativas + 1, updated_at = NOW()
      FROM candidate c WHERE n.id = c.id
      RETURNING n.id, n."to", n.titulo, n.mensagem, n.tentativas, n.worker_id,
        n.processando_em::text AS reservation
    `, {maxWait:10000, timeout:15000});
    return rows[0] ?? null;
  }
  async owns(item: ReservedNotification, leaseSeconds: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<{id:string}[]>`
      SELECT id FROM public.notification WHERE id=${item.id}::uuid AND worker_id=${item.worker_id}::uuid
        AND processando_em=${item.reservation}::timestamptz AND tipo='WHATSAPP' AND status='PENDENTE'
        AND processando_em > clock_timestamp() - ${leaseSeconds} * interval '1 second'
    `;
    return rows.length === 1;
  }
  async finish(item: ReservedNotification, status: Completion, error: string | null, leaseSeconds: number): Promise<boolean> {
    const count = await this.db.$executeRaw`
      UPDATE public.notification SET status=${status}::public."NotificationStatus", ultimo_erro=${error},
        processando_em=NULL, worker_id=NULL, updated_at=NOW()
      WHERE id=${item.id}::uuid AND worker_id=${item.worker_id}::uuid
        AND processando_em=${item.reservation}::timestamptz AND tipo='WHATSAPP' AND status='PENDENTE'
        AND processando_em > clock_timestamp() - ${leaseSeconds} * interval '1 second'
    `;
    return count === 1;
  }
  async quarantine(item: ReservedNotification, reason: string): Promise<boolean> {
    // Never unlock or change status. Prefix is operator metadata, not a queue state.
    return await this.db.$executeRaw`
      UPDATE public.notification SET ultimo_erro=${'QUARENTENA: ' + reason}, updated_at=NOW()
      WHERE id=${item.id}::uuid AND worker_id=${item.worker_id}::uuid
        AND processando_em=${item.reservation}::timestamptz AND status='PENDENTE' AND tipo='WHATSAPP'
    ` === 1;
  }
  async stats(leaseSeconds: number, maxRetries: number) {
    const [row] = await this.db.$queryRaw<{pending: number; stale: number}[]>`
      SELECT count(*) FILTER (WHERE processando_em IS NULL AND worker_id IS NULL AND data<=NOW()
        AND tentativas < ${maxRetries})::int AS pending,
        count(*) FILTER (WHERE (processando_em <= NOW()-${leaseSeconds}*interval '1 second')
          OR (processando_em IS NULL AND worker_id IS NOT NULL)
          OR (processando_em IS NOT NULL AND worker_id IS NULL)
          OR (tentativas >= ${maxRetries} AND processando_em IS NULL))::int AS stale
      FROM public.notification WHERE tipo='WHATSAPP' AND status='PENDENTE'
    `;
    return row ?? {pending:0,stale:0};
  }
}
