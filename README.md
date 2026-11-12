# WhatsApp notification worker

Worker independente Node.js 24 LTS / TypeScript strict / Prisma 7.10.1, PostgreSQL Supabase e Evolution API V2 auto-hospedada. Não requer assinatura de API paga; hospedagem, domínio e operação da Evolution/VPS têm custos próprios. O worker não instala Baileys: a conexão WhatsApp pertence à Evolution.

Consome exclusivamente `public.notification`, tipo `WHATSAPP`, status `PENDENTE`. Não modifica o Next.js, não cria fila nem altera o schema. `SUCESSO` significa aceitação pela Evolution, não confirmação de entrega pelo WhatsApp. Não há garantia de entrega exatamente uma vez.

## Implementação e decisões

- Reserva transacional com `FOR UPDATE SKIP LOCKED`, incremento de `tentativas` e UUID por processo. Nenhuma transação permanece aberta durante HTTP.
- Ordenação por `data`, `created_at`, `id`. `data <= NOW()`, `tentativas < MAX_RETRIES`, ambos os campos de reserva nulos.
- `BATCH_SIZE` limita quantos itens um ciclo processa. A reserva é feita um item por vez, imediatamente antes do processamento, para não expirar o restante do lote esperando. Ciclos não se sobrepõem.
- Concorrência suportada nesta versão: **1** por processo, validada em ambiente. Múltiplos processos não reservam o mesmo registro, mas cada processo tem seu próprio intervalo entre envios. Para manter 1,5 s por instância Evolution, execute **uma réplica por instância**. Escalar exige rate limiter compartilhado ou instâncias separadas.
- Toda finalização exige ID, worker UUID, timestamp exato da reserva, `WHATSAPP`, `PENDENTE` e reserva não expirada. O token de timestamp trafega como texto PostgreSQL, preservando microssegundos.
- `to` e `data` nunca são alterados. `updated_at` continua sendo a hora real da alteração, nunca um agendamento futuro.
- API Key, destinatário e mensagens não aparecem nos logs por padrão. Erros externos são convertidos em códigos fixos; objetos Axios/Prisma nunca são registrados.
- Módulos pequenos separam configuração, persistência, envio, normalização, política e execução. Interfaces específicas (`NotificationRepository`, `MessageGateway`) permitem substituir implementações sem acoplamento à infraestrutura. SOLID é aplicado sem hierarquias ou classes adicionais sem finalidade.

### Retentativa e quarentena sem migration

| Situação | Ação |
| --- | --- |
| Falha no GET de conexão, autenticação no GET, instância desconectada ou falha antes do POST | Espera com reserva mantida; depois libera para `PENDENTE`. No limite, `ERRO`. |
| POST rejeitado explicitamente com 400/401/403/404/405/413/415/422 | `ERRO`, sem reenvio. Conferir autenticação/configuração. |
| Timeout, conexão interrompida, HTTP 408/429/5xx, resposta 2xx inválida ou destino divergente | Quarentena: mantém `PENDENTE` e a reserva, registra `QUARENTENA: ...`. |
| Evolution aceitou, mas a atualização SQL falhou/expirou | Mantém a reserva; tenta registrar a informação para reconciliação. Nunca reenvia automaticamente. |
| Processo morreu ou reserva expirou | Não reutiliza. Log de alerta e reconciliação manual. |
| Já `SUCESSO` ou `ERRO` | Nunca seleciona nem modifica. |

Backoff exponencial `base * 2^(tentativa-1)`, jitter adicional de até 25%, teto de 1 hora. O backoff fica em memória **com reserva durável mantida** até terminar; outro processo não pode antecipá-lo. O worker para o processamento serial durante essa espera. Se morrer na espera, o registro permanece bloqueado para revisão, mesmo que o POST ainda não tenha começado. Esse é o trade-off deliberado para não alterar schema nem reaproveitar timestamps. O Zod rejeita configurações cujo maior backoff não cabe na reserva com margem para HTTP/banco. Ao aumentar retries/backoff, aumente `LOCK_TIMEOUT_SECONDS` também.

