# EU-Sprachpipeline — Architektur- und Aufwandsübersicht

**Zweck:** Entscheidungsgrundlage für den Umbau von der heutigen Twilio-Lösung
(eingebaute Erkennung + Amazon-Polly-Stimme) auf eine möglichst EU-souveräne
Telefonie mit eigener Spracherkennung (Whisper) und wählbarer Sprachausgabe.

**Leitlinie des Nutzers:** Die ausgelieferten Auskünfte sind öffentlich und
nicht personenbezogen. Sensibel ist das **Aufnehmen der Stimme** (die
Erkennung). Deshalb: Anrufer-Audio so souverän wie möglich; bei der
Sprachausgabe ist ein US-Dienst notfalls vertretbar. „Je souveräner, desto
besser."

---

## 1. Kernidee

Heute erledigt Twilio Erkennung **und** Stimme; wir bekommen nur Text zu sehen.
Für eigene Erkennung und Stimme brauchen wir den **rohen Audiostrom** — das
bedeutet den Wechsel vom TwiML-Frage-Antwort-Modell zu einer **Echtzeit-Audio-
Verbindung** (WebSocket, Ton in beide Richtungen). Das ist der größte einzelne
Umbau im Projekt.

Das „Gehirn" bleibt unangetastet: `gespraechsschritt(text) → text` (Mistral +
Wissensbasis). Neu ist nur eine Ein-/Ausgabe-Schicht darum herum.

**Datenfluss (Zielbild):**

```
Anrufer ──(SIP)── Träger/Trunk ──(WebSocket-Audio)── unser Server
   │                                                     │
   │  1. Audio des Anrufers                              ▼
   │                                          Whisper (STT, EU)  ── Text
   │                                                     │
   │                                          gespraechsschritt (Mistral, EU)
   │                                                     │  ── Antworttext
   │                                          TTS (ElevenLabs US / EU)
   │  2. Stimme zurück                                   │  ── Audio
   ◄─────────────────────────────────────────────────────┘
                                              + Protokoll in gespraeche (STACKIT, EU)
```

**Souveränitäts-Kern:** Das **Anrufer-Audio verlässt die EU nie** (Whisper läuft
auf unserem EU-Server). Zu einem US-TTS ginge nur der **fertige Antworttext**
hinaus (öffentliche Auskunft, kein Anrufer-Audio). Damit bleibt die sensible
Aufnahme souverän — genau die vom Nutzer gezogene Linie.

---

## 2. Komponentenwahl je Funktion

| Funktion | Heute | EU-souveräner Zielzustand | Souveränität |
|---|---|---|---|
| Anschluss / Trunk | Twilio (US) | **sipgate** SIP-Trunk (DE) o. Telekom/easybell | hoch |
| Orchestrierung Audio | Twilio TwiML (US) | **Jambonz** self-hosted (EU-Server) o. FreeSWITCH/Asterisk | hoch |
| Spracherkennung (STT) | Twilio → Google/Amazon (US) | **Whisper** self-hosted (EU) | hoch |
| Sprachmodell (LLM) | Claude (US) | **Mistral** (Paris, EU) — bereits umgestellt | hoch |
| Sprachausgabe (TTS) | Amazon Polly (US) | **ElevenLabs** (US, nur Text raus) o. EU-TTS (Qualitätsabstand) | mittel/US |
| Datenbank | Neon (US-Firma, Frankfurt) | **STACKIT PostgreSQL Flex** (DE) — Treiber bereits umgestellt | hoch |
| Hosting | Laptop + Tunnel | Dauerhafter **EU-Server** mit fester Domain | hoch |

Der TTS-Punkt ist der einzige echte Kompromiss: Die besten deutschen Neural-
Stimmen kommen von US-Anbietern (ElevenLabs, Amazon, Google). Rein europäische
TTS (z. B. ReadSpeaker) gibt es mit spürbarem Qualitätsabstand. Da nur der
Antworttext hinausgeht, ist ElevenLabs hier vertretbar; volle Souveränität
kostet Stimmqualität.

---

## 3. Zwei Wege

