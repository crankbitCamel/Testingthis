# Server-Fahrplan: Jambonz + sipgate + Whisper auf einem EU-Server

Ziel: eine Rufnummer aus dem deutschen Festnetz landet auf unserer eigenen
Telefonanlage (Jambonz), Erkennung läuft über unser Whisper, Antworten kommen
von Mistral, das Protokoll liegt in unserem Postgres. Alles auf **einer**
Maschine. Reihenfolge ist wichtig: erst Anlage, dann Softphone-Test, dann Trunk.

Stand: September 2026. Quellen: docs.jambonz.org (Debian-Paket, Carriers,
Custom Speech API), help.sipgate.de (trunking).

---

## 0. Was du bestellst

| Was | Anforderung | Warum |
|---|---|---|
| Server | **Debian 12 (bookworm)**, amd64, 4 vCPU, 8 GB RAM, **100 GB** SSD, öffentliche IPv4 | Jambonz-Mini gibt es als Debian-Paket nur für Debian 12 — **kein Ubuntu**. 100 GB verlangt das Paket (Datenbank, Aufzeichnungen, Metriken). |
| Domain | eine Subdomain, z. B. `telefon.datenfieber.de` | Jambonz-Portal braucht drei DNS-Namen (siehe Schritt 2). |
| sipgate trunking 2 | vorhanden | Rufnummer + SIP-Zugang. |
| ElevenLabs-Konto | API-Key | Stimme, bis eine eigene Stimme läuft. |

Hetzner: CX32 (4 vCPU, 8 GB, 80 GB) reicht knapp nicht wegen der 100 GB —
**CPX31** oder CX32 mit zusätzlichem Volume, oder gleich CCX23. Bei der
Bestellung Debian 12 wählen und deinen SSH-Public-Key hinterlegen.

## 1. Erster Login, Grundschutz

```bash
ssh root@<SERVER-IP>
apt-get update && apt-get install -y ufw git curl
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 5060/udp
ufw allow 5060/tcp
ufw allow 5061/tcp
ufw allow 8443/tcp
ufw allow 40000:60000/udp      # RTP (Sprachdaten) — Bereich von Jambonz
ufw enable
```

App (4115), Whisper-Brücke (4116), Whisper (9000) und Postgres (5432) bleiben
**geschlossen**: Jambonz läuft auf derselben Maschine und erreicht sie über
`127.0.0.1`. `docker-compose.yml` bindet alle Ports standardmäßig an
`127.0.0.1` (`BIND_ADDR`); die Überlagerung setzt bewusst keine Ports, weil
Compose Portlisten aneinanderhängt statt sie zu ersetzen. Docker umgeht
zudem die ufw-Regeln, deshalb nach dem Start prüfen, dass kein Dienst auf
`0.0.0.0` lauscht:

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml --profile app config | grep -E 'host_ip|published'
ss -tlnp | grep -E '4115|4116|5432|9000'     # jede Zeile muss 127.0.0.1 zeigen
```

## 2. DNS

Drei A-Records auf die Server-IP, z. B. für `telefon.datenfieber.de`:

```
telefon.datenfieber.de            A  <SERVER-IP>
api.telefon.datenfieber.de        A  <SERVER-IP>
grafana.telefon.datenfieber.de    A  <SERVER-IP>
```

Vor Schritt 3 prüfen, dass sie auflösen: `dig +short telefon.datenfieber.de`.

## 3. Jambonz installieren (Debian-Paket)

Skript `deploy/jambonz-installieren.sh` enthält genau diese Befehle:

```bash
export JAMBONES_PORTAL_DOMAIN=telefon.datenfieber.de
bash deploy/jambonz-installieren.sh
```

Danach prüfen:

```bash
systemctl --no-pager list-units 'jambonz-*' --all
curl -sI http://localhost/ | head -1        # HTTP/1.1 200
jambonz health
```

TLS fürs Portal (nach DNS):

```bash
certbot --nginx -d telefon.datenfieber.de -d api.telefon.datenfieber.de -d grafana.telefon.datenfieber.de
```

Portal: `https://telefon.datenfieber.de`, Login `admin` / `admin`, Passwort
wird beim ersten Login geändert.

## 4. Unsere App, Postgres, Whisper, Whisper-Brücke

