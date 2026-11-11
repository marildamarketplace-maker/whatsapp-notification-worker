import pino from 'pino';
export const createLogger = (level: string) => pino({level, base: null,
  redact: {paths: ['apikey','password','DATABASE_URL','EVOLUTION_API_KEY','req.headers','config','message','text','mensagem','titulo','to'], censor:'[REDACTED]'},
});