**Weg A — Souveräner Stack (Empfehlung fürs Ziel).**
Jambonz auf einem EU-Server, deutscher SIP-Trunk (sipgate), Whisper und TTS als
Anbieter eingebunden. Wir besitzen den kompletten Audiopfad; kein US-CPaaS im
Weg. Mehr Betrieb (eigener Dienst, eigener Server), maximale Souveränität.

**Weg B — Managed Bridge (schneller Prototyp).**
Die Pipeline (WebSocket + Whisper + TTS) zuerst gegen eine Media-Streaming-
Brücke bauen, die Verkabelung hörbar validieren, den Träger erst beim Deployment
festlegen. Der Pipeline-Code ist trägerunabhängig; Weg B ist eine Vorstufe zu
Weg A, kein Sackgassen-Umweg.

Empfehlung: **Pipeline provider-unabhängig bauen (Weg B als Prototyp), Ziel ist
Weg A.** So gibt es früh ein hörbares Ergebnis, ohne die Souveränität aufzugeben.

---

## 4. Latenzbudget je Gesprächsrunde

Telefonie lebt von kurzen Antwortzeiten. Grobe, ehrliche Schätzung pro Runde
(Anrufer spricht → hört Antwort):

| Schritt | Ohne Streaming | Mit Streaming/Optimierung |
|---|---|---|
| Netz + Endpointing (Sprechpause erkennen) | 0,5–0,9 s | 0,3–0,6 s |
| Whisper STT (kurze Äußerung) | 0,3–1,5 s (GPU) / 1–3 s (CPU) | 0,3–0,8 s (GPU, teilw. streamend) |
| Mistral (mit Werkzeug-Schleife) | 3–7 s (large) / 2–4 s (small) | 2–4 s (small, Token-Streaming) |
| TTS (erstes Audio) | 0,5–2 s | 0,3–0,8 s (Streaming) |
| **Summe (Gefühl)** | **~4–8 s** | **erste Stimme ~2–4 s** |

**Konsequenzen:**
- Für Telefon ein kleines Modell bevorzugen: `ministral-14b-latest` (Standard, Gratis-Tarif, gemessen 3–5 s je Antwort inkl. Werkzeugen); `mistral-medium-latest` mit Bezahltarif, wenn Qualität es zwingt.
- Whisper mit GPU deutlich angenehmer als CPU.
- Token-Streaming (LLM) direkt in Streaming-TTS gibt das gefühlt schnellste Ergebnis.
- „Barge-in" (Anrufer unterbricht die Stimme): **Anforderung aus dem Live-Test** -
  ein Husten oder Räuspern darf die Ansage nicht abbrechen. Gewünscht: die
  Stimme spricht weiter, die Erkennung läuft parallel, und erst wenn die
  Äußerung als echte Rückfrage gilt (mehrere Wörter, Konfidenz über Schwelle),
  wird die Ansage gestoppt. Mit Twilio `<Gather>` nicht sauber möglich
  (Sprache unterbricht die Ansage immer; Ansage außerhalb von Gather ist
  gar nicht unterbrechbar). Jambonz kann es direkt: `bargein` mit
  `minBargeinWordCount` (z. B. 2) plus Konfidenzprüfung im eigenen Handler.
  In der eigenen WebSocket-Pipeline ohnehin selbst steuerbar.
- Antworten kurz halten (der System-Prompt tut das bereits: max. fünf Sätze).

---

## 5. Serveranforderungen

