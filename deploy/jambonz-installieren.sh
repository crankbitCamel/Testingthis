#!/usr/bin/env bash
# Jambonz-Mini auf Debian 12 installieren (offizielles Debian-Paket).
# Befehle wie in docs.jambonz.org/self-hosting/bare-metal-vps/debian-package.
#
#   export JAMBONES_PORTAL_DOMAIN=telefon.example.de
#   bash deploy/jambonz-installieren.sh
#
# Voraussetzungen: Debian 12 (bookworm), root, oeffentliche IPv4, DNS fuer
# <domain>, api.<domain>, grafana.<domain> zeigt auf diesen Server.
set -euo pipefail

if [[ -z "${JAMBONES_PORTAL_DOMAIN:-}" ]]; then
  echo "Bitte JAMBONES_PORTAL_DOMAIN setzen, z. B. export JAMBONES_PORTAL_DOMAIN=telefon.example.de" >&2
  exit 1
fi
if ! grep -q 'bookworm' /etc/os-release; then
  echo "Jambonz-Mini gibt es als Paket nur fuer Debian 12 (bookworm). Gefunden:" >&2
  grep PRETTY_NAME /etc/os-release >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg systemd

install -d /etc/apt/keyrings

# 1) jambonz
curl -fsSL https://jambonz-debian-packages.s3.us-east-2.amazonaws.com/jambonz.gpg \
  | gpg --dearmor -o /etc/apt/keyrings/jambonz.gpg
echo "deb [signed-by=/etc/apt/keyrings/jambonz.gpg] https://jambonz-debian-packages.s3.us-east-2.amazonaws.com/debian bookworm main" \
  > /etc/apt/sources.list.d/jambonz.list

# 2) InfluxData (Metriken)
curl -fsSL https://repos.influxdata.com/influxdata-archive.key \
  | gpg --dearmor -o /etc/apt/keyrings/influxdata.gpg
echo "deb [signed-by=/etc/apt/keyrings/influxdata.gpg] https://repos.influxdata.com/debian stable main" \
  > /etc/apt/sources.list.d/influxdata.list

# 3) NodeSource (Node 22)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -

# 4) Grafana
curl -fsSL https://apt.grafana.com/gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
  > /etc/apt/sources.list.d/grafana.list

apt-get update

# Kernel-Header (fuer die Medienkomponenten), dann das Paket.
apt-get install -y "linux-headers-cloud-$(dpkg --print-architecture)" \
  || apt-get install -y "linux-headers-$(uname -r)"
JAMBONES_PORTAL_DOMAIN="$JAMBONES_PORTAL_DOMAIN" apt-get install -y jambonz-mini

echo
echo "=== systemd units ==="
systemctl --no-pager list-units 'jambonz-*' --all
echo "=== webapp ==="
curl -sI http://localhost/ | head -1
echo
echo "Portal: http://${JAMBONES_PORTAL_DOMAIN}  (admin / admin, beim ersten Login aendern)"
echo "TLS:    certbot --nginx -d ${JAMBONES_PORTAL_DOMAIN} -d api.${JAMBONES_PORTAL_DOMAIN} -d grafana.${JAMBONES_PORTAL_DOMAIN}"
