/**
 * Landesprofil Nordrhein-Westfalen.
 *
 * "registerprofile" traegt das Landeswissen je Registerbereich - was in NRW
 * anders laeuft als im Bundesschnitt. "leistungen" ueberlagert einzelne
 * Leistungen der Basis mit konkreten Landeswerten. Beides wird im Dialog als
 * eigener Regionalblock ausgewiesen, nie stillschweigend eingemischt.
 */
export const LAND = {
  code: 'nw',
  name: 'Nordrhein-Westfalen',
  kuerzel: 'NRW',
  stichworte: [
    'nrw', 'nordrhein-westfalen', 'nordrhein westfalen', 'köln', 'düsseldorf', 'dortmund',
    'essen', 'duisburg', 'bochum', 'wuppertal', 'bielefeld', 'bonn', 'münster', 'aachen',
    'mönchengladbach', 'gelsenkirchen', 'krefeld', 'oberhausen', 'hagen', 'hamm', 'leverkusen',
    'solingen', 'herne', 'neuss', 'paderborn', 'recklinghausen', 'bottrop', 'remscheid', 'moers', 'siegen',
  ],
  stand: '2026-08',

  registerprofile: {
    meldewesen: {
      kurz: 'Meldebehörden sind die Bürgerämter der Städte und Gemeinden. Die elektronische Wohnsitzanmeldung ist in vielen NRW-Kommunen live, darunter Köln, Düsseldorf und Dortmund.',
      fakten: [
        'Terminvergabe in den Großstädten fast ausschließlich online; Notfallkontingente werden meist morgens freigeschaltet.',
        'Die Gebühr für Meldebescheinigungen liegt in NRW typischerweise um 9 bis 10 Euro.',
        'Übermittlungs- und Auskunftssperren beantragen Sie beim Bürgeramt; die Bearbeitung übernimmt die Meldebehörde der Kommune.',
      ],
      portal: 'Serviceportale der Kommunen; elektronische Wohnsitzanmeldung über wohnsitzanmeldung.gov.de',
    },
    passwesen: {
      kurz: 'Pass- und Ausweisgebühren sind bundeseinheitlich - in NRW gibt es keine Abweichungen. Engpass ist die Terminlage der großstädtischen Bürgerämter.',
      fakten: [
        'In Köln, Düsseldorf und Dortmund sind reguläre Termine oft Wochen im Voraus vergeben; mehrere Städte betreiben Express- oder Abendschalter.',
        'Selbstbedienungsterminals für das digitale Lichtbild stehen in den meisten größeren Bürgerämtern.',
      ],
      portal: 'Terminvergabe über das Serviceportal der jeweiligen Stadt',
    },
    justizregister: {
      kurz: 'Führungszeugnis und Gewerbezentralregisterauszug sind Bundesleistungen (13 Euro) - das Bürgeramt nimmt nur den Antrag entgegen. Landesbesonderheiten gibt es nicht.',
      fakten: [
        'Der Online-Antrag beim Bundesamt für Justiz mit eID erspart den Behördengang vollständig.',
      ],
      portal: 'fuehrungszeugnis.bund.de',
    },
    geburtenregister: {
      kurz: 'Standesämter der Städte und Gemeinden führen die Geburtenregister. Personenstandsurkunden kosten in NRW nach der Landesgebührenordnung etwa 10 Euro, jede weitere Ausfertigung im selben Vorgang etwa 5 Euro.',
      fakten: [
        'Urkunden für Eltern- und Kindergeldzwecke sind gebührenfrei (§ 68 PStG) - ausdrücklich danach fragen.',
        'Viele NRW-Standesämter bieten Online-Urkundenbestellung mit Kartenzahlung.',
      ],
      portal: 'Online-Urkundenservice der jeweiligen Kommune',
    },
    eheregister: {
      kurz: 'Die Anmeldung der Eheschließung kostet in NRW nach der Allgemeinen Verwaltungsgebührenordnung etwa 40 Euro; unterliegt das Recht eines ausländischen Staates der Prüfung, etwa 66 Euro.',
      fakten: [
        'Trauungen außerhalb der Dienstzeiten und an Ambienteorten kosten kommunal festgesetzte Zuschläge, häufig 100 bis 250 Euro.',
        'Beliebte Termine vergeben Kölner und Düsseldorfer Standesämter bis zu ein Jahr im Voraus.',
      ],
      portal: 'Online-Terminreservierung der Standesämter',
    },
    sterberegister: {
      kurz: 'In NRW gilt das Bestattungsgesetz NRW: Bestattung frühestens 24 Stunden nach dem Tod, Erd- oder Feuerbestattung spätestens zehn Tage nach der Todesfeststellung.',
      fakten: [
        'Die 24-Stunden-Untergrenze ist kürzer als in den meisten Ländern (sonst 48 Stunden) - für Religionsgemeinschaften mit schnellem Bestattungsgebot relevant.',
        'Bestattung ohne Sarg im Leichentuch ist aus religiösen Gründen zulässig, wenn die Gemeinde es in der Friedhofssatzung vorsieht.',
        'Die zweite Leichenschau vor der Feuerbestattung nimmt ein dafür qualifizierter Arzt am Krematorium vor.',
      ],
      portal: null,
      quelleHinweis: 'Bestattungsgesetz NRW (BestG NRW), zuletzt geändert 2021',
    },
    kirchenaustritt: {
      kurz: 'In NRW wird der Kirchenaustritt beim Amtsgericht des Wohnsitzes erklärt - nicht beim Standesamt. Die Gebühr beträgt 30 Euro.',
      fakten: [
        'Persönliche Erklärung mit Personalausweis; alternativ öffentlich beglaubigte schriftliche Erklärung über einen Notar.',
        'Die Kirchensteuerpflicht endet mit Ablauf des Monats, in dem der Austritt erklärt wurde.',
        'Viele Amtsgerichte nehmen Austritte nur mit Online-Termin entgegen.',
      ],
      portal: 'Terminvergabe der Amtsgerichte über justiz.nrw',
      quelleHinweis: 'Kirchenaustrittsgesetz NRW; Justizverwaltungsgebühren',
    },
    fahrzeugregister: {
      kurz: 'Zulassungsbehörden sind die Straßenverkehrsämter der Kreise und kreisfreien Städte. Alle i-Kfz-Stufen sind flächendeckend verfügbar.',
      fakten: [
        'In den Ballungsräumen an Rhein und Ruhr sind Zulassungstermine knapp; viele Ämter reservieren eigene Kontingente für Händler und für Online-Anträge.',
        'Wunschkennzeichen-Reservierung läuft über die Portale der Kreise, meist 90 Tage gültig.',
      ],
      portal: 'i-Kfz-Portale der Kreise und Städte',
    },
    fahrerlaubnisregister: {
      kurz: 'Fahrerlaubnisbehörden sind die Straßenverkehrsämter der Kreise und kreisfreien Städte. Der Umtausch alter Führerscheine läuft in vielen NRW-Kommunen komplett per Post oder online.',
      fakten: [
        'Stammt der alte Führerschein aus einer anderen Stadt, fordert die NRW-Behörde die Karteikartenabschrift selbst an - das verlängert die Bearbeitung um Wochen.',
      ],
      portal: 'Onlineanträge vieler Straßenverkehrsämter',
    },
    parkraum: {
      kurz: 'NRW hat die Festsetzung der Bewohnerparkgebühren 2022 per Verordnung auf die Kommunen übertragen. Seither gehen die Preise weit auseinander - Köln etwa verlangt 100 Euro im Jahr, kleinere Städte teils weiter um 30 Euro.',
      fakten: [
        'Der Ausweis wird meist digital ausgestellt und über die Kennzeichenerfassung kontrolliert.',
        'Der blaue EU-Parkausweis für Menschen mit Merkzeichen aG oder Bl bleibt bundesrechtlich geregelt und gebührenfrei.',
      ],
      portal: 'Onlineanträge der Straßenverkehrsbehörden',
      quelleHinweis: 'Bewohnerparkgebührenverordnung NRW (2022); kommunale Satzungen',
    },
    gewerberegister: {
      kurz: 'Die Gewerbeanmeldung läuft in NRW landesweit digital über das Wirtschafts-Service-Portal.NRW; die Kommune bleibt zuständige Behörde.',
      fakten: [
        'Die Gebühr setzt jede Kommune fest, typisch sind in NRW etwa 20 bis 60 Euro.',
        'Erlaubnisverfahren (Makler, Bewachung, Gastronomie) lassen sich über dasselbe Portal anstoßen.',
      ],
      portal: 'Wirtschafts-Service-Portal.NRW (service.wirtschaft.nrw)',
    },
    gaststaettenwesen: {
      kurz: 'NRW hat kein eigenes Gaststättengesetz erlassen - das Bundes-Gaststättengesetz gilt fort. Für den Ausschank alkoholischer Getränke brauchen Sie daher weiterhin die Gaststättenerlaubnis der Kommune.',
      fakten: [
        'Zuständig ist das Ordnungsamt der Standortgemeinde; die IHK-Unterrichtung und die Belehrung nach § 43 IfSG sind Voraussetzung.',
        'Sperrzeit in NRW: grundsätzlich nur die "Putzstunde" von 5 bis 6 Uhr für Schankwirtschaften; Kommunen können abweichen.',
      ],
      portal: 'Wirtschafts-Service-Portal.NRW',
      quelleHinweis: 'Gaststättengesetz des Bundes in Verbindung mit Landesverordnungen NRW',
    },
    bauaufsicht: {
      kurz: 'Es gilt die BauO NRW 2018. Verfahrensfrei sind Gebäude bis 75 Kubikmeter Brutto-Rauminhalt ohne Aufenthaltsräume - im Außenbereich gilt das nicht. Der Bauantrag läuft digital über das Bauportal.NRW.',
      fakten: [
        'Gartenhäuser bis 30 Kubikmeter dürfen unter Voraussetzungen ohne Grenzabstand stehen, größere brauchen drei Meter Abstand.',
        'Für Wohngebäude im Geltungsbereich eines Bebauungsplans gibt es die Genehmigungsfreistellung nach § 63 BauO NRW.',
        'Die Baugenehmigung erlischt, wenn nicht innerhalb von drei Jahren begonnen wird; Verlängerung ist möglich.',
      ],
      portal: 'Bauportal.NRW - digitaler Bauantrag',
      quelleHinweis: 'BauO NRW 2018, § 62 (verfahrensfreie Vorhaben), § 63 (Freistellung)',
    },
    denkmalliste: {
      kurz: 'Nach dem Denkmalschutzgesetz NRW 2022 sind die Gemeinden selbst Untere Denkmalbehörde. Solar- und Wärmepumpenanlagen auf Denkmälern wurden ausdrücklich erleichtert.',
      fakten: [
        'Fachliche Beratung leisten die Landschaftsverbände (LVR- und LWL-Denkmalpflegeämter).',
        'Erlaubnisse für Maßnahmen am Denkmal sind in NRW gebührenfrei bis moderat; die Bescheinigung für die Steuerabschreibung stellt die Untere Denkmalbehörde aus.',
      ],
      portal: 'Denkmallisten der Gemeinden, teils online einsehbar',
      quelleHinweis: 'Denkmalschutzgesetz NRW vom 13. April 2022',
    },
    auslaenderregister: {
      kurz: 'Ausländerbehörden sind die Kreise und kreisfreien Städte. Die Terminlage in den Großstädten ist angespannt - der fristwahrende schriftliche oder digitale Antrag vor Ablauf des Titels ist in NRW Alltagspraxis.',
      fakten: [
        'Für die Fachkräfteeinwanderung bündeln zentrale Stellen bei den Bezirksregierungen beschleunigte Verfahren.',
        'Viele NRW-Ausländerbehörden bieten digitale Antragsstrecken mit Upload; die Abholung des eAT bleibt persönlich.',
      ],
      portal: 'Digitale Antragsassistenten der Kommunen',
    },
    einbuergerung: {
      kurz: 'Einbürgerungsbehörden sind die Kreise und kreisfreien Städte. Nach der Reform 2024 sind die Antragszahlen stark gestiegen; in Köln und Düsseldorf liegen Wartezeiten teils über einem Jahr.',
      fakten: [
        'Mehrere NRW-Städte haben digitale Einbürgerungsanträge mit Vorab-Check eingeführt.',
        'Der Einbürgerungstest wird an Volkshochschulen abgenommen; Termine früh buchen.',
      ],
      portal: 'Einbürgerungsportale der Städte',
    },
    sozialregister: {
      kurz: 'Besonderheit NRW: Die Feststellung der Schwerbehinderung ist seit 2008 kommunalisiert - zuständig sind die Kreise und kreisfreien Städte, nicht ein zentrales Landesamt.',
      fakten: [
        'Der Schwerbehindertenantrag läuft in NRW online über das Portal ELFE der Kommunen beziehungsweise die kommunalen Serviceportale.',
        'Wohngeld beantragen Sie bei der Wohngeldstelle der Gemeinde; viele Kommunen nutzen den digitalen Wohngeldantrag des Landes.',
        'Beim Wohnberechtigungsschein gelten die Einkommensgrenzen des Wohnraumfördergesetzes NRW; sie liegen vergleichsweise hoch.',
      ],
      portal: 'Kommunale Serviceportale; wohngeldrechner.nrw.de',
    },
    schulwesen: {
      kurz: 'Stichtag in NRW: Kinder, die bis zum 30. September sechs Jahre alt werden, sind ab 1. August schulpflichtig. Die Grundschulbezirke sind seit 2008 abgeschafft - Eltern wählen die Grundschule frei, begrenzt nur durch die Kapazität.',
      fakten: [
        'Anmeldung im Herbst des Vorjahres; die Stadt informiert die Eltern schulpflichtiger Kinder schriftlich.',
        'Bei Anmeldeüberhängen entscheidet die Schulleitung nach festgelegten Kriterien, etwa Geschwisterkind und Schulweg.',
        'Schülerfahrkosten übernimmt der Schulträger ab 2 km (Grundschule), 3,5 km (Sekundarstufe I) und 5 km (Sekundarstufe II).',
      ],
      portal: 'Schulportale der Kommunen',
      quelleHinweis: 'Schulgesetz NRW § 35; Schülerfahrkostenverordnung NRW',
    },
    kindertagesbetreuung: {
      kurz: 'In NRW sind die letzten zwei Kindergartenjahre vor der Einschulung beitragsfrei. Darunter setzen die Jugendämter die Elternbeiträge selbst fest - die Unterschiede zwischen Städten sind erheblich.',
      fakten: [
        'Platzvergabe fast flächendeckend über Kita-Navigator oder Little Bird des jeweiligen Jugendamts.',
        'Elterngeldstellen sind die Kreise und kreisfreien Städte; der Antrag läuft über ElterngeldDigital.',
        'Rechtsgrundlage der Förderung ist das Kinderbildungsgesetz (KiBiz).',
      ],
      portal: 'Kita-Portale der Jugendämter; ElterngeldDigital',
      quelleHinweis: 'Kinderbildungsgesetz NRW (KiBiz)',
    },
    'kommunalsteuern-ordnung': {
      kurz: 'Drei NRW-Besonderheiten: eigene Regeln für große Hunde, ein eigenes Versammlungsgesetz und seit 2025 die Möglichkeit differenzierter Grundsteuer-Hebesätze für Wohn- und Nichtwohngrundstücke.',
      fakten: [
        'Landeshundegesetz NRW: Hunde ab 40 cm Widerristhöhe oder 20 kg gelten als "große Hunde" - Anzeige beim Ordnungsamt, Sachkundenachweis, Mikrochip und Haftpflichtversicherung sind Pflicht; für gefährliche Hunde gilt Erlaubnispflicht.',
        'Versammlungsgesetz NRW (2022): Anzeige spätestens 48 Stunden vor Bekanntgabe bei der Polizei als Versammlungsbehörde.',
        'Hundesteuer: kommunal, in Großstädten typischerweise 96 bis 180 Euro für den ersten Hund.',
        'Grundsteuer nach Bundesmodell; Kommunen dürfen seit 2025 für Wohn- und Nichtwohngrundstücke unterschiedliche Hebesätze festsetzen.',
      ],
      portal: 'Serviceportale der Ordnungs- und Steuerämter',
      quelleHinweis: 'LHundG NRW; VersG NRW 2022; NRW-Hebesatzgesetz 2024',
    },
  },

  leistungen: {
    kirchenaustritt: {
      zustaendigkeit: { stelle: 'Amtsgericht des Wohnsitzes', hinweis: 'In NRW erklären Sie den Austritt beim Amtsgericht, nicht beim Standesamt. Notarielle beglaubigte Erklärung ist alternativ möglich.' },
      gebuehren: [{ position: 'Austrittserklärung', betrag: '30,00 Euro', art: 'landesrecht' }],
      besonderheiten: ['Kirchensteuer endet mit Ablauf des Erklärungsmonats.'],
      rechtsgrundlagen: ['Kirchenaustrittsgesetz NRW'],
      stand: '2026-08',
    },
    bestattung: {
      fristen: [
        'Bestattung frühestens 24 Stunden nach Eintritt des Todes.',
        'Erd- oder Feuerbestattung spätestens zehn Tage nach der Todesfeststellung.',
      ],
      besonderheiten: [
        'Bestattung ohne Sarg im Leichentuch aus religiösen Gründen zulässig, wenn die Friedhofssatzung es vorsieht.',
      ],
      rechtsgrundlagen: ['Bestattungsgesetz NRW'],
      stand: '2026-08',
    },
    sterbefall: {
      fristen: ['Bestattungsfrist NRW: spätestens zehn Tage nach Todesfeststellung; frühestens nach 24 Stunden.'],
      rechtsgrundlagen: ['Bestattungsgesetz NRW'],
      stand: '2026-08',
    },
    eheschliessung: {
      gebuehren: [
        { position: 'Anmeldung der Eheschließung (beide Verlobte deutsches Recht)', betrag: 'etwa 40 Euro', art: 'landesrecht' },
        { position: 'Anmeldung mit Prüfung ausländischen Rechts', betrag: 'etwa 66 Euro', art: 'landesrecht' },
      ],
      stand: '2026-08',
    },
    personenstandsurkunde: {
      gebuehren: [
        { position: 'Personenstandsurkunde', betrag: 'etwa 10 Euro', art: 'landesrecht' },
        { position: 'Weitere Ausfertigung im selben Vorgang', betrag: 'etwa 5 Euro', art: 'landesrecht' },
      ],
      stand: '2026-08',
    },
    bauantrag: {
      besonderheiten: [
        'Verfahrensfrei nach § 62 BauO NRW: Gebäude bis 75 m³ Brutto-Rauminhalt ohne Aufenthaltsräume, Toiletten oder Feuerstätten - nicht im Außenbereich.',
        'Genehmigungsfreistellung nach § 63 BauO NRW für Wohngebäude im Geltungsbereich eines Bebauungsplans.',
        'Digitale Einreichung über das Bauportal.NRW; viele Bauaufsichten nehmen nur noch digital an.',
      ],
      fristen: ['Geltungsdauer der Baugenehmigung in NRW: drei Jahre ab Erteilung, Verlängerung um jeweils bis zu zwei Jahre möglich.'],
      rechtsgrundlagen: ['BauO NRW 2018'],
      online: 'Bauportal.NRW - digitaler Bauantrag, landesweit',
      stand: '2026-08',
    },
    'denkmalschutz-erlaubnis': {
      zustaendigkeit: { stelle: 'Untere Denkmalbehörde der Stadt oder Gemeinde', hinweis: 'In NRW ist die Gemeinde selbst Untere Denkmalbehörde; fachlich beraten die Denkmalpflegeämter der Landschaftsverbände.' },
      besonderheiten: ['Solaranlagen auf Denkmälern sind nach dem DSchG NRW 2022 in der Regel zu gestatten, wenn das Erscheinungsbild nicht erheblich beeinträchtigt wird.'],
      rechtsgrundlagen: ['Denkmalschutzgesetz NRW 2022'],
      stand: '2026-08',
    },
    gaststaettenerlaubnis: {
      besonderheiten: [
        'In NRW gilt das Gaststättengesetz des Bundes fort - die Erlaubnis für den Alkoholausschank ist weiterhin erforderlich.',
        'Allgemeine Sperrzeit nur von 5 bis 6 Uhr; Kommunen können per Verordnung abweichen.',
      ],
      stand: '2026-08',
    },
    bewohnerparkausweis: {
      gebuehren: [{ position: 'Bewohnerparkausweis pro Jahr', betrag: 'kommunal, z. B. Köln 100 Euro; Spanne in NRW etwa 30 bis 120 Euro', art: 'kommunal' }],
      besonderheiten: ['NRW hat die Gebührenfestsetzung 2022 auf die Kommunen übertragen; die alte Obergrenze von 30,70 Euro gilt nicht mehr.'],
      rechtsgrundlagen: ['Bewohnerparkgebührenverordnung NRW'],
      stand: '2026-08',
    },
    schwerbehindertenausweis: {
      zustaendigkeit: { stelle: 'Kreis oder kreisfreie Stadt (Amt für Soziales/Schwerbehindertenrecht)', hinweis: 'In NRW ist die Feststellung seit 2008 kommunalisiert - es gibt kein zentrales Versorgungsamt mehr.' },
      online: 'Online-Antrag über die kommunalen Portale (ELFE-Verbund)',
      stand: '2026-08',
    },
    schulanmeldung: {
      fristen: ['Stichtag NRW: Wer bis zum 30. September sechs Jahre alt wird, ist ab dem 1. August desselben Jahres schulpflichtig.'],
      besonderheiten: [
        'Freie Grundschulwahl: Die Schulbezirke wurden 2008 abgeschafft; Anspruch besteht auf Aufnahme in die nächstgelegene Grundschule im Rahmen der Kapazität.',
        'Schülerfahrkosten ab 2 km (Grundschule), 3,5 km (Sek. I), 5 km (Sek. II).',
      ],
      rechtsgrundlagen: ['Schulgesetz NRW § 35', 'Schülerfahrkostenverordnung NRW'],
      stand: '2026-08',
    },
    'kita-platz': {
      gebuehren: [{ position: 'Elternbeitrag', betrag: 'letzte zwei Kita-Jahre beitragsfrei; darunter einkommensabhängig je Jugendamt', art: 'kommunal' }],
      besonderheiten: ['Rechtsgrundlage ist das Kinderbildungsgesetz (KiBiz); die Beitragssatzungen der Jugendämter weichen stark voneinander ab.'],
      rechtsgrundlagen: ['Kinderbildungsgesetz NRW (KiBiz)'],
      stand: '2026-08',
    },
    hundesteuer: {
      besonderheiten: [
        'Zusätzlich zur Steuer gilt das Landeshundegesetz: große Hunde (ab 40 cm oder 20 kg) sind dem Ordnungsamt anzuzeigen; Sachkundenachweis, Mikrochip und Haftpflichtversicherung sind Pflicht.',
        'Gefährliche Hunde nach § 3 LHundG brauchen eine Erlaubnis mit Wesenstest.',
      ],
      gebuehren: [{ position: 'Hundesteuer erster Hund (Großstädte NRW)', betrag: 'typisch etwa 96 bis 180 Euro im Jahr', art: 'kommunal' }],
      rechtsgrundlagen: ['Landeshundegesetz NRW', 'kommunale Hundesteuersatzungen'],
      stand: '2026-08',
    },
    'veranstaltung-anmelden': {
      besonderheiten: ['NRW hat seit 2022 ein eigenes Versammlungsgesetz: Anzeige spätestens 48 Stunden vor Bekanntgabe bei der Polizei als Versammlungsbehörde.'],
      rechtsgrundlagen: ['Versammlungsgesetz NRW (2022)'],
      stand: '2026-08',
    },
    grundsteuer: {
      besonderheiten: [
        'NRW wendet das Bundesmodell an.',
        'Seit 2025 dürfen NRW-Kommunen für Wohn- und Nichtwohngrundstücke unterschiedliche Hebesätze festsetzen, um Belastungsverschiebungen abzufedern.',
      ],
      rechtsgrundlagen: ['NRW-Gesetz über differenzierende Hebesätze (2024)'],
      stand: '2026-08',
    },
    gewerbeanmeldung: {
      online: 'Landesweit digital über das Wirtschafts-Service-Portal.NRW; die Kommune bleibt zuständig.',
      gebuehren: [{ position: 'Gewerbeanmeldung', betrag: 'in NRW typisch etwa 20 bis 60 Euro', art: 'kommunal' }],
      stand: '2026-08',
    },
    wohnberechtigungsschein: {
      besonderheiten: ['Einkommensgrenzen nach dem Wohnraumfördergesetz NRW (WFNG); sie liegen über dem Bundesrahmen, sodass auch mittlere Einkommen anspruchsberechtigt sein können.'],
      rechtsgrundlagen: ['Wohnraumfördergesetz NRW'],
      stand: '2026-08',
    },
    'wohnsitz-anmeldung': {
      besonderheiten: ['Die elektronische Wohnsitzanmeldung ist in vielen NRW-Kommunen verfügbar, darunter Köln, Düsseldorf und Dortmund.'],
      online: 'wohnsitzanmeldung.gov.de - elektronische Wohnsitzanmeldung',
      stand: '2026-08',
    },
    meldebescheinigung: {
      gebuehren: [{ position: 'Meldebescheinigung', betrag: 'in NRW typischerweise um 9 bis 10 Euro', art: 'landesrecht' }],
      stand: '2026-08',
    },
  },
};
