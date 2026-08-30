# Wissenserfassung: Formate und Ablauf

Zwei JSON-Formate tragen das gesamte Wissen. Die formalen Schemata liegen in
`schema/`, hier steht, wie man sie befüllt.

## Die Trennung, auf der alles beruht

| Schicht | Datei/Format | Enthält | Ändert sich |
| --- | --- | --- | --- |
| **Leistung** (Bund) | `schema/leistung.schema.json` | Was gilt fachlich: Prozess, Unterlagen, Voraussetzungen, Fristen des Bundesrechts, Gebühren-**Spannen** | selten |
| **Land** | `src/kb/regional/*.js` | Landesrechtliche Abweichungen (Fristen, Zuständigkeitstyp, Landesgebühren) | jährlich |
| **Kommune** | `schema/kommune.schema.json` | Konkrete **Beträge**, **Adressen**, **Terminlinks**, Öffnungszeiten, örtliche Befreiungen | laufend |

Merkregel: **Fachwissen nach oben, Organisationswissen nach unten.**
„Zuständig ist das Bürgeramt der Wohnsitzgemeinde" ist Leistungswissen.
„Bürgeramt Mitte, Rathausplatz 1, Termin unter …" ist Kommunenwissen.
Wer beides mischt, pflegt 11.000-fach, was einmal reichen würde.

## Ablauf für eine neue Kommune

1. `vorlagen/kommune.vorlage.json` kopieren nach
   `extern/eingang/<AGS>-<name>.json` (AGS = Amtlicher Gemeindeschlüssel,
   die 8-stellige Gemeindenummer).
2. Befüllen - von Hand, oder aus einer Satzung per
   `node scripts/extrahiere-satzung.mjs satzung.pdf hundesteuer 05315000 "Köln" nw`
   (braucht `ANTHROPIC_API_KEY`; erzeugt einen Entwurf mit Fundstellen und
   einer Liste der Unsicherheiten).
3. Prüfen: `node scripts/validate-kommune.mjs extern/eingang/*.json`
4. **Mensch liest gegen die Quelle** (die Fundstellen machen das schnell),
   trägt Adresse und Terminlink nach, setzt `status: "freigegeben"`.
5. Datei nach `beispiele/kommunen/` bzw. den produktiven Datenordner
   verschieben und committen. Nur `freigegeben` erreicht die Laufzeit.

## Feldregeln, die Diskussionen ersparen

- **Beträge** doppelt: `betrag` als Klartext fürs Vorlesen, `betragCent`
  maschinenlesbar. Der Validator prüft, dass beide zusammenpassen.
- **`fundstelle`** je Gebühr: Paragraph oder Seite in der Satzung. Ohne sie
  ist der Wert im Zweifel nicht verteidigbar.
- **`quelle.geprueftAm`** ist Pflicht und steuert den Verfall: Nach Ablauf
  des Prüfintervalls degradiert der Eintrag zur Laufzeit auf die Landes-
  oder Bundesspanne, statt still zu veralten.
- **Synonyme** (Leistungsebene): die Formulierungen echter Anrufer, nicht
  Amtsdeutsch. Sie sind das Eingangstor der Spracherkennung.