Skript `deploy/server-einrichten.sh` macht: Docker installieren, Repository
klonen, `.env` anlegen, Container starten, Wissensbasis importieren.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/crankbitcamel/Testingthis/eu-variante/deploy/server-einrichten.sh)
```

Oder von Hand:

```bash
apt-get install -y docker.io docker-compose-v2
git clone -b eu-variante https://github.com/crankbitcamel/Testingthis.git /opt/verwaltung
cd /opt/verwaltung
cp .env.example .env && nano .env            # Geheimnisse eintragen
docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml --profile app up -d
docker compose exec app npm run db:import
```

Prüfen:

```bash
curl -s http://127.0.0.1:4115/api/health     # {"ok":true,"index":{"ok":true},"datenbank":{"ok":true},...}
curl -s http://127.0.0.1:4115/api/status     # {"llm":"bereit","anbieter":"mistral",...}
curl -s http://127.0.0.1:4116/status         # {"dienst":"whisper-bruecke","whisper":"erreichbar",...}
docker compose ps                            # alle Dienste "healthy"
```

Metriken für das mitinstallierte Grafana: `curl -s http://127.0.0.1:4115/metrics`
(Prometheus-Format: Rundendauer je Kanal, Mistral-Anfragen nach Status,
Erkennungsdauer, aktive Anrufe). In Telegraf/Prometheus als Scrape-Ziel
`http://127.0.0.1:4115/metrics` eintragen.

Weiterleitung an Menschen (Taste 0 und Werkzeug des Modells): in `.env`
`TELEFON_WEITERLEITUNG_NUMMER=+49...` und optional
`TELEFON_WEITERLEITUNG_ZEITEN="Mo-Fr 08:00-16:00"` setzen. Ohne Nummer hört
der Anrufer einen Hinweis statt einer Zusage. Jambonz wählt über den
sipgate-Trunk (Ausgehend ab 0,5 ct/min).

Ist das Repository privat, vorher einen Deploy-Key anlegen:
`ssh-keygen -t ed25519 -f /root/.ssh/deploy -N ""`, den `.pub`-Inhalt unter
GitHub → Repository → Settings → Deploy keys eintragen, und mit
`GIT_SSH_COMMAND="ssh -i /root/.ssh/deploy" git clone git@github.com:crankbitcamel/Testingthis.git`
klonen.

## 5. Jambonz-Portal konfigurieren

Alles unter `https://telefon.datenfieber.de`.

**a) Speech → Add speech credential**

1. Vendor **Custom**, Label `whisper`, URL `ws://127.0.0.1:4116/stt`,
   API key = Wert von `WHISPER_BRUECKE_TOKEN` aus `.env`. Das ist unser
   Erkenner. Jambonz spricht ihn intern an, deshalb `ws://`, nicht `wss://`.
2. Vendor **ElevenLabs**, API key eintragen. Stimme später in der App per
   `JAMBONZ_STIMME_DE` (Voice-ID) wählen.

**b) Applications → Add application**

| Feld | Wert |
|---|---|
| Name | Verwaltungsassistent |
| Calling webhook | `http://127.0.0.1:4115/api/jambonz`, POST |
| Call status webhook | `http://127.0.0.1:4115/api/jambonz/status`, POST |
| Speech synthesis vendor | ElevenLabs, language de-DE |
| Speech recognizer vendor | `custom:whisper`, language de-DE |

Webhook-Secret: Die App lehnt Jambonz-Webhooks ohne gültige Signatur ab.
Für den allerersten Test gegen die frische Installation `JAMBONZ_OHNE_SIGNATUR=1`
in `.env` setzen (die App ist nur auf 127.0.0.1 erreichbar). Sobald der
erste Anruf durch ist: Secret im Portal setzen, denselben Wert als
`JAMBONZ_WEBHOOK_SECRET` eintragen, `JAMBONZ_OHNE_SIGNATUR` entfernen,
App neu starten, Anruf wiederholen. Im App-Log erscheint bei falscher
Signatur eine 403-Zeile, dann das Header-Format prüfen (Schritt 6c).

**c) Softphone-Test ohne Telefonnetz**

