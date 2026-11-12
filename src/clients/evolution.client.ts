import axios, { type AxiosInstance } from 'axios';
import { z } from 'zod';
import { validateImage } from '../services/message.service.js';
import type { Config } from '../config/env.js';
import { DeliveryError, type MessageGateway, type ImageAttachment } from '../types/notification.js';
const accepted = z.object({
  key: z.object({id:z.string().min(1),remoteJid:z.string(),fromMe:z.literal(true)}),
  status: z.enum(['PENDING','SERVER_ACK','DELIVERY_ACK','READ','PLAYED']),
});
const connection = z.object({instance:z.object({state:z.string()})});
export class EvolutionClient implements MessageGateway {
  private readonly http: AxiosInstance;
  private readonly instance: string;
  constructor(config: Pick<Config,'EVOLUTION_API_URL'|'EVOLUTION_API_KEY'|'EVOLUTION_INSTANCE'|'REQUEST_TIMEOUT_MS'>, http?: AxiosInstance) {
    this.instance = encodeURIComponent(config.EVOLUTION_INSTANCE);
    this.http = http ?? axios.create({baseURL:config.EVOLUTION_API_URL.replace(/\/$/,''),timeout:config.REQUEST_TIMEOUT_MS,
      headers:{apikey:config.EVOLUTION_API_KEY,'Content-Type':'application/json',
        // Evolution 2.3.7 rejects originless backend calls with a CORS allowlist.
        // Identify this server's own origin while retaining its restrictive policy.
        Origin:new URL(config.EVOLUTION_API_URL).origin},
      maxRedirects:0, maxContentLength:1_048_576, maxBodyLength:8_388_608,
    });
  }
  async connected(): Promise<boolean> {
    try {
      const response = await this.http.get<unknown>(`/instance/connectionState/${this.instance}`);
      const result = connection.safeParse(response.data);
      if (!result.success) throw new DeliveryError('safe-retry','CONNECTION_CONTRACT_INVALID');
      return result.data.instance.state === 'open';
    } catch (error) {
      // GET failures are safe: no send request was started.
      if (error instanceof DeliveryError) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      throw new DeliveryError('safe-retry',status === 401 || status === 403 ? 'AUTHENTICATION' : 'CONNECTION_CHECK_FAILED');
    }
  }
  async send(number: string, text: string, image?: ImageAttachment): Promise<{messageId:string}> {
    // Validate before POST, including when this client is used outside the worker.
    if (image) validateImage(image);
    try {
      const response = image
        ? await this.http.post<unknown>(`/message/sendMedia/${this.instance}`,{
          number,mediatype:'image',mimetype:image.mimetype,media:image.media,caption:text,
        })
        : await this.http.post<unknown>(`/message/sendText/${this.instance}`,{number,text});
      const result = accepted.safeParse(response.data);
      if (!result.success || result.data.key.remoteJid !== number)
        throw new DeliveryError('uncertain','SEND_RESPONSE_INVALID');
      return {messageId:result.data.key.id};
    } catch (error) {
      if (error instanceof DeliveryError) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      // Only explicit auth/validation rejections are treated as definitive.
      // Even 429/5xx may originate after acceptance: never retry these blindly.
      if (status && [400,401,403,404,405,413,415,422].includes(status))
        throw new DeliveryError('permanent',status === 401 || status === 403 ? 'AUTHENTICATION' : `HTTP_REJECTED_${status}`);
      throw new DeliveryError('uncertain',status ? `HTTP_UNCERTAIN_${status}` : 'TRANSPORT_UNCERTAIN');
    }
  }
}