- **Whisper — Entscheidung: zuerst CPU, GPU nur bei Bedarf.** `faster-whisper`
  mit int8-Quantisierung, Modell `small` (Start) oder `medium` (bessere
  Qualität, langsamer). Erst wenn die gemessene Latenz stört, auf eine GPU
  (NVIDIA L4/T4, `large-v3-turbo`) wechseln — EU-GPU-Hoster: Hetzner, Scaleway,
  OVH; STACKIT-GPU prüfen.

  **Erste Messung (Laptop, Testballon):** Ryzen 7 7840U unter Docker Desktop
  (WSL2, alle 16 Threads zugeteilt), `onerahmet/openai-whisper-asr-webservice`,
  faster-whisper `small` int8, 5 s deutsche Sprache per HTTP-Upload:
  **3,0 s** je Aufruf, reproduzierbar (zwei Läufe), Transkript wortgenau
  inklusive Umlaut. Einordnung: für einen Anrufer brauchbar, aber oberhalb
  des Ziels von unter 2 s je Satz — und das bereits mit 16 Threads. Ein
  Server mit 8 vCPU wird kaum schneller sein; für 5 parallele Anrufer ist die
  CPU-Variante damit voraussichtlich zu knapp. Vor der GPU-Entscheidung noch
  zwei günstige Hebel prüfen: Thread-Einstellung des Dienstes (CTranslate2
  nutzt standardmäßig nicht alle Kerne) und Upload als WAV statt MP3 (spart
  das Dekodieren). In der echten Pipeline wird zudem in Stücken während des
  Sprechens erkannt, die gefühlte Wartezeit nach Satzende ist kürzer als die
  reine Rechenzeit.

**Sizing für den Piloten — Entscheidung: maximal 5 gleichzeitige Anrufer.**

| Größe | Ableitung aus „5 gleichzeitig" |
|---|---|
| SIP-Trunk-Kanäle | 6–8 buchen (5 Gespräche + Reserve für Auf-/Abbau) |
| Whisper auf CPU | 5 parallele Erkennungsströme: Start mit **8 vCPU**, Modell `small` int8; messen, bei Bedarf `medium` oder mehr Kerne |
| App + Jambonz | eine VM mit 2–4 vCPU reicht bei 5 Gesprächen bequem |
| Sprachmodell | 5 parallele Mistral-Anfragen liegen weit unter üblichen Ratenlimits |
| Datenbank | kleinste STACKIT-Instanz; ein Log-Eintrag je Runde ist vernachlässigbar |

Der Node-Server hält den Gesprächszustand je Anruf im Speicher; für 5
gleichzeitige Anrufer ist ein Prozess mehr als ausreichend. Erst mehrere
Instanzen hinter einem Lastverteiler bräuchten den Zustand in der Datenbank.
- **Jambonz:** bescheidene VM (wenige vCPU, einige GB RAM) plus SIP-Trunk.
- **App-Server (Node):** klein; kann mit Jambonz auf denselben Host.
- **Fester EU-Host** mit öffentlicher IP, Domain und TLS-Zertifikat (Let's
  Encrypt) — ersetzt Laptop + Tunnel.

---

## 6. Kosten (Größenordnungen, zu prüfen)

Keine belastbaren Endpreise, nur Rahmen zur Orientierung — vor Entscheidung je
Anbieter verifizieren.

| Posten | Modell | Rahmen |
|---|---|---|
| SIP-Trunk (sipgate) | Grundgebühr + Minutenpreis | einige € / Monat + Cent/Min |
| EU-GPU für Whisper | Instanz nach Laufzeit | dominanter Posten; €100er/Monat wenn dauerhaft an |
| Mistral (LLM) | pro Token | Cent-Bereich je Gespräch |
| ElevenLabs (TTS) | pro Zeichen / Abo | Abo-Stufen; alternativ EU-TTS |
| STACKIT PostgreSQL | pro Stunde Instanz + Speicher | zum Testen Cent–€; klein im Dauerbetrieb |
| EU-App/Jambonz-VM | pro Laufzeit | kleiner zweistelliger €-Bereich/Monat |

**Spar-Hebel:** Whisper CPU-only oder GPU nur bei Bedarf; `ministral-14b`;
EU-TTS statt ElevenLabs; DB und VMs klein dimensionieren.

### 6a. Preisziel: höchstens 50 ct je 10-Minuten-Gespräch (Stand September 2026, netto)

Recherchierte Listenpreise, überschlägig auf ein 10-Minuten-Gespräch mit etwa
5 Minuten Sprachausgabe (rund 5.000 Zeichen) und 8 Gesprächsrunden gerechnet:

