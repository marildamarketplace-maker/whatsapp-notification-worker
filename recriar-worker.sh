#!/usr/bin/env bash
set -Eeuo pipefail

# Usa a rede e o certificado privados configurados na VM.
compose_helper="${HOME}/.config/whatsapp-worker/worker-compose"

if [[ ! -x "$compose_helper" ]]; then
  printf 'Helper da VM não encontrado ou sem permissão de execução: %s\n' "$compose_helper" >&2
  exit 1
fi

trap 'printf "Falha ao atualizar o worker. Confira a saída acima antes de tentar novamente.\n" >&2' ERR

printf 'Reconstruindo o worker sem cache e atualizando a imagem base...\n'
"$compose_helper" build --pull --no-cache whatsapp-worker

printf 'Recriando o contêiner com a nova imagem...\n'
"$compose_helper" up -d --no-deps --force-recreate whatsapp-worker

"$compose_helper" ps
"$compose_helper" logs --tail 50 whatsapp-worker
printf '\nRecriação concluída. Confira o estado e os logs acima para validar a operação.\n'
