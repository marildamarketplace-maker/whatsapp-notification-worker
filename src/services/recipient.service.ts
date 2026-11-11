export function normalizeWhatsAppRecipient(to: string): string {
  const value = to.trim();
  if (/^\d+@g\.us$/.test(value)) return value;
  if (/^\d+-group$/.test(value)) return value.replace(/-group$/, '@g.us');
  throw new Error('Destinatário WhatsApp inválido');
}
export const formatMessage = (titulo: string, mensagem: string): string => `${titulo}\n\n${mensagem}`;
