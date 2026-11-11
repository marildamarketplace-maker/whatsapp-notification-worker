import { vi } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import type { NotificationRepository, MessageGateway, ReservedNotification } from '../src/types/notification.js';
export const config = loadConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://worker_test:local@localhost:55432/worker_test',
  EVOLUTION_API_URL:'http://localhost:8080',EVOLUTION_API_KEY:'test-key',EVOLUTION_INSTANCE:'test'});
export const log = createLogger('silent');
export const item: ReservedNotification = {id:'00000000-0000-4000-8000-000000000001',worker_id:'00000000-0000-4000-8000-000000000002',
  reservation:'2026-11-11 20:27:23.752123+00',to:'120363412284116447-group',titulo:'✅ Mensagens Shopee',mensagem:'Concluída.\n11/11, 17:27',tentativas:1};
export function mocks() {
  const repo = {claim:vi.fn().mockResolvedValue(null),owns:vi.fn().mockResolvedValue(true),finish:vi.fn().mockResolvedValue(true),
    quarantine:vi.fn().mockResolvedValue(true),stats:vi.fn().mockResolvedValue({pending:0,stale:0})} satisfies NotificationRepository;
  const gateway = {connected:vi.fn().mockResolvedValue(true),send:vi.fn().mockResolvedValue({messageId:'msg-1'})} satisfies MessageGateway;
  return {repo,gateway};
}
