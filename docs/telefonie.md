# Echte Telefonie: den Assistenten an eine Rufnummer bringen

Der Telefonie-Adapter (`server/telefon.mjs`) macht aus der bestehenden
Gespraechslogik einen Telefondienst. Er spricht das Webhook-Protokoll von
Twilio: Bei jedem Anruf und nach jeder Aeusserung ruft Twilio unseren Server
auf und bekommt TwiML zurueck (TwiML = Twilio Markup Language, ein kleines
XML, das beschreibt, was der Anrufer hoert). Spracherkennung und deutsche
Neural-Sprachausgabe liefert Twilio mit - es braucht anfangs keinen eigenen
STT-/TTS-Dienst (STT/TTS = Speech-to-Text/Text-to-Speech, also
Spracherkennung und Sprachausgabe).

## Ablauf eines Anrufs

1. Anrufer waehlt die Twilio-Nummer -> Twilio POSTet an `/api/telefon`
   -> Begruessung + Zuhoeren (`<Gather input="speech">`).
2. Anrufer spricht -> Twilio erkennt den Text und POSTet ihn an
   `/api/telefon/eingabe` -> unsere Interaktionsschleife antwortet
   (`gespraechsschritt`: bewerten -> antworten / rueckfragen / auflegen).
3. Bei `beendet` (Verabschiedung oder Missbrauch nach Verwarnung) legt der
   Adapter mit `<Hangup/>` auf. Schweigt der Anrufer zweimal, verabschiedet
   er sich hoeflich.

Der Gespraechszustand (Verlauf, erkanntes Bundesland) haengt an Twilios
CallSid und verfaellt 30 Minuten nach der letzten Aktivitaet.

## Einrichtung Schritt fuer Schritt

1. **Twilio-Konto** auf twilio.com anlegen (Testguthaben reicht fuer erste
   Anrufe) und unter *Phone Numbers* eine Nummer mit Voice-Faehigkeit
   kaufen - deutsche +49-Nummern verlangen einen Adressnachweis (Bundle),
   zum Testen tut es jede beliebige Voice-Nummer.
2. **Server oeffentlich erreichbar machen.** Zum Testen vom eigenen Rechner:

   ```bash
   ANTHROPIC_API_KEY=sk-ant-... npm start
   ngrok http 4115        # liefert eine oeffentliche https-Adresse
   ```

   Fuer den Dauerbetrieb den Server auf einen kleinen Host legen
   (z. B. Fly.io, Render, Hetzner) - `npm start` genuegt, es gibt keinen
   Build-Schritt. `HOST=0.0.0.0` setzen, damit der Server von aussen
   erreichbar ist.
3. **Webhook eintragen:** In der Twilio-Konsole bei der Nummer unter
   *Voice Configuration* -> "A call comes in" -> Webhook:
   `https://<ihre-adresse>/api/telefon`, Methode POST.
4. **Anrufen.** Ohne `ANTHROPIC_API_KEY` antwortet der Testmodus (direkt aus
   dem Retrieval), mit Schluessel fuehrt Claude das Gespraech.

Die Stimme laesst sich ueber die Umgebungsvariable `TELEFON_STIMME`
tauschen (Standard `Polly.Vicki-Neural`; Alternativen z. B.
`Polly.Daniel-Neural`, `Google.de-DE-Neural2-C`).

## Kosten (Groessenordnung)

| Posten | grob |
| --- | --- |
| Twilio-Nummer | 1-6 Euro/Monat |
| Gespraechsminute (eingehend, inkl. Erkennung/Stimme) | wenige Cent |
| Claude-Anfrage je Gespraechsrunde | 1-3 Cent |

Ein fuenfminuetiges Buergergespraech liegt damit deutlich unter 50 Cent.

## Grenzen des rundenbasierten Ansatzes - und die Ausbaustufe

Der Adapter arbeitet in Runden: sprechen, zuhoeren, antworten. Das ist
robust und fuer Auskunftsdialoge voellig ausreichend, hat aber zwei
Grenzen: Der Anrufer kann den Assistenten nicht unterbrechen (kein
Barge-in), und zwischen Aeusserung und Antwort liegen je nach Modell ein
paar Sekunden. Die Ausbaustufe dafuer ist Twilio **Media Streams**
(Audio als Live-Datenstrom per WebSocket) kombiniert mit einem
Streaming-STT (z. B. Deepgram) und einer Streaming-TTS (z. B. ElevenLabs) -
das ersetzt nur `server/telefon.mjs`, die Gespraechslogik und die
Wissensbasis bleiben unveraendert.

Fuer den Produktivbetrieb ausserdem einplanen: Validierung der
Twilio-Signatur (Header `X-Twilio-Signature`), damit nur Twilio die
Endpunkte aufrufen kann, sowie einen Datenschutzhinweis zu Beginn des
Anrufs.