Noch vor dem Trunk: Jambonz nimmt SIP-Anrufe direkt an. Im Portal einen
SIP-Client anlegen (Clients → Add client, Benutzername/Passwort), dann auf dem
Handy Linphone installieren, Konto: Benutzer wie angelegt, Domain
`telefon.datenfieber.de`, Transport UDP oder TLS. Anrufziel: die Application
kann im Portal einer Testnummer zugeordnet werden (Phone numbers → Add, z. B.
`1000`, Application = Verwaltungsassistent). Anruf auf `1000` → Sprachmenü.

Wenn das läuft, ist alles außer dem Trunk bewiesen.

## 6. sipgate-Trunk eintragen

Zugangsdaten aus dem sipgate-Portal (login.sipgate.com → Accountverwaltung →
Trunks → Name der Anlage): **SIP-ID** (endet auf `t0`), **SIP-Passwort**,
Rufnummer.

**a) Carriers → Add carrier**

| Feld | Wert |
|---|---|
| Name | sipgate |
| Trunk type | **Registration trunk** |
| Outbound & Registration → Authentication | an; Username = SIP-ID, Password = SIP-Passwort |
| Require SIP Register | an; SIP realm `sipgate.de` |
| Outbound SIP gateway | `sip.sipgate.de`, Port 5060, UDP |
| Inbound SIP gateway | `sip.sipgate.de` und `sipgate.de` (Anrufe kommen von sipgates Vermittlungsservern; falls Jambonz einzelne IPs verlangt, die aufgelösten Adressen von `sip.sipgate.de` eintragen und nach dem ersten Anruf im Jambonz-Log die tatsächliche Absender-IP nachtragen) |
| E.164 syntax | an — sipgate signalisiert die gewählte Nummer vollständig im E.164-Format |
| Codecs | G.711a bevorzugt (sipgate: G.722, OPUS, G.711a/u); DTMF RFC 2833 |

sipgate verlangt keine IP-Freischaltung für Registrierungs-Trunks; die
Registrierung selbst ist die Authentifizierung. RTP von sipgate kommt aus
15000–30000/UDP — ausgehend erlaubt ufw das ohnehin.

**b) Phone numbers → Add phone number**

Nummer im E.164-Format ohne `+`, z. B. `4930123456`, Carrier sipgate,
Application Verwaltungsassistent.

**c) Erster echter Anruf**

Mit dem Handy die sipgate-Nummer anrufen. Auf dem Server parallel:

```bash
journalctl -u jambonz-feature-server -f          # Anruf, Webhooks
docker compose logs -f app                        # unsere Zeilen: jambonz anruf ..., eingabe jambonz ...
docker compose logs -f whisper-bruecke            # Erkennung
```

Kommt der Anruf nicht an: `journalctl -u jambonz-sbc-inbound -f` zeigt, ob
sipgate überhaupt anklopft und ob die Absender-IP als Carrier erkannt wird.
Signatur-Header der Webhooks in den App-Logs prüfen, dann
`JAMBONZ_WEBHOOK_SECRET` scharf schalten.

## 7. Messen und entscheiden

- Whisper-Latenz je Satz mit Telefon-Audio: `docker compose logs whisper-bruecke`
  plus `journalctl -u jambonz-feature-server` (Zeit zwischen Sprechende und
  Transkript). Ziel unter 2 s. Sonst: `ASR_MODEL` verkleinern, Threads
  hochsetzen, oder GPU-Server für Whisper.
- Gesamtlatenz bis zur Stimme: unsere Logzeile `dauer_ms` im Protokoll.
- Fünf parallele Anrufer erst nach den Einzelmessungen.

## 8. Betrieb

```bash
cd /opt/verwaltung && git pull && docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml --profile app up -d
docker compose exec app npm run db:import      # nach Änderungen an der Wissensbasis
docker compose exec app npm run gespraeche     # Protokoll ansehen
sudo jambonz upgrade                            # Jambonz aktualisieren (vorher mysqldump, siehe Doku)
```

Sicherung: `docker compose exec postgres pg_dump -U verwaltung verwaltung > sicherung.sql`.
Löschfrist fürs Protokoll (Entscheidung offen, Vorschlag 90 Tage) später als
Cron-Job: `DELETE FROM gespraeche WHERE zeit < now() - interval '90 days'`.