| Posten | Twilio (heute) | sipgate flow (managed) | Jambonz + sipgate-Trunk (selbst gehostet) |
|---|---|---|---|
| Leitung | ca. 0,15 $ (1,5 ct/Min eingehend) | im Minutenpreis | 0 € (eingehend kostenfrei, Anrufer zahlt Festnetztarif) |
| Spracherkennung | ca. 0,20–0,30 $ | im Minutenpreis | 0 € variabel (Whisper) |
| Sprachausgabe | ca. 0,08 $ (Polly) | im Minutenpreis | 0,08 € (Azure-Klasse) bis 0,25 € (ElevenLabs Flash, 5 $/1 Mio Zeichen); 0 € bei eigener Stimme |
| Sprachmodell | ca. 0,02 € (ministral-14b: 0,20 $/1 Mio Tokens) | ca. 0,02 € | ca. 0,02 € |
| **variabel je Gespräch** | **ca. 0,45–0,55 €** | **0,69–0,99 €** (6,9–9,9 ct/Min je Paket; Small 249,95 €/2.500 Min) | **0,02–0,27 €** |
| Fixkosten je Monat | 0 | ab 249,95 € | Trunk 0–17 € („trunking 2“ ohne Grundgebühr, „trunking 10“ ~17 €) + Server 30–60 € (CPU) oder ~200 € (GPU) |

**Schluss:** sipgate flow verfehlt das Ziel in jedem Paket. Twilio liegt an
der Grenze und ist nicht souverän. Nur der selbst gehostete Weg kommt deutlich
darunter — bei 60 € Fixkosten und Azure-Stimme ab etwa 150 Gesprächen im Monat
unter 50 ct, bei 500 Gesprächen bei rund 22 ct; mit GPU-Server ab etwa 500
Gesprächen im Monat. Eigene Stimme statt Zukauf drückt den variablen Anteil auf
wenige Cent. → Träger: **Jambonz + sipgate trunking**, Whisper und möglichst die
Stimme auf dem eigenen Server. Der Trunk ist austauschbar (Standard-SIP, Nummer
portierbar); vollständig eigener Netzzugang ist nur als registrierter
Telekommunikationsanbieter möglich und für uns kein Ziel.

Quellen: sipgate.de/flow, sipgate.de/preise, sipgate.de/trunking,
pricepertoken.com (Mistral), elevenlabs.io/pricing/api, twilio.com/voice/pricing/de.

---

## 7. Datenschutz / DSGVO

- **Datenflüsse benennen:** Anrufer-Audio → Whisper (EU, bleibt). Transkript +
  Kontext → Mistral (EU). Antworttext → TTS (bei ElevenLabs: **US-Transfer des
  Antworttexts**, kein Anrufer-Audio). Protokoll → STACKIT (EU).
- **AVV je Auftragsverarbeiter:** SIP-Anbieter, Mistral, ggf. ElevenLabs, DB-
  Host. Bei US-Empfänger zusätzlich Transfermechanismus (EU-US Data Privacy
  Framework / SCC) prüfen.
- **Voller EU-Weg möglich:** EU-TTS statt ElevenLabs → gar kein US-Transfer,
  gegen Stimmqualität abgewogen.
- **Protokoll `gespraeche` — Einwilligung umgesetzt (Opt-in).** Nach der
  Sprachwahl fragt der Anruf: *„Zur Verbesserung unserer KI-gestützten Auskunft
  würden wir das Gespräch gerne schriftlich protokollieren. Drücken Sie die
  Eins, wenn Sie zustimmen, oder die Zwei, wenn Sie dies nicht wünschen."*
  (englische Fassung analog). Nur bei Taste 1 wird protokolliert; bei 2 oder
  keiner Taste läuft das Gespräch normal, aber ohne Log-Eintrag. Bewusst
  „schriftlich protokollieren", nicht „aufzeichnen": gespeichert wird Text,
  kein Ton — die Ansage muss dem entsprechen. Weiterhin nötig: **Löschfrist**
  und Zugriffsbeschränkung auf das Protokoll.
- **TOMs:** TLS überall, EU-Hosting, Zugriffskontrolle, Minimaldatenhaltung.

---

## 8. Aufwand & Reihenfolge

