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
- Für Telefon `mistral-small-latest` bevorzugen; `large` nur wenn Qualität es zwingt.
- Whisper mit GPU deutlich angenehmer als CPU.
- Token-Streaming (LLM) direkt in Streaming-TTS gibt das gefühlt schnellste Ergebnis.
- „Barge-in" (Anrufer unterbricht die Stimme) ist eine spätere Komfortstufe.
- Antworten kurz halten (der System-Prompt tut das bereits: max. fünf Sätze).

---

## 5. Serveranforderungen

- **Whisper — Entscheidung: zuerst CPU, GPU nur bei Bedarf.** `faster-whisper`
  mit int8-Quantisierung, Modell `small` (Start) oder `medium` (bessere
  Qualität, langsamer). Erst wenn die gemessene Latenz stört, auf eine GPU
  (NVIDIA L4/T4, `large-v3-turbo`) wechseln — EU-GPU-Hoster: Hetzner, Scaleway,
  OVH; STACKIT-GPU prüfen.

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

**Spar-Hebel:** Whisper CPU-only oder GPU nur bei Bedarf; `mistral-small`;
EU-TTS statt ElevenLabs; DB und VMs klein dimensionieren.

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

**Noch offen:**

1. **Träger-Reihenfolge:** direkt Jambonz + sipgate **oder** erst Prototyp
   über eine Media-Brücke? (Empfehlung: Prototyp zuerst, Pipeline
   trägerunabhängig.)
2. **Deployment-Ziel:** welcher EU-Host für App, Jambonz und Whisper —
   STACKIT liegt nahe (DB schon dort); GPU-Angebot dort nur relevant, falls
   CPU später nicht reicht.
3. **Löschfrist** für das Gesprächsprotokoll (Vorschlag: 90 Tage) und
   Zugriffsbeschränkung.

---

*Stand: 2026-09-09. Grundlage für die weitere Umsetzung auf Branch
`eu-variante`. Kostenangaben sind Größenordnungen, keine Angebote — vor
Entscheidung je Anbieter verifizieren.*
