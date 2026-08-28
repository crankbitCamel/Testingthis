# Verwaltungsassistent — KI-Voice-Agent für Verwaltungsdienstleistungen

Sprachgesteuerte Webanwendung, die Bürgeranliegen wie die Behördennummer 115 aufnimmt:
Sie hört ein frei formuliertes Anliegen, ordnet es **grob** einem Verwaltungsbereich zu,
liefert dort zuerst das allgemeine Bereichswissen und lässt den Anrufer per **Ziffernwahl
1, 2, 3** schrittweise präzisieren — bis zur einzelnen Auskunft über Unterlagen, Kosten,
Ablauf oder Fristen.

```
Freie Äußerung          "Ich bin umgezogen und weiß nicht, was ich machen muss"
        │
        ▼  grobe Klassifikation (lokal, ohne Server)
Stufe 1  BEREICH        Melde- und Ausweisangelegenheiten
                        → "Grob gilt hier: zwei Wochen Frist, Wohnungsgeberbestätigung
                           ist Pflicht, keine Abmeldung im Inland …"
                        → Sagen Sie 1, 2 oder 3
        ▼
Stufe 2  LEISTUNG       Wohnsitz anmelden oder ummelden
                        → Zuständigkeit, Kurzprofil, Kennzahlen
                        → Sagen Sie 1 bis 6
        ▼
Stufe 3  ASPEKT         Benötigte Unterlagen · Kosten und Dauer · Ablauf ·
                        Voraussetzungen · Fristen · Online-Weg ·
                        Rechtsgrundlagen · Häufige Fehler · FAQ
```

## Schnellstart

```bash
npm start           # startet http://127.0.0.1:4115
npm run check       # Wissensbasis validieren + 110 Tests
npm run build:single # optional: alles in eine HTML-Datei bündeln
```

Es gibt keinen Build-Schritt und **keine Laufzeitabhängigkeiten**: Die Anwendung besteht
aus ES-Modulen, die der Browser direkt lädt. `npm start` liefert sie nur aus.

Wo kein Server zur Verfügung steht — Weitergabe per Mail, Ablage im Intranet, statisches
Hosting — erzeugt `npm run build:single` eine einzelne, autarke HTML-Datei unter
`dist/`. Das Bündeln nutzt esbuild über `npx`; das Projekt selbst bleibt abhängigkeitsfrei.

Bewusst **keine Webfonts**: Für eine Verwaltungsanwendung wäre das Nachladen von
Schriften bei einem Drittanbieter datenschutzrechtlich heikel, deshalb Systemschriften.

Spracheingabe braucht Chrome, Edge oder Safari (Web Speech API). Ohne Mikrofon oder in
Firefox ist die Anwendung über Texteingabe und Zifferntasten **vollständig** bedienbar —
eine Verwaltungsanwendung darf nicht an einer Mikrofonfreigabe scheitern.

## Bedienung

| Eingabe | Wirkung |
| --- | --- |
| Freier Satz | Anliegen wird klassifiziert |
| `1` … `9`, „eins", „die zweite", „nummer 3" | Auswahl aus dem angebotenen Menü |
| Zifferntasten der Tastatur | dasselbe wie ein Klick auf die Taste |
| „zurück" | eine Ebene zurück |
| „neues Anliegen" | Dialog von vorn |
| „wiederholen" | letzte Antwort erneut |
| „alles" | vollständige Auskunft zur aktuellen Leistung |
| „Mitarbeiter" | Weiterleitung an einen Menschen — mit Übergabeprotokoll |
| „beenden" | Gespräch beenden |
| `Esc` | laufende Sprachausgabe abbrechen |

## Wissensbasis

| Kennzahl | Umfang |
| --- | --- |
| Bereiche (Stufe 1) | 12 |
| Leistungen (Stufe 2) | 72 |
| Detailaspekte je Leistung (Stufe 3) | 10 |
| Adressierbare Wissensknoten | 732 |
| Prozessschritte | 371 |
| Unterlagen-Einträge | 368 |
| Gebührenpositionen | 238 |
| Rechtsgrundlagen | 296 |
| FAQ-Einträge | 234 |
| Synonyme für die Erkennung | 590+ |

