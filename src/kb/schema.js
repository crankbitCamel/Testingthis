/**
 * Datenmodell der Wissensbasis.
 *
 * Die Wissensbasis ist dreistufig aufgebaut - genau entlang des Dialogverlaufs,
 * den ein 115-Gespraech nimmt:
 *
 *   Stufe 1  CLUSTER      Grobes Bereichswissen ("was gilt hier ueberhaupt")
 *   Stufe 2  LEISTUNG     Konkrete Verwaltungsdienstleistung (LeiKa-orientiert)
 *   Stufe 3  ASPEKT       Einzelner Detailaspekt einer Leistung (Unterlagen,
 *                         Kosten, Ablauf, Fristen, Rechtsgrundlagen ...)
 *
 * Der Voice-Bot klassifiziert eine offene Frage zunaechst nur auf Stufe 1,
 * liefert dort das Bereichswissen und laesst den Anrufer per "1, 2 oder 3"
 * auf Stufe 2 und danach auf Stufe 3 praezisieren (progressive disclosure).
 *
 * @typedef {Object} Cluster
 * @property {string}   id            Stabiler Schluessel, z.B. "melde-ausweis"
 * @property {string}   name          Anzeigename
 * @property {string}   sprechName    Fuer die Sprachausgabe optimierter Name
 * @property {string[]} lebenslagen   Lebenslagen im Sinne des LeiKa
 * @property {string[]} stichworte    Trigger fuer die Intent-Erkennung
 * @property {Grundsatzwissen} grundsatzwissen  Stufe-1-Antwort des Bots
 *
 * @typedef {Object} Grundsatzwissen
 * @property {string}   kurz              Ein Satz, wird immer vorgelesen
 * @property {string}   zustaendigkeit    Wer macht das ueblicherweise
 * @property {string[]} faustregeln       "Grob gilt hier ..." - 3 bis 6 Regeln
 * @property {string[]} typischeUnterlagen
 * @property {string[]} typischeFristen
 * @property {string}   typischeKosten
 * @property {string[]} onlineWege
 * @property {string[]} rechtsrahmen      Zentrale Gesetze des Bereichs
 * @property {string[]} haeufigeIrrtuemer
 *
 * @typedef {Object} Leistung
 * @property {string}   id
 * @property {string}   cluster           id des Clusters
 * @property {string}   name
 * @property {string}   sprechName
 * @property {string[]} synonyme          Umgangssprache, Dialekt, Tippfehler-Varianten
 * @property {string}   leikaBezug        LeiKa-/Verwaltungsbezeichnung (Orientierung)
 * @property {string}   kurzbeschreibung  1-2 Saetze, Stufe-2-Antwort
 * @property {Zustaendigkeit} zustaendigkeit
 * @property {string[]} voraussetzungen
 * @property {Unterlage[]} unterlagen
 * @property {Gebuehr[]} gebuehren
 * @property {string[]} fristen
 * @property {string}   bearbeitungsdauer
 * @property {Schritt[]} ablauf
 * @property {string[]} rechtsgrundlagen
 * @property {OnlineVerfahren} online
 * @property {string[]} haeufigeFehler
 * @property {Faq[]}    faq
 * @property {string[]} verwandt          ids verwandter Leistungen
 * @property {string}   eskalation        Wann an Menschen weiterleiten
 * @property {Belastbarkeit} belastbarkeit
 * @property {string}   stand             Redaktionsstand
 *
 * @typedef {Object} Zustaendigkeit
 * @property {string} stelle              z.B. "Buergeramt / Einwohnermeldeamt"
 * @property {"kommunal"|"land"|"bund"|"sonstige"} ebene
 * @property {string} hinweis             Besonderheiten der Zustaendigkeit
 *
 * @typedef {Object} Unterlage
 * @property {string}  was
 * @property {boolean} pflicht
 * @property {string} [hinweis]
 *
 * @typedef {Object} Gebuehr
 * @property {string} position
 * @property {string} betrag              Klartext, inkl. Spannen bei kommunaler Satzung
 * @property {"bundeseinheitlich"|"landesrecht"|"kommunal"|"einkommensabhaengig"|"keine"} art
 * @property {string} [hinweis]
 *
 * @typedef {Object} Schritt
 * @property {number} nr
 * @property {string} titel
 * @property {string} detail
 * @property {string} [akteur]            Wer handelt: "Buerger", "Behoerde", "Dritte"
 *
 * @typedef {Object} OnlineVerfahren
 * @property {boolean} moeglich
 * @property {string}  hinweis
 * @property {string[]} [voraussetzungen] z.B. "eID mit PIN", "BundID-Konto"
 *
 * @typedef {Object} Faq
 * @property {string} frage
 * @property {string} antwort
 *
 * @typedef {Object} Belastbarkeit
 * @property {"bundesrecht"|"landesrecht-variiert"|"kommunal-variiert"} quelle
 * @property {string} hinweis             Wird bei kommunaler Varianz vorgelesen
 */

