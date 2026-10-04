# Datenpipeline: Verwaltungsleistungen aus dem PVOG

Stand: Oktober 2026. Ziel: korrekte Gebühren, Unterlagen und Fristen **mit
Quelle und Datum** für die 200 größten Kommunen, statt geratener Zahlen.

## Drei Ebenen, drei Datenwege

| Ebene | Beispiel | Varianten | Woher |
|---|---|---|---|
| Bundesrecht | Reisepass 37,50 / 70 Euro | 1 | PVOG-Bundestext und Gebührenverordnung, einmal |
| Landesrecht | Bestattungsfristen, Kita-Beiträge | 16 | PVOG-Landestext |
| Kommunal | Hundesteuersatz, Sperrmüll, Termin-Links, Online-Dienste | je Kommune | PVOG-Kommunaltext; Lücken: Satzung oder Stadtseite |

Die Bundesebene ist der einfachste Teil und muss überall exakt stimmen.

## Quelle: PVOG-Suchdienst (FITKO)

- Basis `https://pvog.fitko.net/suchdienst/api`, öffentlich, kein Login.
- Pflicht-Header `pvog-sud-api-client-id`. Wir nutzen vorerst die ID des
  öffentlichen PVOG-Frontends (aus dessen `config.js`). **Für den Dauerbetrieb
  bei FITKO eine eigene Client-ID beantragen** und per `PVOG_CLIENT_ID` setzen.
- `GET /v3/locations?q=Köln` → Regionalschlüssel (ARS), ohne Header nutzbar.
- `GET /v2/servicedescriptions/leikahierarchy?ars=…&leikaIds=…` → Beschreibung
  je Kommune und LeiKa-Schlüssel, **mit allen Textmodulen** (Unterlagen,
  Kosten, Fristen, Ablauf, Rechtsgrundlagen, Online-Dienste).
- `GET /v6/servicedescriptions/{id}/detail?ars=…` → zusätzlich fachliche
  Freigabe (Stelle + Datum), Ursprungsportal, zuständige Stellen mit Namen.
- `GET /v8beta1/servicedescriptions?ars=…&q=…` → Freitextsuche. **Unzuverlässig**
  für die Pipeline (Berlin „Reisepass“ trifft zuerst eine andere Leistung);
  nur für die einmalige Schlüsselzuordnung genutzt.
- Rate-Limits: keine Header gesehen; wir drosseln selbst (3 parallel, 200 ms).

LeiKa-Schlüssel sind **14-stellig** (Reisepass `99085001012000`). Die 8-stelligen
Angaben im Feld `leikaBezug` der Wissensbasis waren falsch und werden durch
`data/pvog/leika-zuordnung.json` ersetzt.

## Ablauf

```bash
node scripts/pvog.mjs zuordnen            # LeiKa-Schlüssel je Leistung (einmalig, dann von Hand geprüft)
node scripts/pvog.mjs abrufen --top 200   # je Kommune und Leistung: Suche + Detail
node scripts/pvog.mjs abrufen --orte Köln,München --leistungen reisepass,hundesteuer
```

Dateien:

| Datei | Inhalt | Im Repository |
|---|---|---|
| `data/pvog/kommunen-top200.json` | 200 größte Kommunen mit ARS (Destatis, 31.12.2024) | ja |
| `data/pvog/leika-zuordnung.json` | Leistung → LeiKa, mit Kandidaten und Prüfvermerk | ja |
| `data/pvog/uebersicht.csv` | eine Zeile je Kommune × Leistung, Lücken-Spalten | ja |
| `data/pvog/ergebnisse/<ARS>.json` | normalisierte Beschreibungen (~80 MB gesamt) | nein, regenerierbar |
| `data/pvog/cache/` | Rohantworten | nein |