Die zwölf Bereiche folgen den Lebenslagen des Leistungskatalogs (LeiKa), an dem sich die
115 orientiert:

Melde- und Ausweisangelegenheiten · Kraftfahrzeug und Verkehr · Familie, Kinder und
Erziehung · Eheschließung und Sterbefall · Arbeit und Soziales · Gewerbe und Wirtschaft ·
Bauen und Wohnen · Aufenthalt und Einbürgerung · Umwelt, Abfall und Tiere · Ordnung und
Bußgeld · Steuern und Abgaben · Bildung und Schule

### Regionalschicht: 20 Registerbereiche mit Landesdaten

Über die bundesweite Basis legt sich eine Regionalschicht (`src/kb/regional/`), die
20 Registerbereiche — Meldewesen, Pass- und Ausweisregister, Standesamtsregister,
Fahrzeugregister, Gewerberegister, Bauaufsicht und weitere — mit Landesdaten füllt.
Hinterlegt sind **Nordrhein-Westfalen** und **Rheinland-Pfalz**, je 20 Registerprofile
plus konkrete Leistungs-Overlays.

Das Land wird per Sprache gesetzt („Ich wohne in Köln", „in Mainz", „NRW") oder über die
Regionsauswahl im Kopf; es überdauert ein „neues Anliegen". Danach ergänzt jede Antwort
einen ausgewiesenen Regionalblock mit Stand und Rechtsgrundlage — die bundesweite Basis
bleibt unangetastet, ein fehlendes Overlay fällt sauber auf die Spanne zurück. Beispiele
für fachlich gegensätzliche Landesantworten, durch Tests abgesichert:

| Frage | NRW | Rheinland-Pfalz |
| --- | --- | --- |
| Kirchenaustritt — wo? | Amtsgericht, 30 € | Standesamt, 30 € |
| Bestattungsfrist | spätestens 10 Tage (frühestens 24 h) | spätestens 14 Tage (BestG 2025) |
| Schwerbehindertenfeststellung | kommunalisiert (Kreis/Stadt) | zentral beim LSJV |
| Schulstichtag / Grundschulwahl | 30. September, freie Wahl | 31. August, Schulbezirke |
| Gartenhaus verfahrensfrei | bis 75 m³ | bis 50 m³ (Außenbereich 10 m³) |
| Kita-Beitrag | letzte 2 Jahre frei | ab 2 Jahren frei, Anspruch ab 2 |

Ein Overlay überschreibt nur einzelne Felder (`zustaendigkeit`, `gebuehren`, `fristen`,
`besonderheiten`, `online`, `rechtsgrundlagen`) und trägt verpflichtend `stand` und
Quellenhinweis; der Validator prüft jede Referenz gegen die Basis.

### Aufbau einer Leistung

Jede Leistung ist bis in die Verfahrensdetails beschrieben — das war die Vorgabe „jeden
Prozess ins letzte Detail". Beispielhaft die Felder:

```js
{
  id, cluster, name, sprechName,
  synonyme: [...],            // Umgangssprache für die Erkennung
  leikaBezug,                 // Verwaltungsbezeichnung zur Orientierung
  kurzbeschreibung,
  zustaendigkeit: { stelle, ebene, hinweis },
  voraussetzungen: [...],
  unterlagen:  [{ was, pflicht, hinweis }],
  gebuehren:   [{ position, betrag, art, hinweis }],   // art = bundeseinheitlich |
                                                       // landesrecht | kommunal | …
  fristen: [...], bearbeitungsdauer,
  ablauf:      [{ nr, titel, detail, akteur }],        // Schritt für Schritt
  rechtsgrundlagen: [...],
  online: { moeglich, hinweis, voraussetzungen },
  haeufigeFehler: [...],
  faq: [{ frage, antwort }],
  verwandt: [...],            // Querverweise, vom Validator geprüft
  eskalation,                 // wann an einen Menschen übergeben wird
  belastbarkeit: { quelle, hinweis },   // Vorbehalt bei kommunaler Varianz
  stand,
}
```

Das Feld **`belastbarkeit`** ist bewusst Teil des Modells: Es unterscheidet
bundeseinheitliche Angaben (Personalausweis 37,00 €, Führungszeugnis 13,00 €) von
kommunal oder landesrechtlich abweichenden (Hundesteuer, Bewohnerparkausweis,
Bestattungsfristen). Bei allem, was variiert, blendet der Bot automatisch den Vorbehalt
ein, dass die zuständige Behörde verbindlich entscheidet — geprüft durch einen Test.

## Architektur

```
index.html              Oberfläche
styles/app.css          Gestaltung, hell und dunkel, responsiv
src/
  main.js               Verdrahtung von Dialog, Sprache und Oberfläche
  dialog.js             Zustandsautomat der drei Stufen, Sprech- und Anzeigetexte
  nlu.js                Erkennung: Normalisierung, Stemming, IDF-Scoring, Ziffern
  speech.js             Web Speech API: Erkennung und Sprachausgabe
  kb/
    schema.js           Datenmodell und die zehn Detailaspekte
    cluster.js          Stufe 1: zwölf Bereiche mit Grundsatzwissen
    index.js            Aggregation, Indizes, Kennzahlen
    leistungen/*.js     Stufe 2: 72 Leistungen, nach Bereich getrennt
    regional/           20 Registerbereiche, Landesprofile NRW und RP
scripts/
  server.mjs            statischer Server ohne Abhängigkeiten
  validate-kb.mjs       Konsistenzprüfung der Wissensbasis
  build-single-file.mjs optionales Bündeln zu einer HTML-Datei (esbuild via npx)
tests/
  nlu.test.mjs          Erkennung inkl. Klassifikationstabelle
  dialog.test.mjs       Gesprächsführung und Antwortqualität
  regional.test.mjs     Landeserkennung, Overlays, NRW/RP-Gegensatzpaare
```

### Erkennung ohne Sprachmodell

Die Klassifikation läuft vollständig lokal im Browser:

1. **Normalisierung** — Umlaute, Satzzeichen, Füllwörter („ähm", „bitte", „eigentlich")
2. **Konservatives Stemming** deutscher Flexionsendungen
3. **Gewichtete Treffersuche** gegen Namen, Synonyme und Bereichsstichworte, mit
   IDF-Gewichtung, damit häufige Wörter nicht dominieren; einzelne Wörter aus mehrwortigen
   Phrasen werden gedämpft („Geld" aus „Geld für Kinder" wiegt weniger als „Kindergeld")
4. **Aggregation zu Bereichs-Scores** — das ist die geforderte grobe Zuordnung
5. **Schwellenentscheidung**: eindeutige Leistung → direkt Stufe 2; klarer Bereich →
   Stufe 1 mit Grobwissen; mehrere Kandidaten → Bereichsauswahl per Ziffer; nichts →
   Rückfrage, beim zweiten Mal Bereichsmenü, beim dritten Mal Übergabe an einen Menschen

Das hat im Verwaltungskontext drei Vorteile: Bürgeranliegen verlassen das Gerät nicht,
jede Entscheidung ist nachvollziehbar (die Diagnoseleiste zeigt Scores und Tokens), und
das System funktioniert ohne Netzverbindung und ohne API-Kosten.

Ein LLM ließe sich als Fallback ergänzen — die Schnittstelle dafür ist `entscheide()` in
`src/nlu.js`, die bei `art: 'unklar'` heute in die Rückfrage geht.

### Antworten: gesprochen ≠ angezeigt

Jede Dialogantwort trennt `sprich` (kurz, ohne Aufzählungen, unter 800 Zeichen — durch
Test abgesichert) von `anzeige` (vollständig, zum Nachlesen). Ein Voicebot, der zwölf
Unterlagen am Stück vorliest, ist am Telefon unbrauchbar; auf dem Bildschirm sind
dieselben zwölf Unterlagen genau richtig.

## Qualitätssicherung

```bash
npm run validate   # 20 Pflichtfelder je Leistung, Querverweise, Ablauf-Nummerierung,
                   # Gebührenarten, Synonym-Dubletten, Menüfähigkeit jedes Bereichs
npm test           # 137 Tests
```

Die Testsuite enthält unter anderem:

- eine **Klassifikationstabelle mit 51 realen Formulierungen** und dem Bereich, in dem sie
  landen müssen — die Regressionsgrenze für jede Erweiterung der Wissensbasis
- den Nachweis, dass **jede Leistung über eigene Synonyme** und **jede Leistung per
  Ziffernwahl** erreichbar ist (mit Blätterung bei mehr als acht Leistungen je Bereich)
- den Nachweis, dass **alle 10 Aspekte für alle 72 Leistungen** Inhalt liefern (720
  Kombinationen), ohne `undefined` oder Platzhalter
- den Nachweis, dass unklare Eingaben **nicht** falsch zugeordnet werden
- den Nachweis, dass kommunal variierende Angaben **immer** den Behördenvorbehalt tragen

## Rechtsebenen-Klärung

Der Anrufer muss nicht wissen, ob sein Anliegen Bundes-, Landes- oder
Kommunalrecht ist — das System leitet die Ebene nach der Qualifizierung selbst
aus der Wissensbasis ab (`src/kb/ebenen.js`). Bundesrecht wird sofort und ohne
Ortsfrage beantwortet; bei Landes- oder Kommunalrecht folgt **genau eine**
gezielte Rückfrage nach Bundesland bzw. Kommune, mit Ausweichoption auf die
bundesweite Spanne. Unbekannte Orte erhalten die ehrliche Spanne mit
Satzungsvorbehalt.

## KI-Modus (LLM + RAG)

Optional führt Claude das Gespräch — mit der Wissensbasis als einziger
Faktenquelle: vier Werkzeuge (`wissen_suchen` über 736 RAG-Chunks,
`leistung_auskunft`, `rechtsebene_pruefen`, `anliegen_klassifizieren`), harte
Grounding-Regeln im System-Prompt, jede Antwort mit Belegen und Stand.

```bash
npm run build:chunks                 # RAG-Korpus erzeugen (dist/chunks.jsonl)
ANTHROPIC_API_KEY=sk-... npm start   # KI-Modus "Claude (claude-opus-5)"
npm start                            # ohne Schlüssel: Testmodus aus dem Retrieval
```

Der Schalter erscheint in der Fußleiste, sobald die Anwendung über ihren
Node-Server läuft. Architektur, Chunking-Regeln, Retrieval-Aufbau und
Kostenrahmen: **`docs/llm-rag-architektur.md`**.

## Grenzen

- Die Wissensbasis ist redaktionell gepflegt und trägt einen Stand (`2026-08`). Beträge
  wie Kindergeld, Bürgergeld-Regelsätze oder BAföG-Sätze ändern sich; sie sind als Stand
  gekennzeichnet und mit dem Hinweis versehen, den aktuellen Wert zu erfragen.
- Kommunale Gebühren sind Spannen, keine Zusagen. Das System sagt das bei jeder solchen
  Auskunft dazu.
- Es besteht keine Anbindung an Fachverfahren: Der Assistent gibt Auskunft, er stellt
  keine Anträge und vereinbart keine Termine.
- Die Spracherkennung nutzt die Engine des Browsers; Chrome überträgt Audio dafür an
  Google. Wer das ausschließen muss, nutzt die Texteingabe oder bindet eine lokale
  Erkennung an — die Schnittstelle dafür ist `Zuhoerer` in `src/speech.js`.

## Rechtlicher Hinweis

Alle Auskünfte sind allgemeine Informationen und keine Rechtsberatung. Verbindlich
entscheidet ausschließlich die zuständige Behörde.
