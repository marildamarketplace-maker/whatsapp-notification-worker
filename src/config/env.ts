import { z } from 'zod';
const integer = (value: number, max = 2_147_483_647) => z.coerce.number().int().positive().max(max).default(value);
const databaseUrl = z.url().refine(value => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), 'Use PostgreSQL');
export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development','production','test']).default('production'),
  DATABASE_URL: databaseUrl, DIRECT_URL: z.union([databaseUrl,z.literal('')]).optional(),
  EVOLUTION_API_URL: z.url().refine(value => {
    const url = new URL(value);
    return ['https:','http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, 'URL HTTP(S) sem credenciais/query/hash'),
  EVOLUTION_API_KEY: z.string().min(1), EVOLUTION_INSTANCE: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  POLL_INTERVAL_MS: integer(10000,300000), BATCH_SIZE: integer(10,1000),
  // Sequential sending is intentional: raising concurrency needs a shared rate limiter.
  MAX_CONCURRENT_SENDS: z.coerce.number().int().min(1).max(1).default(1),
  MAX_RETRIES: integer(3,20), RETRY_BASE_DELAY_MS: integer(30000,3600000),
  SEND_DELAY_MS: integer(1500,300000), REQUEST_TIMEOUT_MS: integer(15000,120000),
  LOCK_TIMEOUT_SECONDS: integer(120,86400),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info'),
  PG_CA_FILE: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && !value.EVOLUTION_API_URL.startsWith('https://'))
    context.addIssue({code:'custom',path:['EVOLUTION_API_URL'],message:'HTTPS obrigatório em produção'});
  const maxBackoff = value.MAX_RETRIES > 1 ? Math.min(3600000, value.RETRY_BASE_DELAY_MS * 2 ** (value.MAX_RETRIES - 2) * 1.25) : 0;
  if (value.LOCK_TIMEOUT_SECONDS * 1000 <= Math.max(maxBackoff, value.REQUEST_TIMEOUT_MS) + value.REQUEST_TIMEOUT_MS + value.SEND_DELAY_MS + 20000)
    context.addIssue({code:'custom',path:['LOCK_TIMEOUT_SECONDS'],message:'Reserva deve comportar backoff máximo, timeouts de rede/banco e intervalo'});
});
export type Config = z.infer<typeof environmentSchema>;
export const loadConfig = (source: NodeJS.ProcessEnv = process.env): Config => environmentSchema.parse(source);
