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
  umask 077
  cp .env.example .env
  TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)"
  sed -i "s/^WHISPER_BRUECKE_TOKEN=.*/WHISPER_BRUECKE_TOKEN=${TOKEN}/" .env
  # Erster Test gegen die frische Jambonz-Installation ohne Signatur; nach dem
  # ersten Anruf Secret setzen und diese Zeile entfernen (docs/server-runbook.md, 5b).
  sed -i "s/^JAMBONZ_OHNE_SIGNATUR=.*/JAMBONZ_OHNE_SIGNATUR=1/" .env
  chmod 600 .env
  echo "   .env angelegt (nur root lesbar). WHISPER_BRUECKE_TOKEN gesetzt - Wert mit"
  echo "   'grep WHISPER_BRUECKE_TOKEN .env' anzeigen und in Jambonz als API key des"
  echo "   Custom-Vendors 'whisper' eintragen."
  echo "   Jetzt MISTRAL_API_KEY (und ggf. Stimmen) in .env eintragen: nano .env"
else
  chmod 600 .env
  echo "   .env vorhanden, unveraendert."
fi

echo "== Container"
$COMPOSE pull --quiet postgres whisper || true
$COMPOSE build --quiet
$COMPOSE up -d
echo "   warte auf Postgres ..."
for _ in $(seq 1 30); do
  if $COMPOSE exec -T postgres pg_isready -U verwaltung -d verwaltung >/dev/null 2>&1; then break; fi
  sleep 2
done
echo "   warte auf Whisper (laedt beim ersten Start das Modell, bis zu 5 Minuten) ..."
for _ in $(seq 1 100); do
  if curl -fs -m 4 http://127.0.0.1:9000/docs >/dev/null 2>&1; then break; fi
  sleep 3
done
# Warmup: erste Erkennung dauert laenger (Modell in den Speicher); eine
# Sekunde Stille genuegt, damit der erste Anrufer nicht darauf wartet.
python3 - <<'PY' 2>/dev/null || true
import struct, urllib.request, io
pcm = b"\x00\x00" * 8000
wav = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16) + b"data" + struct.pack("<I", len(pcm)) + pcm
grenze = "----warmup"
body = (f"--{grenze}\r\nContent-Disposition: form-data; name=\"audio_file\"; filename=\"w.wav\"\r\nContent-Type: audio/wav\r\n\r\n").encode() + wav + f"\r\n--{grenze}--\r\n".encode()
req = urllib.request.Request("http://127.0.0.1:9000/asr?task=transcribe&language=de&output=json", data=body, headers={"Content-Type": f"multipart/form-data; boundary={grenze}"})
urllib.request.urlopen(req, timeout=120).read()
print("   Whisper warm.")
PY

echo "== Wissensbasis importieren"
$COMPOSE exec -T app npm run --silent db:import || echo "   Import fehlgeschlagen - spaeter erneut: $COMPOSE exec app npm run db:import"

echo
echo "== Status"
curl -s http://127.0.0.1:4115/api/status || true; echo
curl -s http://127.0.0.1:4116/status || true; echo
echo
echo "Fertig. Naechster Schritt: docs/server-runbook.md, Abschnitt 5 (Jambonz-Portal)."
