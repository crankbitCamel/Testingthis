/**
 * Regionale Wissensschicht.
 *
 * Die Basis-Wissensbasis beschreibt jede Leistung bundesweit und markiert
 * ueber "belastbarkeit", wo Landes- oder Ortsrecht abweicht. Diese Schicht
 * fuellt die Abweichungen fuer einzelne Laender konkret aus, ohne die Basis
 * anzufassen: Ein Landesprofil ueberlagert einzelne Felder einer Leistung
 * und wird im Dialog als eigener Regionalblock ausgewiesen - mit Herkunft
 * und Stand, denn eine Gebuehrenauskunft ohne Quelle ist im Zweifel wertlos.
 *
 * Gliederung nach 20 Registerbereichen: den fachlichen Registern und
 * Fachverfahren, in denen Verwaltungen ihre Daten tatsaechlich fuehren
 * (Melderegister, Personenstandsregister, Fahrzeugregister ...). Jeder
 * Bereich verweist auf die Leistungen der Basis, die aus ihm bedient werden.
 */
import { LAND as NW } from './nw.js';
import { LAND as RP } from './rp.js';

/**
 * Die 20 Registerbereiche. "leistungen" verweist auf Basis-IDs; ueber diese
 * Zuordnung findet der Dialog vom Anliegen zum passenden Regionalprofil.
 */
export const REGISTERBEREICHE = [
  { id: 'meldewesen', name: 'Meldewesen (Melderegister)', leistungen: ['wohnsitz-anmeldung', 'wohnsitz-abmeldung', 'meldebescheinigung', 'wohnungsgeberbestaetigung', 'auskunftssperre'] },
  { id: 'passwesen', name: 'Pass- und Ausweisregister', leistungen: ['personalausweis', 'reisepass', 'ausweis-verlust', 'eid-online-ausweisfunktion'] },
  { id: 'justizregister', name: 'Führungszeugnis und Justizregister', leistungen: ['fuehrungszeugnis', 'gewerbezentralregister'] },
  { id: 'geburtenregister', name: 'Geburtenregister (Standesamt)', leistungen: ['geburtsurkunde', 'vaterschaftsanerkennung'] },
  { id: 'eheregister', name: 'Eheregister (Standesamt)', leistungen: ['eheschliessung', 'ehefaehigkeitszeugnis', 'personenstandsurkunde'] },
  { id: 'sterberegister', name: 'Sterberegister und Bestattungswesen', leistungen: ['sterbefall', 'bestattung'] },
  { id: 'kirchenaustritt', name: 'Kirchenaustrittsregister', leistungen: ['kirchenaustritt'] },
  { id: 'fahrzeugregister', name: 'Fahrzeugregister (Kfz-Zulassung)', leistungen: ['kfz-zulassung', 'kfz-ummeldung', 'kfz-abmeldung', 'wunschkennzeichen'] },
  { id: 'fahrerlaubnisregister', name: 'Fahrerlaubnisregister', leistungen: ['fuehrerschein-ersterteilung', 'fuehrerschein-umtausch', 'fuehrerschein-verlust', 'internationaler-fuehrerschein'] },
  { id: 'parkraum', name: 'Parkraumbewirtschaftung', leistungen: ['bewohnerparkausweis', 'schwerbehindertenparkausweis'] },
  { id: 'gewerberegister', name: 'Gewerberegister', leistungen: ['gewerbeanmeldung', 'gewerbeummeldung', 'gewerbeabmeldung', 'reisegewerbekarte', 'steuerliche-erfassung'] },
  { id: 'gaststaettenwesen', name: 'Gaststättenwesen', leistungen: ['gaststaettenerlaubnis'] },
  { id: 'bauaufsicht', name: 'Bauaufsicht und Baulastenverzeichnis', leistungen: ['bauantrag', 'bauvoranfrage', 'abgeschlossenheitsbescheinigung'] },
  { id: 'denkmalliste', name: 'Denkmalliste', leistungen: ['denkmalschutz-erlaubnis'] },
  { id: 'auslaenderregister', name: 'Ausländerwesen', leistungen: ['auslaender-aufenthaltserlaubnis', 'niederlassungserlaubnis', 'verpflichtungserklaerung', 'anerkennung-berufsabschluss'] },
  { id: 'einbuergerung', name: 'Einbürgerung und Staatsangehörigkeit', leistungen: ['einbuergerung'] },
  { id: 'sozialregister', name: 'Sozialleistungen und Wohnraumförderung', leistungen: ['buergergeld', 'wohngeld', 'sozialhilfe', 'wohnberechtigungsschein', 'schwerbehindertenausweis'] },
  { id: 'schulwesen', name: 'Schulwesen', leistungen: ['schulanmeldung', 'schuelerbefoerderung', 'bafoeg'] },
  { id: 'kindertagesbetreuung', name: 'Kindertagesbetreuung', leistungen: ['kita-platz', 'kindergeld', 'elterngeld', 'unterhaltsvorschuss'] },
  { id: 'kommunalsteuern-ordnung', name: 'Kommunale Steuern und Ordnungswesen', leistungen: ['hundesteuer', 'grundsteuer', 'zweitwohnungsteuer', 'bussgeldbescheid-einspruch', 'veranstaltung-anmelden', 'sondernutzungserlaubnis', 'baumfaellgenehmigung'] },
];

export const REGISTERBEREICH_BY_ID = Object.fromEntries(REGISTERBEREICHE.map((b) => [b.id, b]));

/** Registerbereich, aus dem eine Leistung bedient wird. */
const BEREICH_VON_LEISTUNG = {};
for (const b of REGISTERBEREICHE) {
  for (const l of b.leistungen) BEREICH_VON_LEISTUNG[l] = b.id;
}
export function registerbereichFuer(leistungId) {
  const id = BEREICH_VON_LEISTUNG[leistungId];
  return id ? REGISTERBEREICH_BY_ID[id] : null;
}

export const LAENDER = { nw: NW, rp: RP };
export const LAENDER_LISTE = [NW, RP];

/**
 * Loest das Regionalprofil einer Leistung fuer ein Land auf.
 * Rueckgabe null, wenn fuer diese Kombination nichts hinterlegt ist -
 * dann gilt die Basisauskunft mit ihrer Spanne unveraendert.
 */
export function regional(leistungId, landCode) {
  const land = LAENDER[landCode];
  if (!land) return null;
  const eintrag = land.leistungen[leistungId];
  const bereich = registerbereichFuer(leistungId);
  const profil = bereich ? land.registerprofile[bereich.id] : null;
  if (!eintrag && !profil) return null;
  return {
    land,
    bereich,
    profil: profil ?? null,       // Landeswissen des Registerbereichs
    eintrag: eintrag ?? null,     // konkrete Ueberlagerung der Leistung
  };
}

/** Kennzahlen der Regionalschicht fuer Statusanzeige und Validator. */
export function regionalKennzahlen() {
  const jeLand = {};
  for (const land of LAENDER_LISTE) {
    jeLand[land.code] = {
      name: land.name,
      leistungen: Object.keys(land.leistungen).length,
      registerprofile: Object.keys(land.registerprofile).length,
    };
  }
  return { registerbereiche: REGISTERBEREICHE.length, laender: LAENDER_LISTE.length, jeLand };
}
