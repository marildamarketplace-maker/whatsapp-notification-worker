# Validação — 11/11/2026

Executada localmente com Node.js **24.22.2**, TypeScript strict e Prisma **7.10.1**.

| Verificação | Resultado |
| --- | --- |
| Geração do Prisma Client + build TypeScript | Passou |
| Tipagem dos fontes e testes (`tsc -p tsconfig.tests.json`) | Passou |
| Vitest unitário + HTTP real contra servidor mock | 61 testes passaram |
| PostgreSQL real local: reserva, filtros, concorrência e processo | 12 testes passaram |
| `npm audit` | Zero vulnerabilidades reportadas |
| Build/lifecycle Docker | Não executado: Docker não instalado neste computador |
| Supabase de produção | Não acessado nem alterado |
| Evolution instalada / grupo WhatsApp real | Não homologado: instalação/configuração não fornecidas |

O PostgreSQL usado nos testes foi um cluster temporário isolado, em loopback, com usuário/base `worker_test`. Não foi usado Supabase de produção. Dois Prisma clients executaram 40 tentativas concorrentes de reserva para 30 registros; nenhuma reserva duplicada. Os testes também mantiveram uma linha bloqueada em outra transação para verificar SKIP LOCKED real.

Dois testes executaram o JavaScript compilado em processos separados com Evolution mock e PostgreSQL real. Um verificou processamento, SIGTERM e reinício sem reenvio de SUCESSO. Outro matou o processo com SIGKILL após início do POST e verificou que o reinício não reutilizou a reserva desconhecida.

O teste Docker foi entregue em `scripts/test-docker.sh` e `docker-compose.smoke.yml`. Não confundir reinício de processo validado com reinício de container ainda não executado. Antes de produção, execute esse teste e faça o teste controlado no grupo real descrito no README.

O schema original e os produtores de notificações do projeto vizinho `sistema-producao-olist` foram lidos, sem modificações. A projeção Prisma contém somente a tabela e os enums necessários; nenhuma migration foi criada/aplicada. Prisma 7.10.0 do projeto original foi atualizado neste worker para o patch compatível 7.10.1, eliminando as vulnerabilidades reportadas inicialmente pelo npm audit.
