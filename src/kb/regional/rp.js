/**
 * Landesprofil Rheinland-Pfalz.
 *
 * Aufbau wie nw.js. Praegend fuer RP: die Verbandsgemeinden als buergernahe
 * Verwaltungsebene, das Kita-Zukunftsgesetz mit Beitragsfreiheit ab zwei
 * Jahren, das neue Bestattungsgesetz von 2025 und die Weinbau-Privilegien
 * im Gaststaettenrecht.
 */
export const LAND = {
  code: 'rp',
  name: 'Rheinland-Pfalz',
  kuerzel: 'RP',
  stichworte: [
    'rp', 'rlp', 'rheinland-pfalz', 'rheinland pfalz', 'mainz', 'ludwigshafen', 'koblenz',
    'trier', 'kaiserslautern', 'worms', 'neuwied', 'neustadt an der weinstraße', 'speyer',
    'frankenthal', 'landau', 'pirmasens', 'zweibrücken', 'bad kreuznach', 'ingelheim',
    'idar-oberstein', 'bingen', 'andernach', 'verbandsgemeinde',
  ],
  stand: '2026-08',

  registerprofile: {
    meldewesen: {
      kurz: 'Meldebehörden sind in Rheinland-Pfalz die Verbandsgemeindeverwaltungen, verbandsfreien Gemeinden und Stadtverwaltungen. Außerhalb der Städte ist die Verbandsgemeinde die richtige Anlaufstelle - nicht die Ortsgemeinde.',
      fakten: [
        'Die Verbandsgemeinde erledigt Melde-, Pass- und viele Ordnungsangelegenheiten für ihre Ortsgemeinden zentral.',
        'Die elektronische Wohnsitzanmeldung ist in einem wachsenden Teil der rheinland-pfälzischen Kommunen verfügbar.',
      ],
      portal: 'Verwaltungsportal Rheinland-Pfalz (service.rlp.de) und kommunale Portale',
    },
    passwesen: {
      kurz: 'Pass- und Ausweisgebühren sind bundeseinheitlich. Anlaufstelle ist das Bürgerbüro der Verbandsgemeinde- oder Stadtverwaltung; die Terminlage ist außerhalb der großen Städte meist entspannt.',
      fakten: [
        'Digitale Lichtbildterminals stehen inzwischen in den meisten Bürgerbüros.',
      ],
      portal: 'Terminvergabe über die Kommunalportale',
    },
    justizregister: {
      kurz: 'Führungszeugnis und Gewerbezentralregisterauszug sind Bundesleistungen (13 Euro) ohne Landesbesonderheiten; das Bürgerbüro nimmt Anträge entgegen.',
      fakten: ['Der Online-Antrag beim Bundesamt für Justiz mit eID erspart den Behördengang.'],
      portal: 'fuehrungszeugnis.bund.de',
    },
    geburtenregister: {
      kurz: 'Standesämter sind bei den Verbandsgemeinden und Stadtverwaltungen angesiedelt. Personenstandsurkunden kosten in Rheinland-Pfalz etwa 12 Euro.',
      fakten: [
        'Urkunden für Eltern- und Kindergeldzwecke sind gebührenfrei (§ 68 PStG).',
        'Online-Urkundenbestellung über das Landesportal oder die Kommunalportale.',
      ],
      portal: 'service.rlp.de - Urkundenbestellung',
    },
    eheregister: {
      kurz: 'Die Anmeldung der Eheschließung kostet in Rheinland-Pfalz je nach Konstellation etwa 40 bis 90 Euro; bei Auslandsbeteiligung mehr. Trauorte in Weingütern und Burgen sind verbreitet und kosten kommunale Zuschläge.',
      fakten: [
        'Zuständig ist das Standesamt der Verbandsgemeinde oder Stadt des Wohnsitzes.',
      ],
      portal: 'Online-Terminreservierung vieler Standesämter',
    },
    sterberegister: {
      kurz: 'Seit Oktober 2025 gilt ein neues Bestattungsgesetz: Bestattung frühestens 48 Stunden nach dem Tod, spätestens 14 Tage danach - die längste Frist unter den Flächenländern.',
      fakten: [
        'Die Frist wurde 2019 von 7 auf 10 und 2025 auf 14 Tage verlängert - das entzerrt die Terminplanung für Angehörige spürbar.',
        'Bestattung ohne Sarg im Tuch ist aus religiösen oder weltanschaulichen Gründen zulässig.',
        'Das neue Gesetz lockert weitere Vorgaben des Friedhofszwangs; Details regeln die Friedhofssatzungen.',
      ],
      portal: null,
      quelleHinweis: 'Bestattungsgesetz Rheinland-Pfalz, Neufassung in Kraft seit Oktober 2025',
    },
    kirchenaustritt: {
      kurz: 'In Rheinland-Pfalz erklären Sie den Kirchenaustritt beim Standesamt - persönlich oder über eine notariell beglaubigte Erklärung. Die Gebühr beträgt 30 Euro.',
      fakten: [
        'Mitzubringen: Personalausweis oder Reisepass; bei auswärts Getauften hilft der Taufort, ist aber nicht Pflicht.',
        'Zuständig ist das Standesamt der Verbandsgemeinde- oder Stadtverwaltung des Wohnsitzes.',
      ],
      portal: 'service.rlp.de - Kirchenaustritt',
      quelleHinweis: 'Landesgesetz über den Austritt aus Religionsgemeinschaften RP',
    },
    fahrzeugregister: {
      kurz: 'Zulassungsbehörden sind die Kreisverwaltungen und die Stadtverwaltungen der kreisfreien Städte. Alle i-Kfz-Stufen sind verfügbar.',
      fakten: [
        'In Flächenkreisen betreiben mehrere Kreisverwaltungen Außenstellen für Zulassungen - vorab prüfen, welche Stelle Termine anbietet.',
      ],
      portal: 'i-Kfz-Portale der Kreisverwaltungen',
    },
    fahrerlaubnisregister: {
      kurz: 'Fahrerlaubnisbehörden sind die Kreis- und Stadtverwaltungen. Der Führerscheinumtausch läuft vielerorts schriftlich ohne Termin.',
      fakten: ['Karteikartenabschriften aus anderen Bundesländern fordert die Behörde selbst an.'],
      portal: 'Onlineanträge vieler Kreisverwaltungen',
    },
    parkraum: {
      kurz: 'Rheinland-Pfalz hat die Festsetzung der Bewohnerparkgebühren per Landesverordnung auf die Kommunen übertragen. Mainz und andere Städte haben die Gebühren seither deutlich angehoben.',
      fakten: [
        'Die Spanne reicht in RP von rund 30 Euro in kleineren Städten bis über 100 Euro in Mainz.',
        'Der blaue EU-Parkausweis für Merkzeichen aG und Bl bleibt bundesrechtlich und gebührenfrei.',
      ],
      portal: 'Onlineanträge der Straßenverkehrsbehörden',
      quelleHinweis: 'Landesverordnung über Bewohnerparkgebühren RP; kommunale Satzungen',
    },
    gewerberegister: {
      kurz: 'Die Gewerbeanmeldung läuft über das Gewerbeamt der Verbandsgemeinde- oder Stadtverwaltung, digital über das Verwaltungsportal Rheinland-Pfalz.',
      fakten: ['Die Gebühr liegt in RP typischerweise bei etwa 20 bis 50 Euro.'],
      portal: 'service.rlp.de - Gewerbeanmeldung online',
    },
    gaststaettenwesen: {
      kurz: 'Auch in Rheinland-Pfalz gilt das Gaststättengesetz des Bundes fort - für Alkoholausschank ist die Erlaubnis nötig. Die praktisch wichtige Ausnahme im Weinland: Straußwirtschaften.',
      fakten: [
        'Winzer dürfen selbsterzeugten Wein bis zu vier Monate im Jahr ohne Gaststättenerlaubnis ausschenken - die Straußwirtschaft muss nur angezeigt werden.',
        'Für Speisen in der Straußwirtschaft gelten enge Grenzen ("kalte Küche" und einfache warme Gerichte je nach Kommune).',
      ],
      portal: 'Gewerbe- und Ordnungsämter der Verbandsgemeinden',
      quelleHinweis: 'Gaststättengesetz des Bundes; § 14 GastG (Straußwirtschaft)',
    },
    bauaufsicht: {
      kurz: 'Es gilt die Landesbauordnung Rheinland-Pfalz. Genehmigungsfrei sind Gebäude bis 50 Kubikmeter umbauten Raums ohne Aufenthaltsräume - im Außenbereich nur bis 10 Kubikmeter.',
      fakten: [
        'Die Baugenehmigung erlischt in RP erst nach vier Jahren ohne Baubeginn - ein Jahr später als in den meisten Ländern.',
        'Untere Bauaufsichtsbehörden sind die Kreisverwaltungen und die großen kreisangehörigen sowie kreisfreien Städte.',
        'Der digitale Bauantrag wird landesweit ausgerollt.',
      ],
      portal: 'Bauportale der Kreisverwaltungen',
      quelleHinweis: 'Landesbauordnung Rheinland-Pfalz § 62 (genehmigungsfreie Vorhaben)',
    },
    denkmalliste: {
      kurz: 'Fachbehörde ist die Generaldirektion Kulturelles Erbe (GDKE) in Mainz; Untere Denkmalschutzbehörden sind die Kreisverwaltungen und kreisfreien Städte.',
      fakten: [
        'Die Denkmallisten sind über die GDKE einsehbar.',
        'Für energetische Maßnahmen an Denkmälern gilt eine Abwägungsklausel zugunsten erneuerbarer Energien.',
      ],
      portal: 'gdke.rlp.de',
      quelleHinweis: 'Denkmalschutzgesetz Rheinland-Pfalz',
    },
    auslaenderregister: {
      kurz: 'Ausländerbehörden sind die Kreisverwaltungen und Stadtverwaltungen der kreisfreien Städte; die Aufsicht führt die Aufsichts- und Dienstleistungsdirektion (ADD) in Trier.',
      fakten: [
        'Für beschleunigte Fachkräfteverfahren ist das Landesamt für Migration zuständig geworden; Details nennt die ADD.',
        'Digitale Antragsstrecken sind je Kreisverwaltung unterschiedlich weit.',
      ],
      portal: 'service.rlp.de; Portale der Kreisverwaltungen',
    },
    einbuergerung: {
      kurz: 'Einbürgerungsbehörden sind die Kreis- und Stadtverwaltungen unter Aufsicht der ADD Trier. Die Bearbeitungszeiten liegen meist unter denen der NRW-Großstädte.',
      fakten: ['Der Einbürgerungstest wird an Volkshochschulen abgelegt; die Landesfragen betreffen Rheinland-Pfalz.'],
      portal: 'service.rlp.de - Einbürgerung',
    },
    sozialregister: {
      kurz: 'Besonderheit RP: Die Schwerbehindertenfeststellung ist zentralisiert beim Landesamt für Soziales, Jugend und Versorgung (LSJV) - anders als im kommunalisierten NRW.',
      fakten: [
        'Der Schwerbehindertenantrag läuft online über das LSJV; Außenstellen bestehen in Koblenz, Landau, Mainz und Trier.',
        'Wohngeld beantragen Sie bei der Verbandsgemeinde- oder Stadtverwaltung.',
        'Beim Wohnberechtigungsschein gelten die Einkommensgrenzen des Landeswohnraumförderungsgesetzes RP.',
      ],
      portal: 'lsjv.rlp.de; service.rlp.de',
    },
    schulwesen: {
      kurz: 'Stichtag in Rheinland-Pfalz: Kinder, die bis zum 31. August sechs Jahre alt werden, sind schulpflichtig. Für Grundschulen gelten Schulbezirke - die zuständige Schule bestimmt der Wohnort.',
      fakten: [
        'Später geborene Kinder können auf Antrag als "Kann-Kinder" vorzeitig eingeschult werden.',
        'Der Besuch einer anderen als der Sprengelgrundschule braucht einen Gestattungsantrag über die Schulbehörde.',
        'Schülerbeförderung organisieren die Kreisverwaltungen; in der Primarstufe ab 2 km, in der Sekundarstufe I ab 4 km Fußweg.',
      ],
      portal: 'Schulportale der Kreis- und Stadtverwaltungen',
      quelleHinweis: 'Schulgesetz Rheinland-Pfalz § 57',
    },
    kindertagesbetreuung: {
      kurz: 'Rheinland-Pfalz ist beim Kita-Beitrag bundesweit Vorreiter: Der Kindergarten ist ab dem vollendeten zweiten Lebensjahr beitragsfrei, und ab zwei Jahren besteht ein landesrechtlicher Anspruch auf einen Kita-Platz mit durchgehender siebenstündiger Betreuung.',
      fakten: [
        'Rechtsgrundlage ist das Kita-Zukunftsgesetz (KiTaG 2021).',
        'Nur für unter Zweijährige und für Verpflegung fallen Beiträge an; das Mittagessen wird gesondert berechnet.',
        'Elterngeldstellen sind die Kreisverwaltungen und Stadtverwaltungen der kreisfreien Städte.',
      ],
      portal: 'kita.rlp.de; kommunale Vormerksysteme',
      quelleHinweis: 'Kita-Zukunftsgesetz Rheinland-Pfalz (KiTaG), in Kraft seit 1. Juli 2021',
    },
    'kommunalsteuern-ordnung': {
      kurz: 'Rheinland-Pfalz wendet bei der Grundsteuer das Bundesmodell an. Beim Hunderecht kennt RP - anders als NRW - keine Regeln für "große Hunde", sondern nur die Erlaubnispflicht für gefährliche Hunde bestimmter Rassen.',
      fakten: [
        'Gefährliche Hunde nach dem LHundG RP (u. a. Pitbull Terrier, American Staffordshire Terrier, Staffordshire Bullterrier): Erlaubnis, Sachkunde, Wesenstest, Haftpflicht und erhöhte Steuer.',
        'Versammlungen richten sich nach dem fortgeltenden Versammlungsgesetz des Bundes (Anzeige 48 Stunden vorher).',
        'Hundesteuer: kommunal, in den Städten meist etwa 60 bis 190 Euro für den ersten Hund.',
      ],
      portal: 'Serviceportale der Ordnungs- und Steuerämter',
      quelleHinweis: 'Landesgesetz über gefährliche Hunde RP; VersG des Bundes',
    },
  },

  leistungen: {
    kirchenaustritt: {
      zustaendigkeit: { stelle: 'Standesamt der Verbandsgemeinde- oder Stadtverwaltung des Wohnsitzes', hinweis: 'In Rheinland-Pfalz beim Standesamt - nicht beim Amtsgericht. Alternativ notariell beglaubigte Erklärung.' },
      gebuehren: [{ position: 'Austrittserklärung', betrag: '30,00 Euro', art: 'landesrecht' }],
      rechtsgrundlagen: ['Landesgesetz über den Austritt aus Religionsgemeinschaften RP'],
      stand: '2026-08',
    },
    bestattung: {
      fristen: [
        'Bestattung frühestens 48 Stunden nach Eintritt des Todes.',
        'Bestattung spätestens 14 Tage nach dem Tod - seit dem neuen Bestattungsgesetz von Oktober 2025.',
      ],
      besonderheiten: [
        'Tuchbestattung ohne Sarg aus religiösen oder weltanschaulichen Gründen zulässig.',
        'Das neue Bestattungsgesetz 2025 lockert weitere Vorgaben; maßgeblich bleiben die Friedhofssatzungen.',
      ],
      rechtsgrundlagen: ['Bestattungsgesetz Rheinland-Pfalz (Neufassung 2025)'],
      stand: '2026-08',
    },
    sterbefall: {
      fristen: ['Bestattungsfrist RP: spätestens 14 Tage nach dem Tod, frühestens nach 48 Stunden (Bestattungsgesetz 2025).'],
      rechtsgrundlagen: ['Bestattungsgesetz Rheinland-Pfalz (Neufassung 2025)'],
      stand: '2026-08',
    },
    personenstandsurkunde: {
      gebuehren: [{ position: 'Personenstandsurkunde', betrag: 'etwa 12 Euro', art: 'landesrecht' }],
      stand: '2026-08',
    },
    bauantrag: {
      besonderheiten: [
        'Genehmigungsfrei nach § 62 LBauO RP: Gebäude bis 50 m³ umbauten Raums ohne Aufenthaltsräume - im Außenbereich nur bis 10 m³.',
        'Untere Bauaufsicht: Kreisverwaltungen sowie große kreisangehörige und kreisfreie Städte.',
      ],
      fristen: ['Geltungsdauer der Baugenehmigung in RP: vier Jahre ab Erteilung - länger als in den meisten Ländern.'],
      rechtsgrundlagen: ['Landesbauordnung Rheinland-Pfalz'],
      stand: '2026-08',
    },
    'denkmalschutz-erlaubnis': {
      zustaendigkeit: { stelle: 'Untere Denkmalschutzbehörde der Kreisverwaltung oder kreisfreien Stadt', hinweis: 'Fachbehörde ist die Generaldirektion Kulturelles Erbe (GDKE) in Mainz.' },
      rechtsgrundlagen: ['Denkmalschutzgesetz Rheinland-Pfalz'],
      stand: '2026-08',
    },
    gaststaettenerlaubnis: {
      besonderheiten: [
        'Das Gaststättengesetz des Bundes gilt in RP fort - die Erlaubnis für Alkoholausschank bleibt erforderlich.',
        'Straußwirtschaft: Winzer dürfen selbsterzeugten Wein bis zu vier Monate im Jahr erlaubnisfrei ausschenken; nötig ist nur eine Anzeige bei der Verbandsgemeinde.',
      ],
      rechtsgrundlagen: ['Gaststättengesetz des Bundes', '§ 14 GastG - Straußwirtschaft'],
      stand: '2026-08',
    },
    bewohnerparkausweis: {
      gebuehren: [{ position: 'Bewohnerparkausweis pro Jahr', betrag: 'kommunal; in RP etwa 30 bis über 100 Euro, Mainz am oberen Rand', art: 'kommunal' }],
      besonderheiten: ['RP hat die Gebührenfestsetzung per Landesverordnung auf die Kommunen übertragen.'],
      stand: '2026-08',
    },
    schwerbehindertenausweis: {
      zustaendigkeit: { stelle: 'Landesamt für Soziales, Jugend und Versorgung (LSJV)', hinweis: 'In RP zentral beim Landesamt mit Standorten in Mainz, Koblenz, Landau und Trier - nicht bei der Kreisverwaltung.' },
      online: 'Online-Antrag über das LSJV (lsjv.rlp.de)',
      stand: '2026-08',
    },
    schulanmeldung: {
      fristen: ['Stichtag RP: Wer bis zum 31. August sechs Jahre alt wird, ist schulpflichtig; danach Geborene sind "Kann-Kinder" auf Antrag.'],
      besonderheiten: [
        'Für Grundschulen gelten Schulbezirke: Zuständig ist die Grundschule des Wohnbezirks; eine andere Schule braucht einen Gestattungsantrag.',
        'Schülerbeförderung über die Kreisverwaltung, Primarstufe ab 2 km, Sekundarstufe I ab 4 km.',
      ],
      rechtsgrundlagen: ['Schulgesetz Rheinland-Pfalz § 57'],
      stand: '2026-08',
    },
    'kita-platz': {
      gebuehren: [{ position: 'Elternbeitrag Kindergarten', betrag: 'ab dem vollendeten 2. Lebensjahr beitragsfrei; Verpflegung wird gesondert berechnet', art: 'landesrecht' }],
      besonderheiten: [
        'Landesrechtlicher Anspruch ab zwei Jahren auf einen Platz mit durchgehend sieben Stunden Betreuung - über den Bundesanspruch hinaus.',
      ],
      rechtsgrundlagen: ['Kita-Zukunftsgesetz Rheinland-Pfalz (KiTaG 2021)'],
      stand: '2026-08',
    },
    hundesteuer: {
      besonderheiten: [
        'Das LHundG RP kennt keine Regeln für "große Hunde" - nur gefährliche Hunde bestimmter Rassen brauchen Erlaubnis, Wesenstest und Sachkundenachweis.',
      ],
      gebuehren: [{ position: 'Hundesteuer erster Hund (Städte RP)', betrag: 'typisch etwa 60 bis 190 Euro im Jahr', art: 'kommunal' }],
      rechtsgrundlagen: ['Landesgesetz über gefährliche Hunde RP', 'kommunale Hundesteuersatzungen'],
      stand: '2026-08',
    },
    'veranstaltung-anmelden': {
      besonderheiten: ['In RP gilt das Versammlungsgesetz des Bundes fort; die Anzeige erfolgt bei der Kreisverwaltung oder der Polizei, 48 Stunden vor Bekanntgabe.'],
      stand: '2026-08',
    },
    grundsteuer: {
      besonderheiten: ['Rheinland-Pfalz wendet das Bundesmodell ohne Abweichungen an.'],
      stand: '2026-08',
    },
    gewerbeanmeldung: {
      zustaendigkeit: { stelle: 'Gewerbeamt der Verbandsgemeinde- oder Stadtverwaltung', hinweis: 'Außerhalb der Städte ist die Verbandsgemeinde zuständig, nicht die Ortsgemeinde.' },
      gebuehren: [{ position: 'Gewerbeanmeldung', betrag: 'in RP typisch etwa 20 bis 50 Euro', art: 'kommunal' }],
      online: 'Online über service.rlp.de',
      stand: '2026-08',
    },
    'wohnsitz-anmeldung': {
      zustaendigkeit: { stelle: 'Bürgerbüro der Verbandsgemeinde- oder Stadtverwaltung', hinweis: 'In RP führt die Verbandsgemeinde das Melderegister für ihre Ortsgemeinden.' },
      stand: '2026-08',
    },
    elterngeld: {
      zustaendigkeit: { stelle: 'Elterngeldstelle der Kreisverwaltung oder Stadtverwaltung der kreisfreien Stadt', hinweis: 'RP nutzt ElterngeldDigital.' },
      stand: '2026-08',
    },
  },
};