Normalisierte Felder je Datensatz: Leistung, LeiKa, PVOG-ID, Kommune,
Geltungsbereich (bundes-/landesweit/kommunal), Kurzinfo, Voraussetzungen,
Unterlagen, Gebühren (Text, strukturierte Einträge, erkannte Euro-Beträge),
Fristen, Bearbeitungsdauer, Ablauf, Rechtsgrundlagen (Links), Online-Dienste,
zuständige Stellen, Freigabe (Stelle, Datum), Quell-URLs, PVOG-Stand, Abrufzeit.

## Erste Ergebnisse (10 größte Städte, 64 Leistungen)

| Kennzahl | Anzahl von 640 |
|---|---|
| Beschreibung gefunden | 556 |
| Gebührenangabe vorhanden | 519 |
| davon strukturiert | 114 |
| Euro-Betrag erkannt | 225 |
| Quell-URL vorhanden | 540 |
| Freigabedatum vorhanden | 474 |

Reisepass in allen zehn Städten korrekt 37,50 / 70 Euro. Hundesteuer: nur
Anmeldung, Unterlagen und Online-Formular, **keine Steuersätze**. 13 Leistungen
haben in Köln keine passende PVOG-Leistung (u. a. Sperrmüll, Mülltonne,
Fundbüro, Kirchenaustritt, Kita-Platz, Auskunftssperre).

## Vollständiger Lauf (200 Kommunen, 64 Leistungen, 4. Oktober 2026)

Rund 22.000 Anfragen in 74 Minuten (3 parallel, 200 ms Abstand), keine Fehler.

| Kennzahl | Anzahl von 12.800 | Anteil |
|---|---|---|
| Beschreibung gefunden | 10.517 | 82 % |
| Gebührenangabe vorhanden | 9.243 | 72 % |
| davon strukturiert | 1.832 | 14 % |
| Euro-Betrag erkannt | 3.266 | 26 % |
| Quell-URL vorhanden | 9.906 | 77 % |
| Freigabedatum vorhanden | 8.458 | 66 % |

Je Kommune im Median 54 von 64 Leistungen. Vollständig in allen 200:
Personalausweis, Reisepass, Altersrente, Steuer-ID. Am schwächsten:
Sondernutzungserlaubnis (16), Baumfällgenehmigung (60), Online-Ausweisfunktion
(89), Zweitwohnungsteuer (97), Hundesteuer (118, Gebühr nur bei 65).

Regionalschlüssel gegen das PVOG abgeglichen: Hanau ist seit 1.1.2026
kreisfrei (`064150000000` statt `064350014014` laut Destatis 2024). Beim
Abgleich nur gleichnamige Orte im selben Land übernehmen (Schwerin traf einen
Ort in Brandenburg).

## Regeln für die Verwendung im Assistenten

1. **Ohne Quelle keine Zahl.** Ein Betrag wird nur genannt, wenn der Datensatz
   eine Quell-URL oder einen Online-Dienst der Stadt und ein Stand-Datum hat.
   Sonst: „Das weiß ich für Ihre Stadt nicht sicher“ plus Link.
2. **Datum mitnennen:** Freigabedatum, sonst PVOG-Stand.
3. **Keine Behörde:** jeder Kanal (Web-Chat, Telefon, später WhatsApp) zeigt
   bzw. sagt, dass der Dienst keine Behörde ist und allgemeine Auskunft gibt,
   keine Rechtsberatung im Einzelfall.

## Nächste Schritte

1. Freitext-Gebühren in feste Felder ziehen (Altersstufen, Zuschläge) per
   Sprachmodell, nur wo `gebuehren.strukturiert` falsch ist; Ergebnis gegen
   die erkannten Euro-Beträge prüfen.
2. Lücken schließen, gezielt: Hundesteuersatzung, Abfallsatzung (Sperrmüll,
   Tonnen) je Kommune suchen und extrahieren, jeweils mit URL und Satzungsdatum.
3. Import nach Postgres (Tabelle `pvog_leistungen`, Schlüssel ARS + Leistung)
   und ein Werkzeug `kommunale_auskunft(ort, leistung)` für das Modell, das
   genau diese Felder samt Quelle liefert.
4. Monatlicher Lauf (Cache leeren), Änderungen über `pvogStand` erkennen.
