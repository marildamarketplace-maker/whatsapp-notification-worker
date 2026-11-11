import { loadConfig } from '../src/config/env.js';
import { EvolutionClient } from '../src/clients/evolution.client.js';
import { normalizeWhatsAppRecipient } from '../src/services/recipient.service.js';
import { DeliveryError } from '../src/types/notification.js';
try {
  const gateway = new EvolutionClient(loadConfig());
  if (!await gateway.connected()) throw new Error('Instância desconectada');
  console.log('Instância conectada.');
  if (process.env.EVOLUTION_TEST_SEND === 'true') {
    const number = normalizeWhatsAppRecipient(process.env.EVOLUTION_TEST_RECIPIENT ?? '');
    const response = await gateway.send(number,'✅ Teste controlado do worker\n\nConfirme o recebimento no grupo correto.');
    console.log(JSON.stringify({accepted:true,messageId:response.messageId}));
  } else console.log('Somente leitura. Para teste real: EVOLUTION_TEST_SEND=true e EVOLUTION_TEST_RECIPIENT.');
} catch (error) {console.error(error instanceof DeliveryError ? error.code : 'Validação falhou; confira configuração/grupo.');process.exitCode=1;}
