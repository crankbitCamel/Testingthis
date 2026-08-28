/**
 * Aggregation der Wissensbasis und Aufbau der Indizes, die der Dialog braucht.
 *
 * Die Wissensbasis ist bewusst als reine Datenstruktur gehalten: Sie enthaelt
 * keine Dialoglogik und keine Formulierungen des Bots, sondern nur Fakten.
 * Alles, was gesprochen wird, entsteht in dialog.js aus diesen Daten.
 */
import { CLUSTER, CLUSTER_BY_ID } from './cluster.js';
import { ASPEKTE, ASPEKT_BY_ID, ASPEKT_MENUE } from './schema.js';

import { LEISTUNGEN as MELDE } from './leistungen/melde-ausweis.js';
import { LEISTUNGEN as KFZ } from './leistungen/kfz-verkehr.js';
import { LEISTUNGEN as FAMILIE } from './leistungen/familie-kinder.js';
import { LEISTUNGEN as EHE } from './leistungen/ehe-tod.js';
import { LEISTUNGEN as ARBEIT } from './leistungen/arbeit-soziales.js';
import { LEISTUNGEN as GEWERBE } from './leistungen/gewerbe-wirtschaft.js';
import { LEISTUNGEN as BAUEN } from './leistungen/bauen-wohnen.js';
import { LEISTUNGEN as AUSLAENDER } from './leistungen/auslaender-einbuergerung.js';
import { LEISTUNGEN as UMWELT } from './leistungen/umwelt-abfall-tiere.js';
import { LEISTUNGEN as ORDNUNG } from './leistungen/ordnung-bussgeld.js';
import { LEISTUNGEN as STEUERN } from './leistungen/steuern-abgaben.js';
import { LEISTUNGEN as BILDUNG } from './leistungen/bildung-kultur.js';

export const LEISTUNGEN = [
  ...MELDE, ...KFZ, ...FAMILIE, ...EHE, ...ARBEIT, ...GEWERBE,
  ...BAUEN, ...AUSLAENDER, ...UMWELT, ...ORDNUNG, ...STEUERN, ...BILDUNG,
];

export const LEISTUNG_BY_ID = Object.fromEntries(LEISTUNGEN.map((l) => [l.id, l]));

/** Leistungen eines Clusters, in Definitionsreihenfolge. */
export function leistungenImCluster(clusterId) {
  return LEISTUNGEN.filter((l) => l.cluster === clusterId);
}

/**
 * Aufrufhaeufigkeit als Rangfolge fuer das Ziffernmenue: Was ein 115-Kontakt
 * am ehesten meint, wenn er nur den Bereich genannt hat. Die Reihenfolge ist
 * redaktionell gesetzt, nicht statistisch erhoben, und dient nur der
 * Sortierung der Vorschlaege.
 */
export const HAEUFIGKEIT = {
  'wohnsitz-anmeldung': 100, personalausweis: 96, reisepass: 92, fuehrungszeugnis: 74,
  meldebescheinigung: 66, 'ausweis-verlust': 60, 'wohnsitz-abmeldung': 54,
  'eid-online-ausweisfunktion': 44, wohnungsgeberbestaetigung: 40, auskunftssperre: 22,
  'kfz-zulassung': 95, 'kfz-ummeldung': 88, 'kfz-abmeldung': 80, 'fuehrerschein-umtausch': 70,
  wunschkennzeichen: 58, 'fuehrerschein-ersterteilung': 56, bewohnerparkausweis: 52,
  'fuehrerschein-verlust': 48, 'internationaler-fuehrerschein': 34, schwerbehindertenparkausweis: 30,
  kindergeld: 94, elterngeld: 90, 'kita-platz': 84, geburtsurkunde: 82,
  unterhaltsvorschuss: 58, vaterschaftsanerkennung: 56, 'bildung-und-teilhabe': 50, mutterschutz: 46,
  eheschliessung: 86, sterbefall: 78, personenstandsurkunde: 68, bestattung: 55,
  kirchenaustritt: 50, ehefaehigkeitszeugnis: 36,
  buergergeld: 93, wohngeld: 89, arbeitslosengeld: 85, schwerbehindertenausweis: 72,
  sozialhilfe: 64, wohnberechtigungsschein: 54,
  gewerbeanmeldung: 91, gewerbeabmeldung: 72, gewerbeummeldung: 68, 'steuerliche-erfassung': 62,
  gaststaettenerlaubnis: 52, gewerbezentralregister: 40, reisegewerbekarte: 32,
  bauantrag: 83, bauvoranfrage: 58, 'denkmalschutz-erlaubnis': 44, abgeschlossenheitsbescheinigung: 36,
  'auslaender-aufenthaltserlaubnis': 90, einbuergerung: 86, niederlassungserlaubnis: 70,
  'anerkennung-berufsabschluss': 58, verpflichtungserklaerung: 44,
  sperrmuell: 88, muelltonne: 80, hundesteuer: 76, baumfaellgenehmigung: 52, fundbuero: 48,
  'bussgeldbescheid-einspruch': 87, halteverbotszone: 74, sondernutzungserlaubnis: 60,
  'veranstaltung-anmelden': 46,
  grundsteuer: 85, 'steuer-identifikationsnummer': 72, zweitwohnungsteuer: 62, gewerbesteuer: 56,
  schulanmeldung: 82, bafoeg: 76, schuelerbefoerderung: 58,
};

/** Die drei bis fuenf haeufigsten Leistungen eines Clusters - Basis des Ziffernmenues. */
export function topLeistungen(clusterId, anzahl = 3) {
  return leistungenImCluster(clusterId)
    .slice()
    .sort((a, b) => (HAEUFIGKEIT[b.id] ?? 0) - (HAEUFIGKEIT[a.id] ?? 0))
    .slice(0, anzahl);
}

/** Alle Suchbegriffe einer Leistung: Name, Synonyme, Cluster-Stichworte im Kontext. */
export function suchbegriffe(leistung) {
  return [
    leistung.name,
    leistung.sprechName,
    ...(leistung.synonyme ?? []),
    ...(leistung.unterlagen ?? []).map((u) => u.was),
  ];
}

export { CLUSTER, CLUSTER_BY_ID, ASPEKTE, ASPEKT_BY_ID, ASPEKT_MENUE };

/** Kennzahlen der Wissensbasis - fuer die Statusanzeige der Anwendung. */
export function kennzahlen() {
  const prozessschritte = LEISTUNGEN.reduce((s, l) => s + l.ablauf.length, 0);
  const unterlagen = LEISTUNGEN.reduce((s, l) => s + l.unterlagen.length, 0);
  const faq = LEISTUNGEN.reduce((s, l) => s + l.faq.length, 0);
  const rechtsgrundlagen = LEISTUNGEN.reduce((s, l) => s + l.rechtsgrundlagen.length, 0);
  const gebuehren = LEISTUNGEN.reduce((s, l) => s + l.gebuehren.length, 0);
  const synonyme = LEISTUNGEN.reduce((s, l) => s + (l.synonyme?.length ?? 0), 0);
  return {
    cluster: CLUSTER.length,
    leistungen: LEISTUNGEN.length,
    aspekte: ASPEKTE.length,
    prozessschritte,
    unterlagen,
    faq,
    rechtsgrundlagen,
    gebuehren,
    synonyme,
  };
}