Nenhuma recuperação automática de resultados incertos foi implementada. Para backoff persistente que sobreviva a reinício sem intervenção, a evolução mínima seria um campo `proxima_tentativa_em` e um marcador persistente de fase de envio. Isso exige revisão e autorização no projeto original; nenhuma migration está incluída/aplicada.

## Início rápido: Docker Desktop (macOS/Windows/Linux)

Instale Git e Docker Desktop pelo fornecedor e inicie o Docker. Windows: use WSL2. Verifique:

```bash
git --version
docker version
docker compose version
```

No diretório do projeto:

```bash
cp .env.example .env
chmod 600 .env
# Edite .env com conexão e Evolution reais antes de iniciar.
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f whatsapp-worker
```

O início do worker autoriza o processamento de **todas** as notificações elegíveis, não somente uma notificação de exemplo. Não inicie contra produção para fazer testes automatizados. `host.docker.internal` permite alcançar uma Evolution local no Docker Desktop; em produção use HTTPS com certificado confiável. Não desative TLS para contornar certificado.

```bash
docker compose restart whatsapp-worker
docker compose down
```

Não há portas expostas, PostgreSQL, Redis ou Evolution no Compose de produção. O container usa usuário `node`, filesystem somente leitura, `/tmp` temporário, sem capabilities, sem novos privilégios e logs rotacionados.

## Ubuntu 24.04 / Contabo desde o zero

