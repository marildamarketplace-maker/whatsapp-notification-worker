# Validação

## 16/11/2026 — Redução de consultas ociosas

Executada com Node.js **24.22.3**, Prisma **7.10.1** e PostgreSQL **18.6** em cluster temporário local, acessível somente por loopback e encerrado após os testes.

| Verificação | Resultado |
| --- | --- |
| Geração do Prisma Client + build TypeScript | Passou |
| Tipagem dos fontes e testes (`tsc -p tsconfig.tests.json`) | Passou |
| Testes unitários e HTTP simulado | 116 passaram |
| Integração com PostgreSQL real local e processos do worker | 14 passaram |
| Build/lifecycle Docker e publicação na VM | Não executados nesta alteração |

Os novos testes cobrem a espera 10/20/40/60 segundos, teto configurável, retorno ao intervalo inicial após trabalho/falha, cadência das estatísticas e continuidade dos envios após falha de monitoramento. Também verificam cancelamento da espera, manutenção de reservas no desligamento, contagem UTF-8 de conteúdo incluindo imagens e ausência de conteúdo/destinatário nos novos logs.

O teste do cliente PostgreSQL confirma a identificação `whatsapp-notification-worker` e a preservação da verificação TLS mesmo com parâmetros conflitantes na URL. A suíte de integração confirma a identificação no servidor, reservas concorrentes sem duplicidade, SKIP LOCKED, quarentena e reinício sem reenvio. Os testes usaram credenciais e Evolution simuladas; o `.env` local não foi usado para enviar mensagens (a validação separada identificou `EVOLUTION_API_KEY` ausente).

Nenhuma migration, alteração de banco de produção ou publicação foi necessária/executada. O diagnóstico anterior consultou somente agregados do Supabase; a implementação foi validada em banco local. Os novos padrões entram em vigor após atualizar o código e recriar o container na VM. O efeito no egress faturado ainda precisa ser medido após essa atualização.

## Histórico — 11/11/2026

Executada localmente com Node.js **24.22.2**, TypeScript strict e Prisma **7.10.1**.

| Verificação | Resultado |
| --- | --- |
| Geração do Prisma Client + build TypeScript | Passou |
| Tipagem dos fontes e testes (`tsc -p tsconfig.tests.json`) | Passou |
| Vitest unitário + HTTP real contra servidor mock | 61 testes passaram |
| PostgreSQL real local: reserva, filtros, concorrência e processo | 12 testes passaram |
| `npm audit` | Zero vulnerabilidades reportadas |
| Build/lifecycle Docker | Passou na VM Contabo, incluindo reinício sem reenvio |
| Supabase de produção | Não acessado nem alterado |
| Evolution instalada / grupo WhatsApp real | API 2.3.7 instalada; HTTPS, pareamento, contrato de conexão e reconexão após recriação validados; envio no grupo ainda pendente |

O PostgreSQL usado nos testes foi um cluster temporário isolado, em loopback, com usuário/base `worker_test`. Não foi usado Supabase de produção. Dois Prisma clients executaram 40 tentativas concorrentes de reserva para 30 registros; nenhuma reserva duplicada. Os testes também mantiveram uma linha bloqueada em outra transação para verificar SKIP LOCKED real.

Dois testes executaram o JavaScript compilado em processos separados com Evolution mock e PostgreSQL real. Um verificou processamento, SIGTERM e reinício sem reenvio de SUCESSO. Outro matou o processo com SIGKILL após início do POST e verificou que o reinício não reutilizou a reserva desconhecida.

O teste Docker foi entregue em `scripts/test-docker.sh` e `docker-compose.smoke.yml`. O teste Docker foi posteriormente executado com sucesso na VM Contabo. Antes de produção, faça o teste controlado no grupo real descrito no README. Consulte `docs/vm-installation.md` para os detalhes da instalação.

O schema original e os produtores de notificações do projeto vizinho `sistema-producao-olist` foram lidos, sem modificações. A projeção Prisma contém somente a tabela e os enums necessários; nenhuma migration foi criada/aplicada. Prisma 7.10.0 do projeto original foi atualizado neste worker para o patch compatível 7.10.1, eliminando as vulnerabilidades reportadas inicialmente pelo npm audit.
