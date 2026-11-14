# Instalação na VM Contabo — 11/11/2026

Servidor: `62.171.129.214`, Ubuntu 24.04, usuário operacional `operador`.

## Serviços instalados

- Docker Engine e Compose pelo repositório oficial, Docker habilitado no boot.
- Repositório clonado em `/home/operador/whatsapp-notification-worker`, commit base `148f579`.
- Evolution API `evoapicloud/evolution-api:v2.3.7`, instância `notificacoes` / `WHATSAPP-BAILEYS`.
- PostgreSQL 15 e Redis 7 exclusivos da Evolution, com volumes persistentes.
- Caddy com CA privada e certificado para `evolution.internal`.
- Visualizador privado do QR Code, em `127.0.0.1:8765`.

Nenhuma porta pública foi aberta. API HTTP em `127.0.0.1:8080`; proxy HTTPS em `127.0.0.1:8443`. Worker e proxy se comunicam na rede Docker `evolution-worker-shared`.

As credenciais foram geradas na VM e guardadas em arquivos com modo 600. Não estão neste documento nem no Git. A política CORS permaneceu restrita a `https://evolution.internal`; o cliente Axios agora informa o Origin correspondente à URL configurada.

## Acesso

No Mac:

```bash
ssh operador@62.171.129.214
```

Visualizador do QR pelo Mac (mantenha o comando aberto):

```bash
ssh -N -L 127.0.0.1:18765:127.0.0.1:8765 operador@62.171.129.214
```

Depois abra `http://127.0.0.1:18765`. No navegador da própria VM: `http://127.0.0.1:8765`.

O visualizador atualiza o QR automaticamente e informa quando a instância chega a `open`. O pareamento ainda exige confirmação pelo celular. A instalação da API não comprova que o WhatsApp aceitou o dispositivo.

## Operação na VM

```bash
cd ~/evolution-api
sudo docker compose ps
sudo docker compose logs --tail 100 api
sudo docker compose restart api
```

Logs da Evolution podem conter informações do pareamento: não compartilhe os arquivos sem revisão.

Configuração privada do worker: `/home/operador/whatsapp-notification-worker/.env`. `DATABASE_URL` continua vazia: não foi copiada a credencial administrativa do projeto original nem iniciado consumo de produção. Preencha com uma conexão PostgreSQL autorizada, preferencialmente de role dedicada com SELECT e UPDATE necessários.

O certificado público da CA está em `/home/operador/.config/whatsapp-worker/evolution-root.crt`. O override em `compose.vm.yml` monta esse certificado e define `NODE_EXTRA_CA_CERTS`, mantendo verificação TLS habilitada.

Para operar o worker **após configurar banco e concluir pareamento/homologação**:

```bash
~/.config/whatsapp-worker/worker-compose up -d
~/.config/whatsapp-worker/worker-compose ps
~/.config/whatsapp-worker/worker-compose logs -f whatsapp-worker
~/.config/whatsapp-worker/worker-compose stop whatsapp-worker
```

O helper usa o Compose original e o override da VM. Não execute somente o Compose original nesta instalação, pois ele não inclui a rede/certificado privados. Iniciar o worker processa todas as notificações elegíveis.

Para reconstruir sem cache e recriar o worker quando necessário:

```bash
bash ~/whatsapp-notification-worker/recriar-worker.sh
```

O script atualiza a imagem base e ignora o cache de build em cada execução. Somente após o build passar ele recria o contêiner do worker, preservando a configuração da VM. Não apaga volumes, sessões do WhatsApp nem o cache de outros serviços. O script usa os arquivos locais atuais; não baixa alterações do repositório. Ao final, mostra o estado e os últimos logs; isso não comprova entrega de mensagens.

## Verificações executadas

- Build Docker do worker: passou.
- Smoke test com PostgreSQL e Evolution mock em containers descartáveis: passou, incluindo reinício e ausência de reenvio.
- HTTPS privado verificado pelo próprio container do worker: HTTP 200, Evolution 2.3.7.
- Contrato real de connectionState validado pelo cliente Axios do worker.
- Após o ajuste Origin: build e 61 testes locais passaram novamente.
- Supabase de produção não foi acessado/alterado; nenhum envio real foi disparado pelo worker.

O telefone recusou as tentativas iniciais de pareamento. Após reinicialização da API e nova tentativa pelo visualizador atualizado, o pareamento foi aceito; a causa inicial não foi comprovada. A Evolution retornou `open`, o cliente real do worker confirmou conexão por HTTPS e a sessão reconectou após recriação do container. Os logs temporários de diagnóstico foram restaurados para `LOG_BAILEYS=error`. A imagem instalada inclui Baileys `7.0.0-rc.9`. Ainda falta configurar o banco e homologar um envio controlado no grupo antes de ativar o consumo de produção.

Os ajustes locais do cliente Origin e do stdin do smoke test não foram publicados no GitHub automaticamente.
