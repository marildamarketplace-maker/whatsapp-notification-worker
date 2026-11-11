import { describe,it,expect } from 'vitest';
import { normalizeWhatsAppRecipient, formatMessage } from '../src/services/recipient.service.js';
import { item } from './helpers.js';
describe('group recipients',() => {
  it.each(['120363412284116447-group','120363412284116447@g.us',' 120363412284116447-group '])('normalizes %s',to => {
    expect(normalizeWhatsAppRecipient(to)).toBe('120363412284116447@g.us');
  });
  it.each(['','5511999999999','5511999999999@s.whatsapp.net','abc-group','1@g.us.evil','1@lid','1-2@g.us'])('rejects %s',to=>{
    expect(()=>normalizeWhatsAppRecipient(to)).toThrow('Destinatário WhatsApp inválido');
  });
  it('preserves exact unicode, spaces and line breaks',()=> {
    expect(formatMessage(item.titulo,item.mensagem)).toBe('✅ Mensagens Shopee\n\nConcluída.\n11/11, 17:27');
    expect(formatMessage(' título ',' texto \n')).toBe(' título \n\n texto \n');
  });
});