| Stufe | Inhalt | Aufwand (grob) |
|---|---|---|
| 1. Pipeline-Prototyp | WebSocket-Audio, Whisper-STT, TTS, Anbindung an `gespraechsschritt`; gegen Media-Bridge validieren | Tage |
| 2. Souveräner Träger | Jambonz auf EU-Server, sipgate-Trunk, Whisper/TTS produktiv einbinden | Tage–Woche + Betrieb |
| 3. Härtung & Deployment | Aufnahme-Ansage, Löschfrist, Zugriffsschutz, Monitoring, fester EU-Host + Domain | Tage |

Das heutige Twilio-MVP bleibt auf seinem Branch als Rückfall bestehen, bis die
EU-Pipeline steht.

---

## 9. Entscheidungen — Stand

**Getroffen:**

- **Sprachmodell:** Mistral (EU). Umgesetzt.
- **Datenbank:** Standard-Postgres bei STACKIT; Treiber umgestellt. Umgesetzt.
- **Erkennung:** Whisper selbst gehostet in der EU, **zuerst auf CPU**, GPU
  nur bei gemessenem Bedarf.
- **Sprachausgabe:** US-Dienst (ElevenLabs) vertretbar, da nur der Antworttext
  hinausgeht; EU-TTS bleibt die Option für volle Souveränität.
- **Sprachwahl:** Tastenmenü zu Gesprächsbeginn (1 Deutsch, 2 Englisch).
  Umgesetzt; Gegenprüfung über Whispers erkannte Sprache folgt in der Pipeline.
- **Einwilligung:** Opt-in per Taste 1 mit dem Wortlaut aus Abschnitt 7.
  Umgesetzt.
- **Gleichzeitige Anrufer im Piloten:** maximal 5 (Sizing in Abschnitt 5).
- **Träger:** direkt **Jambonz + sipgate trunking**, ohne Zwischenstufe über
  Twilio Media Streams. sipgate flow (managed, EU) wurde geprüft und wegen
  des Preisziels verworfen (Abschnitt 6a). Jambonz-Adapter umgesetzt
  (`server/jambonz.mjs`), Gesprächslogik trägerunabhängig (`server/dialog.mjs`).
- **Preisziel:** höchstens 50 ct je 10-Minuten-Gespräch; nur selbst gehostet
  erreichbar (Abschnitt 6a).
- **Testreihenfolge:** (1) Adapter-Tests ohne Anlage, (2) Softphone direkt
  gegen Jambonz auf dem Server ohne Telefonnetz, (3) erst dann Trunk +
  Rufnummer („trunking 2“ für den Test, „trunking 10“ für 5 Anrufer).

**Noch offen:**

1. **Deployment-Ziel:** welcher EU-Host für App, Jambonz und Whisper —
   STACKIT (Wunsch) oder Hetzner (schnell, stundengenau). Start: 4 vCPU,
   8 GB, **100 GB Platte, Debian 12** (Jambonz-Mini gibt es als Paket nur
   dafür, kein Ubuntu), öffentliche IPv4, eine Subdomain mit drei A-Records.
   Vollständiger Ablauf: `docs/server-runbook.md`.
2. **Stimme:** ElevenLabs (Zukauf, ~25 ct je Gespräch) oder eigene Stimme auf
   dem Server (wenige Cent, mehr Betrieb). Entscheidet über den variablen
   Preis je Gespräch.
3. **Whisper-Sizing:** Laptop-Messung 3,0 s je 5-s-Satz mit 16 Threads;
   auf dem Server mit Telefon-Audio neu messen, dann CPU- oder GPU-Entscheid.
4. **Löschfrist** für das Gesprächsprotokoll (Vorschlag: 90 Tage) und
   Zugriffsbeschränkung.
5. **Webhook-Signatur:** Header-Format gegen eine echte Jambonz-Installation
   verifizieren, bevor `JAMBONZ_WEBHOOK_SECRET` scharf geschaltet wird.

---

*Stand: 2026-09-09. Grundlage für die weitere Umsetzung auf Branch
`eu-variante`. Kostenangaben sind Größenordnungen, keine Angebote — vor
Entscheidung je Anbieter verifizieren.*
