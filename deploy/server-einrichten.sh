#!/usr/bin/env bash
# Unsere Dienste auf dem Server einrichten: Docker, Repository, .env, Container,
# Wissensbasis. Jambonz wird separat installiert (deploy/jambonz-installieren.sh).
#
#   bash deploy/server-einrichten.sh            # aus dem geklonten Repository
#   bash <(curl -fsSL https://raw.githubusercontent.com/crankbitcamel/Testingthis/eu-variante/deploy/server-einrichten.sh)
#
# Idempotent: darf mehrfach laufen (aktualisiert dann nur).
set -euo pipefail

ZIEL="${VERWALTUNG_DIR:-/opt/verwaltung}"
REPO="${VERWALTUNG_REPO:-https://github.com/crankbitcamel/Testingthis.git}"
ZWEIG="${VERWALTUNG_ZWEIG:-eu-variante}"
COMPOSE="docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml --profile app"

echo "== Docker"
if ! command -v docker >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq docker.io docker-compose-v2 git curl
  systemctl enable --now docker
fi

echo "== Repository ($ZWEIG) nach $ZIEL"
if [[ -d "$ZIEL/.git" ]]; then
  git -C "$ZIEL" pull --ff-only
else
  git clone -b "$ZWEIG" "$REPO" "$ZIEL"
fi
cd "$ZIEL"

echo "== .env"
if [[ ! -f .env ]]; then
  cp .env.example .env
  TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)"
  sed -i "s/^WHISPER_BRUECKE_TOKEN=.*/WHISPER_BRUECKE_TOKEN=${TOKEN}/" .env
  echo "   .env angelegt. WHISPER_BRUECKE_TOKEN gesetzt: ${TOKEN}"
  echo "   -> in Jambonz als API key des Custom-Vendors 'whisper' eintragen."
  echo "   Jetzt MISTRAL_API_KEY (und ggf. Stimmen) in .env eintragen: nano .env"
else
  echo "   .env vorhanden, unveraendert."
fi

echo "== Container"
$COMPOSE pull --quiet postgres whisper || true
$COMPOSE up -d --build
echo "   warte auf Postgres ..."
for _ in $(seq 1 30); do
  if $COMPOSE exec -T postgres pg_isready -U verwaltung -d verwaltung >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "== Wissensbasis importieren"
$COMPOSE exec -T app npm run --silent db:import || echo "   Import fehlgeschlagen - spaeter erneut: $COMPOSE exec app npm run db:import"

echo
echo "== Status"
curl -s http://127.0.0.1:4115/api/status || true; echo
curl -s http://127.0.0.1:4116/status || true; echo
echo
echo "Fertig. Naechster Schritt: docs/server-runbook.md, Abschnitt 5 (Jambonz-Portal)."