Instale Docker Engine pelo repositório oficial. Confira as instruções atuais do fornecedor se sua imagem Ubuntu diferir:
[Docker Engine no Ubuntu](https://docs.docker.com/engine/install/ubuntu/).

```bash
sudo apt update
sudo apt install -y git ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<'DOCKER_APT'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
DOCKER_APT
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
git --version
```

Use `sudo docker` ou uma conta com acesso já administrado ao Docker. Participação no grupo `docker` equivale a privilégios administrativos; não é necessária para este projeto. Clone seu repositório privado ou transfira os arquivos deste diretório para a VPS. Execute os comandos Docker do início rápido, prefixando com `sudo` se necessário. Não publique `.env` no Git e não copie credenciais para Dockerfile/build args.

## Node.js: desenvolvimento e validação local

Use Node.js **24 LTS**, conforme `.nvmrc`, também usado no Docker. Se já usa nvm:

```bash
nvm install
nvm use
node --version
npm --version
npm ci
npm run generate
npm run build
npm test
npm audit
cp .env.example .env
# Preencha .env antes dos próximos comandos.
npm run check:db
npm run check:evolution
npm run dev
# Ou depois do build:
npm start
```

O projeto já está inicializado; não precisa executar `npm init` nem recriar o schema. Prisma 7 usa `prisma.config.ts` para a URL da CLI e `@prisma/adapter-pg` no runtime. `DIRECT_URL` é opcional e reservado à CLI, não usado para consumir a fila. Geração do client/build não acessam o banco. Não execute `prisma migrate`, `prisma db push` ou introspecção que sobrescreva este schema: ele é uma **projeção parcial** do original, sem relações alheias ao worker. A única relação omitida é `avisoAutomatizacao`, que não é consultada.

Prisma foi mantido na série 7.10 do sistema original e atualizado ao patch 7.10.1 para corrigir vulnerabilidades de dependências encontradas no 7.10.0. O lockfile fixa o grafo de dependências.

## Configuração

| Variável | Padrão / finalidade |
| --- | --- |
| `NODE_ENV` | `production`; HTTPS e PostgreSQL com verificação de certificado. `test` só para fixtures locais descartáveis. |
| `DATABASE_URL` | URL PostgreSQL do usuário dedicado, obrigatória. |
| `DIRECT_URL` | URL direta opcional para ferramentas Prisma; sem migrations automáticas. |
| `EVOLUTION_API_URL` | HTTPS da Evolution; sem usuário/senha/query/hash. |
| `EVOLUTION_API_KEY` | API Key do servidor/instância, obrigatória. |
| `EVOLUTION_INSTANCE` | Nome da instância: letras, dígitos, `_` e `-`. |
| `POLL_INTERVAL_MS` | 10000, pausa após cada ciclo. |
| `BATCH_SIZE` | 10 itens máximos por ciclo. |
| `MAX_CONCURRENT_SENDS` | 1; outros valores são rejeitados nesta versão. |
| `MAX_RETRIES` | 3 reservas/tentativas, inclusive falhas antes do envio. |
| `RETRY_BASE_DELAY_MS` | 30000. |
| `SEND_DELAY_MS` | 1500, intervalo mínimo entre inícios de POST no mesmo processo. |
| `REQUEST_TIMEOUT_MS` | 15000 para cada chamada HTTP. |
| `LOCK_TIMEOUT_SECONDS` | 120, prazo conservador de posse; expiração não libera o item. |
| `LOG_LEVEL` | `info`; também aceita trace/debug/warn/error/fatal/silent. |
| `PG_CA_FILE` | Caminho opcional para CA PostgreSQL confiável. |

PostgreSQL usa verificação de certificado (`rejectUnauthorized: true`) em `production` e `development`. Parâmetros SSL da URL são removidos para não sobrepor essa verificação; configure a CA correta em `PG_CA_FILE` se necessário. Em Docker, monte a CA somente leitura, por exemplo `/run/secrets/supabase-ca.crt`, e configure esse caminho. Não use `NODE_ENV=test` em produção.

## Supabase: conexão e validação sem escrita

Para backend persistente, use conexão direta IPv6 ou session pooler para VPS somente IPv4. Copie a URL de **Connect** no painel Supabase. Percent-encode caracteres especiais da senha. Prefira session mode a transaction mode para este processo persistente. Referência: [Conexões PostgreSQL Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

`npm run check:db` abre transação **READ ONLY**, lista nomes/tipos de colunas, valores dos enums e totais por tipo/status, sem conteúdo das mensagens ou escrita. Confira `NotificationType = WHATSAPP` e `NotificationStatus = PENDENTE, ERRO, SUCESSO`, além dos campos e índices do schema original. O script é uma inspeção; não altera/corrige esquema. Use uma conta administrada e dedicada; não reutilize a senha do superusuário para operação diária.

Permissões mínimas a serem concedidas pelo administrador, se autorizado (exemplo para uma role previamente criada; não são executadas pelo projeto):

```sql
GRANT CONNECT ON DATABASE postgres TO whatsapp_worker;
GRANT USAGE ON SCHEMA public TO whatsapp_worker;
GRANT USAGE ON TYPE public."NotificationType", public."NotificationStatus" TO whatsapp_worker;
GRANT SELECT ON public.notification TO whatsapp_worker;
GRANT UPDATE (status, tentativas, ultimo_erro, processando_em, worker_id, updated_at)
  ON public.notification TO whatsapp_worker;
```

Não dê INSERT, DELETE, DDL, superuser ou BYPASSRLS. Se RLS estiver habilitado, o administrador deve revisar/criar políticas SELECT/UPDATE específicas para a role e tipo `WHATSAPP`, com `USING` e `WITH CHECK`. Não desabilite RLS para solucionar acesso. Se existir isolamento por tenant não representado no modelo fornecido, revise o escopo antes de compartilhar esta role entre tenants. Todos os workers concorrentes precisam respeitar o mesmo protocolo de reserva; desative consumidores legados que enviem sem reservar.

## Evolution API V2 gratuita e auto-hospedada

Instale a edição auto-hospedada a partir do [repositório oficial](https://github.com/evolution-foundation/evolution-api), separadamente deste projeto. Fixe uma release/imagem compatível e siga seu Compose oficial para as dependências da Evolution. Este sistema utiliza Evolution API. A licença oficial atual prevê condições de atribuição e aviso de uso na documentação acessível aos administradores; preserve esses avisos e confira a licença da release escolhida ([licença oficial](https://github.com/evolution-foundation/evolution-api/blob/main/LICENSE)). Crie a instância `notificacoes` usando `WHATSAPP-BAILEYS`, conecte-a com QR Code e disponibilize a API por HTTPS autenticado. Redis/PostgreSQL eventualmente requeridos pela **Evolution** não fazem parte do Compose do **worker**.

A versão instalada não foi fornecida, portanto seu contrato exato ainda exige homologação. A documentação oficial está em [Evolution Foundation](https://docs.evolutionfoundation.com.br/evolution-api/index). Os antigos links `doc.evolution-api.com/v2/api-reference/...` retornaram 404; os contratos foram conferidos contra o código oficial atual:

- [Router sendText e retorno HTTP 201](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/routes/sendMessage.router.ts)
- [DTO com number e text no nível principal](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/dto/sendMessage.dto.ts)
- [Router de connectionState](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/routes/instance.router.ts)

`main` pode mudar. Antes de produção, compare esses contratos com a tag/imagem realmente instalada e seu OpenAPI. O client aceita `GET /instance/connectionState/{instance}` com `{"instance":{"state":"open"}}`. Envia `POST /message/sendText/{instance}` com header `apikey` e JSON `number`/`text`. A aceitação requer `key.id` não vazio, `key.remoteJid` igual ao grupo solicitado, `key.fromMe=true` e status `PENDING`, `SERVER_ACK`, `DELIVERY_ACK`, `READ` ou `PLAYED`. Uma resposta 2xx diferente fica em quarentena, não é considerada sucesso silenciosamente. Sem redirects e sem retries Axios.

### Teste controlado do grupo real

Com o worker parado, confirme na Evolution o ID do grupo desejado e que a conta conectada participa dele. A conversão de sufixo é sintática e não comprova pertencimento/identidade do grupo. Primeiro faça somente GET:

```bash
npm run check:evolution
```

Depois, somente quando quiser enviar uma mensagem real de teste ao grupo sob seu controle:

```bash
EVOLUTION_TEST_RECIPIENT=120363412284116447-group EVOLUTION_TEST_SEND=true npm run check:evolution
```

Esse comando **envia uma mensagem real**, mas não insere/altera notificações. Confirme visualmente o recebimento no grupo correto e guarde a versão da Evolution/imagem testada. Não use o ID de referência sem confirmar que é seu grupo. Não reexecute o INSERT de exemplo com `SUCESSO`.

Payload de exemplo (ilustrativo; header API Key vem do ambiente):

```json
{
  "number": "120363412284116447@g.us",
  "text": "✅ Mensagens Shopee\n\nConcluída.\n11/11, 17:27"
}
```

Quando o Next.js criar uma notificação nova elegível, o worker deverá reservá-la, converter `-group` para `@g.us`, enviar e persistir `SUCESSO` após aceitação. Valide também `worker_id` e `processando_em` nulos e `ultimo_erro` limpo. Essa homologação real depende das suas configurações e não foi feita automaticamente.

## Testes

Unitários e contrato HTTP usam Vitest e servidor HTTP local, sem Supabase nem WhatsApp reais:

```bash
npm test
```

Integração PostgreSQL usa uma base local **descartável**, com bloqueio obrigatório de URLs fora de `worker_test@localhost/worker_test`. A suíte recria tabela/enums de fixture e trunca registros. Nunca configure produção como `TEST_DATABASE_URL`. Requer build para testes do processo:

```bash
docker compose -p whatsapp-worker-tests -f docker-compose.test.yml up -d --wait
npm run build
TEST_DATABASE_URL=postgresql://worker_test:worker_test_local_only@127.0.0.1:55432/worker_test npm run test:integration
docker compose -p whatsapp-worker-tests -f docker-compose.test.yml down -v
```

São testados filtros, ordenação, precisão da reserva, SKIP LOCKED, 40 reservas concorrentes com dois Prisma clients, atualizações obsoletas, preservação de estados finais, backoff, máximo de tentativas, timeout, respostas inválidas, falha SQL após aceitação, SIGTERM, SIGKILL e reinício do processo sem duplicidade.

Teste adicional de **container** (Docker obrigatório), com fixtures isoladas de PostgreSQL/Evolution, sem ler `.env` de produção e sem expor portas:

```bash
npm run test:docker
```

Esse teste constrói a imagem, aguarda healthcheck, valida aceitação, reinicia o container, verifica `SUCESSO` com uma tentativa e apenas um POST aceito, removendo os containers ao terminar. Use uma rede com acesso às imagens oficiais e ao npm para o build.

## Logs e monitoramento

Exemplos ilustrativos:

```json
{"level":30,"workerId":"UUID","msg":"worker_starting"}
{"level":30,"msg":"database_connected"}
{"level":30,"connected":true,"msg":"evolution_state"}
{"level":30,"pending":4,"stale":0,"msg":"queue_status"}
{"level":30,"notificationId":"UUID","attempt":1,"msg":"notification_processing"}
{"level":30,"notificationId":"UUID","messageId":"ID","msg":"evolution_accepted"}
{"level":30,"notificationId":"UUID","status":"SUCESSO","attempt":1,"code":null,"msg":"notification_result"}
{"level":40,"notificationId":"UUID","code":"TRANSPORT_UNCERTAIN","recorded":true,"msg":"notification_quarantined"}
```

Monitore `queue_status.pending`, `queue_status.stale`, `notification_quarantined`, `cycle_failed`, `AUTHENTICATION` e ausência prolongada de `cycle_completed`. O healthcheck lê um arquivo atômico de progresso com prazo específico da operação atual; um timer independente não o mantém artificialmente saudável. Detecta processo morto, operação travada ou ciclo com falha SQL. Conexão Evolution degradada é reportada por logs, não implica necessariamente liveness quebrada.

**Docker Compose não reinicia um container só por ficar unhealthy**. `restart: unless-stopped` reinicia quando o processo termina ou o daemon volta. Configure alerta externo para unhealthy e investigue antes de reiniciar; reservas continuam bloqueadas. Falhas fatais na inicialização causam saída não zero e reinício. O worker atende SIGTERM/SIGINT, para novas reservas, aguarda POST já iniciado/finalização e desconecta Prisma. A parada tem limite interno de timeout HTTP + 30 segundos; o Compose concede 3 minutos.

```bash
docker compose ps
docker inspect --format '{{json .State.Health}}' whatsapp-notification-worker
docker compose logs --tail 100 whatsapp-worker
```

## Recuperação e reconciliação manual

1. Pare **todos** os consumidores da instância/tabela e confirme que nenhum POST está em andamento. Não libere reservas com workers ativos.
2. Liste somente metadados de pendências bloqueadas (consulta de leitura abaixo).
3. Compare ID, horário, grupo e evidências com os logs/histórico da Evolution. Uma reserva expirada não prova que a mensagem falhou.
4. Aceitação comprovada: um operador autorizado pode finalizar `SUCESSO`. Não aceitação comprovada e retry desejado: pode liberar para `PENDENTE`, respeitando `MAX_RETRIES`. Rejeição definitiva comprovada: `ERRO`.
5. Sem prova suficiente, **mantenha a reserva e o status**. Não zere tentativas nem libere tudo por idade. Se for necessário reenviar apesar da incerteza, isso é uma decisão manual com risco de duplicidade, fora da recuperação automática.

```sql
SELECT id, status, tentativas, processando_em, worker_id, ultimo_erro
FROM public.notification
WHERE tipo='WHATSAPP' AND status='PENDENTE'
  AND (processando_em IS NOT NULL OR worker_id IS NOT NULL OR tentativas>=3)
ORDER BY processando_em NULLS FIRST, id;
```

Exemplo de finalização **manual** somente após aceitação comprovada; substitua todos os valores por evidência real, inclusive timestamp com microssegundos. É apresentado para revisão, nunca executado pelo worker como recuperação:

```sql
BEGIN;
UPDATE public.notification
SET status='SUCESSO', processando_em=NULL, worker_id=NULL,
    ultimo_erro=NULL, updated_at=NOW()
WHERE id='UUID_REAL'::uuid AND worker_id='UUID_DA_RESERVA'::uuid
  AND processando_em='TIMESTAMP_EXATO_DA_RESERVA'::timestamptz
  AND tipo='WHATSAPP' AND status='PENDENTE';
-- Confira que exatamente uma linha foi alterada; caso contrário ROLLBACK.
COMMIT;
```

Para liberar após prova de não envio, use o mesmo predicado exato, `status='PENDENTE'`, ambos os campos de reserva nulos e motivo auditável em `ultimo_erro`; não altere `data`. Se tentativas já estiverem no limite, manter bloqueado até decisão explícita sobre eventual nova tentativa. Nunca execute UPDATE em massa para limpar reservas.

## Operação em produção, atualização e rollback

- Docker habilitado no boot e `restart: unless-stopped` mantêm inicialização automática. Após `docker compose down`, é necessário `up -d` novamente.
- Backup: guarde `.env`/CA/configuração em cofre criptografado, separado do Git e dos logs. O worker não armazena fila em disco; a fonte de verdade é o PostgreSQL, cujo backup pertence ao Supabase.
- Rotação: pare o worker, emita nova credencial/role na Evolution ou banco, atualize `.env`, execute validação de leitura/conexão, recrie o container, confirme logs e revogue a credencial antiga. `restart` não recarrega variáveis: use `up -d --force-recreate`.
- Atualização: execute testes e audit, pare o worker graciosamente, guarde a imagem anterior, obtenha a versão revisada, reconstrua e suba. Não há migrations de startup.

```bash
docker compose stop whatsapp-worker
docker image tag whatsapp-notification-worker:local whatsapp-notification-worker:rollback
# Atualize os arquivos usando a versão revisada do seu repositório.
docker compose build --pull
docker compose up -d --force-recreate
docker compose logs --tail 100 whatsapp-worker
```

Rollback sem alterar banco:

```bash
docker compose stop whatsapp-worker
docker image tag whatsapp-notification-worker:rollback whatsapp-notification-worker:local
# Restaure também configuração anterior compatível, se necessário.
docker compose up -d --no-build --force-recreate
```

Nenhuma atualização/rollback desbloqueia quarentenas. Confirme saúde e contadores após reinício, além de qualquer reconciliação necessária.

## Validação desta entrega

Consulte `docs/validation.md` para resultados executados e limites. Docker, Evolution real e grupo real só podem ser declarados homologados após testes nesses ambientes; aprovação local de build não comprova entrega WhatsApp.

## Instalação realizada na VM Contabo

Consulte [a configuração e os comandos da VM](docs/vm-installation.md). Essa instalação usa HTTPS privado sem domínio; opere o worker pelo helper documentado para carregar a rede e o certificado corretos.

## Envio de fotos e imagens

O worker aceita uma imagem JPEG ou PNG por notificação, até **5 MiB** decodificados. Não requer coluna nova nem migration. Notificações de texto existentes continuam usando `mensagem` normalmente.

Para imagem, grave em `mensagem` o prefixo literal `whatsapp:image:v1` seguido de uma quebra de linha e deste JSON:

```json
{"media":"BASE64_DO_ARQUIVO","mimetype":"image/jpeg","caption":"Legenda opcional"}
```

`media` contém somente o Base64 do arquivo completo, sem prefixo `data:`. Para PNG use `image/png`. O campo `caption` pode ser omitido; `titulo` e `caption` compõem a legenda final, limitada a 1.024 caracteres JavaScript. Exemplo no produtor da notificação (Node.js):

```js
import { readFile } from 'node:fs/promises';
const arquivo = await readFile('/caminho/foto.jpg');
const mensagem = 'whatsapp:image:v1\n' + JSON.stringify({
  media: arquivo.toString('base64'),
  mimetype: 'image/jpeg',
  caption: 'Confira os detalhes do produto.',
});
// Grave mensagem e titulo usando a mesma criação parametrizada de notificações.
```

O envio usa `POST /message/sendMedia/{instance}` com `mediatype=image`, conforme o [contrato da Evolution 2.3.7](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/dto/sendMessage.dto.ts). Não envia texto separado: a legenda pertence à imagem. São mantidas reserva, intervalo, validação de aceitação e quarentena de respostas ambíguas, sem fallback ou reenvio automático.

Por segurança, URLs, caminhos locais, SVG e data URIs não são aceitos. O worker verifica tamanho, codificação Base64 canônica e assinatura JPEG/PNG; isso não substitui decodificação completa ou análise antimalware no produtor. Payload inválido termina em `ERRO / INVALID_IMAGE_PAYLOAD` antes de acessar a Evolution. Não registre o Base64 nos logs. Considere o aumento de aproximadamente 33% no armazenamento pelo Base64 e limite o tamanho também no serviço que cria notificações.

Implementação validada com testes locais e servidor HTTP simulado; entrega de imagem no WhatsApp real ainda exige homologação. Não inicie o worker contra produção apenas para testar, pois ele consome todas as notificações elegíveis.
