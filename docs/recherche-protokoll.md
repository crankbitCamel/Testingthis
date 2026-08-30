# Recherche-Protokoll

Jede Websuche, die Werte in die Wissensbasis gebracht oder bestätigt hat, wird
hier mit Datum, Kernaussage, Quelle und Zielort dokumentiert. Das Protokoll ist
die Brücke zwischen der Quelle im Netz und dem Feld in den Daten - ohne sie
lässt sich ein Wert später weder verteidigen noch effizient nachprüfen.

Regel: **Keine Recherche ohne Protokollzeile.** Ortskonkrete Werte tragen ihre
Quelle zusätzlich direkt im Datensatz (`quelle.fundstelleUrl` im
Kommunen-Overlay).

## Runde 2 — 2026-08-28 (Bundesleistungen, Jagd/Fischerei, Düsseldorf)

| Aussage (verifiziert) | Quelle | Eingearbeitet in |
| --- | --- | --- |
| Kindergeld steigt zum 01.01.2026 auf 259 €/Kind; automatische Anpassung | [Bundesagentur für Arbeit](https://www.arbeitsagentur.de/news/kindergeld-steigt-2026) | `leistungen/familie-kinder.js` (kindergeld, bestätigt) |
| Bürgergeld-Regelsatz bleibt 2026 bei 563 € (Nullrunde) | [Bundesregierung](https://www.bundesregierung.de/breg-de/aktuelles/nullrunde-buergergeld-2383676) | `leistungen/arbeit-soziales.js` (buergergeld, bestätigt) |
| Rentenantrag ~3 Monate vor Beginn; Regelaltersgrenze Jg. 1960: 66+4, Jg. 1961: 66+6 | [Deutsche Rentenversicherung](https://www.deutsche-rentenversicherung.de/DRV/DE/Rente/Kurz-vor-der-Rente/Wann-kann-ich-in-Rente-gehen/wann-kann-ich-in-rente-gehen_node.html) | `leistungen/arbeit-soziales.js` (rente-altersrente, neu) |
| Steuerjahr 2025: Abgabefrist 31.07.2026, mit Berater 28.02.2027 | [Finanztip](https://www.finanztip.de/steuererklaerung/steuererklaerung-frist/) | `leistungen/steuern-abgaben.js` (einkommensteuererklaerung, neu) |
| Steuerklassenwechsel bis 30.11. fürs laufende Jahr, über ELSTER | [mein-nettogehalt.de](https://mein-nettogehalt.de/ratgeber/steuerklasse-wechseln/) | `leistungen/steuern-abgaben.js` (steuerklassenwechsel, neu) |
| Fischereischein NRW: 16 €/Jahr, 48 €/5 Jahre (je inkl. Abgabe), Prüfung 50 €, ab vollendetem 12. Lj.; Novelle: digitaler Schein, künftig Lebenszeit + getrennte Abgabe | [MLV NRW](https://www.mlv.nrw.de/themen/jagd-und-fischerei/fischerei-und-aquakultur/fischereipruefung-und-fischereischein/), [Kreis Gütersloh](https://www.kreis-guetersloh.de/themen/ordnung/jagd-und-fischereiwesen/der-fischereischein-in-nrw/) | `regional/nw.js` (fischereischein, jagd-fischerei-Profil) |
| Fischereischein RP: 9 €/Jahr, 35 €/5 Jahre, Prüfung 29 €, 35-Std.-Lehrgang, Prüfung ab 13, Scheinpflicht ab 14 | [bus.rlp.de](https://bus.rlp.de/detail?areaId=8957801&pstId=8964295) | `regional/rp.js` (fischereischein, jagd-fischerei-Profil) |
| Jägerprüfung NRW landeseinheitlich; Prüfung typ. 200-350 €, Scheingebühren kreisabhängig | [waidwissen.com](https://waidwissen.com/jagdschein-nrw), [Stadt Münster](https://www.stadt-muenster.de/ordnungsamt/allgemeines-ordnungswesen/jagdwesen) | `regional/nw.js` (jagdschein), `leistungen/umwelt-abfall-tiere.js` (jagdschein, neu) |
| Hundesteuer Düsseldorf: 96/150/180 €, gefährliche Hunde 600/900 € — Satzung 22/101, Fassung ab 01.01.2024 | [Stadtrecht Düsseldorf 22/101](https://www.duesseldorf.de/stadtrecht/2/22/22-101/) | `beispiele/kommunen/05111000-duesseldorf.json` |
| Bewohnerparkausweis Düsseldorf: 25 € online / 30 € Bürgerbüro (1 J.), 50/55 € (2 J.) | [Serviceportal Düsseldorf](https://service.duesseldorf.de/suche/-/egov-bis-detail/dienstleistung/40/show) | dito |
| Dienstleistungszentrum: Willi-Becker-Allee 7, 40227 Düsseldorf, Tel. 0211 89-91, Terminpflicht | [duesseldorf.de/einwohnerangelegenheiten](https://www.duesseldorf.de/einwohnerangelegenheiten) | dito |
| Jagdschein-Onlinedienst Düsseldorf | [Serviceportal Düsseldorf, DL 400](https://service.duesseldorf.de/suche/-/egov-bis-detail/dienstleistung/400/show) | dito |

## Runde 1 — 2026-08-28 (Landesrecht NRW/RP)

| Aussage (verifiziert) | Quelle | Eingearbeitet in |
| --- | --- | --- |
| Kirchenaustritt RP: Standesamt, 30 €, notarielle Alternative | [kirchenaustritt.de/rp](https://www.kirchenaustritt.de/rp) | `regional/rp.js` (kirchenaustritt) |
| Bestattungsfrist NRW: spätestens 10 Tage, frühestens 24 h | [recht.nrw.de, BestG § 13](https://recht.nrw.de/lmi/owa/br_bes_detail?bes_id=5166&anw_nr=2&aufgehoben=N&det_id=557079) | `regional/nw.js` (bestattung, sterbefall) |
| Bestattungsfrist RP: 14 Tage nach neuem BestG (Okt. 2025); zuvor 10 | [sonnen-regnery.de](https://www.sonnen-regnery.de/unsere-leistungen/bestattungsgesetz-rlp-2025-neue-regelungen) | `regional/rp.js` (bestattung, sterbefall) |
| Verfahrensfrei NRW: bis 75 m³ (§ 62 BauO NRW), nicht im Außenbereich | [bauportal.nrw](https://bauportal.nrw/verfahrensfreie-bauvorhaben-nach-ss-62-bauo-nrw-2018) | `regional/nw.js` (bauantrag) |
| Genehmigungsfrei RP: bis 50 m³, Außenbereich 10 m³ (§ 62 LBauO) | [hansagarten24.de/RLP](https://www.hansagarten24.de/gartenhaus-baugenehmigung-in-rheinland-pfalz-was-ist-erlaubt/) | `regional/rp.js` (bauantrag) |
| Kita RP: beitragsfrei ab 2 Jahren; Rechtsanspruch 7 Std. ab 2 (KiTaG 2021) | [kita.rlp.de](https://kita.rlp.de/kita-in-rheinland-pfalz/kita-gesetz/rechtsanspruch-und-beitragsfreiheit) | `regional/rp.js` (kita-platz) |
| Schulstichtage: NRW 30.09., RP 31.08. | [Bildungsserver](https://www.bildungsserver.de/elementarbildung/wann-kommt-mein-kind-in-die-schule-einschulung-und-stichtagsregelungen-12554-de.html) | `regional/nw.js`, `regional/rp.js` (schulanmeldung) |
| RP: Gaststättenerlaubnis besteht fort (KEINE Abschaffung — Korrektur meiner Vorannahme); Straußwirtschaft privilegiert | [service.rlp.de](https://service.rlp.de/detail?pstId=8962780), [IHK Pfalz](https://www.ihk.de/pfalz/infrastruktur-und-digitale-wirtschaft/tourismus/merkblaetter-tourismus-gastgewerbe/erlaubnispflicht-im-gastgewerbe-5860842) | `regional/rp.js` (gaststaettenerlaubnis) |

## Wo Rechercheergebnisse außerdem liegen

- **In den Daten selbst:** jede Leistung trägt `stand` + `rechtsgrundlagen`,
  jedes Regional-/Kommunen-Overlay `quelleHinweis` bzw. `quelle` mit
  `fundstelleUrl` und `geprueftAm`.
- **In der Git-Historie:** die Commits benennen je Runde, was recherchiert
  und was daraus gebaut wurde (`git log --oneline`).
- **Nicht recherchiert, sondern redaktionell:** Der Grundstock der 72
  Basisleistungen entstand aus Modellwissen (Stand 2026-08) und ist als
  solcher gekennzeichnet - die Verifikationsschleife dieser Protokollrunden
  ist der Weg, ihn sukzessive quellenfest zu machen.
