export interface ReservedNotification {
  id: string; to: string; titulo: string; mensagem: string; tentativas: number;
  worker_id: string;
  // PostgreSQL text retains microseconds lost by JavaScript Date.
  reservation: string;
}
export type Completion = 'SUCESSO' | 'ERRO' | 'PENDENTE';
export interface NotificationRepository {
  claim(workerId: string, maxRetries: number, leaseSeconds: number): Promise<ReservedNotification | null>;
  owns(item: ReservedNotification, leaseSeconds: number): Promise<boolean>;
  finish(item: ReservedNotification, status: Completion, error: string | null, leaseSeconds: number): Promise<boolean>;
  quarantine(item: ReservedNotification, reason: string): Promise<boolean>;
  stats(leaseSeconds: number, maxRetries: number): Promise<{pending: number; stale: number}>;
}
export interface MessageGateway {
  connected(): Promise<boolean>;
  send(number: string, text: string): Promise<{messageId: string}>;
}
export type FailureKind = 'safe-retry' | 'permanent' | 'uncertain';
export class DeliveryError extends Error {
  constructor(public readonly kind: FailureKind, public readonly code: string) { super(code); }
}