/** Die vom Dialog ansteuerbaren Detailaspekte einer Leistung (Stufe 3). */
export const ASPEKTE = [
  {
    id: 'unterlagen',
    name: 'Benötigte Unterlagen',
    sprechName: 'welche Unterlagen Sie brauchen',
    stichworte: ['unterlagen', 'dokumente', 'papiere', 'mitbringen', 'brauche ich', 'benötige', 'nachweis', 'nachweise', 'was muss ich mitbringen'],
  },
  {
    id: 'kosten',
    name: 'Kosten und Bearbeitungsdauer',
    sprechName: 'was es kostet und wie lange es dauert',
    stichworte: ['kosten', 'gebühr', 'gebühren', 'preis', 'teuer', 'bezahlen', 'dauer', 'dauert', 'wie lange', 'wartezeit', 'bearbeitungszeit'],
  },
  {
    id: 'ablauf',
    name: 'Ablauf Schritt für Schritt',
    sprechName: 'wie der Ablauf Schritt für Schritt ist',
    stichworte: ['ablauf', 'schritte', 'vorgehen', 'wie geht', 'wie mache ich', 'prozess', 'verfahren', 'anleitung', 'wie läuft', 'läuft das ab', 'abläuft', 'was passiert dann', 'reihenfolge'],
  },
  {
    id: 'voraussetzungen',
    name: 'Voraussetzungen',
    sprechName: 'welche Voraussetzungen gelten',
    stichworte: ['voraussetzung', 'voraussetzungen', 'bedingung', 'bedingungen', 'anspruch', 'berechtigt', 'darf ich', 'wer kann'],
  },
  {
    id: 'fristen',
    name: 'Fristen und Termine',
    sprechName: 'welche Fristen gelten',
    stichworte: ['frist', 'fristen', 'termin', 'wann muss', 'zu spät', 'verspätet', 'rechtzeitig', 'stichtag'],
  },
  {
    id: 'zustaendigkeit',
    name: 'Zuständige Stelle',
    sprechName: 'wer dafür zuständig ist',
    stichworte: ['zuständig', 'zuständigkeit', 'wohin', 'wo muss ich hin', 'welches amt', 'welche behörde', 'ansprechpartner'],
  },
  {
    id: 'online',
    name: 'Online-Erledigung',
    sprechName: 'ob das online geht',
    stichworte: ['online', 'digital', 'internet', 'ohne termin', 'von zuhause', 'elektronisch', 'app', 'portal'],
  },
  {
    id: 'rechtsgrundlagen',
    name: 'Rechtsgrundlagen',
    sprechName: 'auf welchen Rechtsgrundlagen das beruht',
    stichworte: ['gesetz', 'rechtsgrundlage', 'paragraf', 'paragraph', 'verordnung', 'rechtlich', 'vorschrift'],
  },
  {
    id: 'fehler',
    name: 'Häufige Fehler und Stolperfallen',
    sprechName: 'welche Fehler häufig passieren',
    stichworte: ['fehler', 'stolperfalle', 'problem', 'abgelehnt', 'falsch gemacht', 'worauf achten', 'aufpassen'],
  },
  {
    id: 'faq',
    name: 'Häufige Fragen',
    sprechName: 'die häufigsten Fragen dazu',
    stichworte: ['frage', 'fragen', 'faq', 'sonderfall', 'ausnahme', 'was ist wenn'],
  },
];

/** Reihenfolge, in der Aspekte im Menue der Stufe 3 angeboten werden. */
export const ASPEKT_MENUE = ['unterlagen', 'kosten', 'ablauf', 'voraussetzungen', 'fristen', 'online'];

export const ASPEKT_BY_ID = Object.fromEntries(ASPEKTE.map((a) => [a.id, a]));
