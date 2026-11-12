#!/usr/bin/env bash
set -euo pipefail
# Compose exec must not consume commands from a parent SSH provisioning script.
exec </dev/null
# Entirely isolated Compose project; no production .env is loaded.
compose=(docker compose -p whatsapp-worker-smoke --env-file /dev/null -f docker-compose.smoke.yml)
cleanup() { "${compose[@]}" down -v --remove-orphans; }
trap cleanup EXIT
"${compose[@]}" up -d --build --wait --wait-timeout 180
for attempt in $(seq 1 60); do
  result=$("${compose[@]}" exec -T postgres psql -U worker_test -d worker_test -Atc "SELECT count(*) FROM notification WHERE status='SUCESSO';")
  if [ "$result" = "1" ]; then break; fi
  sleep 1
done
[ "$result" = "1" ]
"${compose[@]}" restart worker
sleep 5
result=$("${compose[@]}" exec -T postgres psql -U worker_test -d worker_test -Atc "SELECT count(*) FROM notification WHERE status='SUCESSO' AND tentativas=1;")
[ "$result" = "1" ]
# Mock rejects duplicate sends. Exactly one acceptance must have been logged.
count=$("${compose[@]}" logs mock | awk '/MOCK_ACCEPTED/ {count++} END {print count+0}')
[ "$count" = "1" ]
printf '%s\n' 'Docker lifecycle smoke test passed: acceptance, graceful restart, no resend.'
