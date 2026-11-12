import type { Logger } from 'pino';
import type { Config } from '../config/env.js';
import { DeliveryError, type MessageGateway, type NotificationRepository, type ReservedNotification } from '../types/notification.js';
import { normalizeWhatsAppRecipient } from './recipient.service.js';
import { prepareMessage } from './message.service.js';
import { retryDelay, sleep } from '../utils/retry.js';
export class NotificationService {
  private lastSend = 0;
  constructor(private readonly repository: NotificationRepository, private readonly gateway: MessageGateway,
    private readonly config: Config, private readonly log: Logger,
    private readonly progress: (budgetMs: number) => void = () => {},
    private readonly wait: typeof sleep = sleep) {}
  private async quarantine(item: ReservedNotification, reason: string): Promise<void> {
    try {
      const recorded = await this.repository.quarantine(item, reason);
      this.log.warn({notificationId:item.id,code:reason,recorded},'notification_quarantined');
    } catch {
      // Existing reservation remains durable even when error metadata cannot be saved.
      this.log.error({notificationId:item.id,code:reason},'quarantine_metadata_failed_reservation_retained');
    }
  }
  private async complete(item: ReservedNotification, status:'SUCESSO'|'ERRO'|'PENDENTE', code:string|null): Promise<void> {
    this.progress(15000);
    try {
      if (!await this.repository.finish(item,status,code,this.config.LOCK_TIMEOUT_SECONDS)) {
        await this.quarantine(item, status==='SUCESSO' ? 'ACCEPTED_BUT_OWNERSHIP_EXPIRED' : 'OWNERSHIP_LOST');
        return;
      }
      this.log.info({notificationId:item.id,status,attempt:item.tentativas,code},'notification_result');
    } catch {
      await this.quarantine(item,status==='SUCESSO' ? 'ACCEPTED_DATABASE_UPDATE_FAILED' : 'DATABASE_UPDATE_FAILED');
    }
  }
  async process(item: ReservedNotification, signal: AbortSignal): Promise<void> {
    const started = Date.now();
    this.log.info({notificationId:item.id,attempt:item.tentativas},'notification_processing');
    let number: string;
    try { number = normalizeWhatsAppRecipient(item.to); }
    catch { await this.complete(item,'ERRO','INVALID_RECIPIENT'); return; }
    let message: ReturnType<typeof prepareMessage>;
    try { message = prepareMessage(item.titulo,item.mensagem); }
    catch { await this.complete(item,'ERRO','INVALID_IMAGE_PAYLOAD'); return; }
    try {
      this.progress(this.config.REQUEST_TIMEOUT_MS);
      if (!await this.gateway.connected()) throw new DeliveryError('safe-retry','INSTANCE_DISCONNECTED');
      const interval = Math.max(0,this.config.SEND_DELAY_MS-(Date.now()-this.lastSend));
      this.progress(interval);
      await this.wait(interval,signal);
      if (signal.aborted) return; // Retain reservation; shutdown never releases ambiguous work.
      this.progress(15000);
      if (!await this.repository.owns(item,this.config.LOCK_TIMEOUT_SECONDS)) {
        await this.quarantine(item,'OWNERSHIP_LOST_BEFORE_SEND'); return;
      }
      if (signal.aborted) return;
    } catch (error) {
      const code = error instanceof DeliveryError ? error.code : 'PRE_SEND_DATABASE_UNAVAILABLE';
      this.log.warn({notificationId:item.id,code},'pre_send_failed');
      if (signal.aborted) return;
      if (item.tentativas >= this.config.MAX_RETRIES) { await this.complete(item,'ERRO',code); return; }
      const delay = retryDelay(item.tentativas,this.config.RETRY_BASE_DELAY_MS);
      this.log.info({notificationId:item.id,delayMs:delay},'retry_wait_reserved');
      this.progress(delay);
      await this.wait(delay,signal);
      if (!signal.aborted) await this.complete(item,'PENDENTE',code);
      return;
    }
    this.lastSend = Date.now();
    this.progress(this.config.REQUEST_TIMEOUT_MS);
    try {
      // No automatic HTTP retries. Do not abort a started send on graceful shutdown.
      const response = message.image
        ? await this.gateway.send(number,message.text,message.image)
        : await this.gateway.send(number,message.text);
      this.log.info({notificationId:item.id,messageId:response.messageId},'evolution_accepted');
    } catch (error) {
      if (error instanceof DeliveryError && error.kind === 'permanent') await this.complete(item,'ERRO',error.code);
      else await this.quarantine(item,error instanceof DeliveryError ? error.code : 'UNKNOWN_AFTER_SEND_STARTED');
      return;
    }
    await this.complete(item,'SUCESSO',null);
    this.log.info({notificationId:item.id,durationMs:Date.now()-started},'notification_finished');
  }
}
