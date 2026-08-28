/**
 * Ableitung der Rechtsebene.
 *
 * Der Anrufer weiss nicht - und muss nicht wissen -, ob sein Anliegen
 * Bundes-, Landes- oder Kommunalrecht ist. Das System leitet es nach der
 * Qualifizierung selbst aus der Wissensbasis ab: aus der Belastbarkeits-
 * kennung der Leistung, den Gebuehrenarten und der Verwaltungsebene der
 * zustaendigen Stelle. Erst wenn die Antwort tatsaechlich vom Ort abhaengt,
 * wird nach dem Ort gefragt - nie vorher, nie pauschal.
 */
import { LEISTUNG_BY_ID } from './index.js';

export const EBENEN = {
  bund: {
    id: 'bund',
    name: 'Bundesrecht',
    sprech: 'bundesweit einheitlich geregelt',
    erklaerung: 'Die Angaben gelten in ganz Deutschland gleich - egal, wo Sie wohnen.',
  },
  land: {
    id: 'land',
    name: 'Landesrecht',
    sprech: 'Landesrecht - je Bundesland unterschiedlich',
    erklaerung: 'Die Regeln setzt das jeweilige Bundesland; zwischen den Ländern gibt es deutliche Unterschiede.',
  },
  kommune: {
    id: 'kommune',
    name: 'Kommunalrecht',
    sprech: 'kommunal geregelt - jede Stadt oder Gemeinde entscheidet selbst',
    erklaerung: 'Höhe und Details stehen in der Satzung Ihrer Stadt oder Gemeinde.',
  },
};

/** Aspekte, deren Antwort bei Landes-/Kommunalrecht wirklich vom Ort abhaengt. */
const ORTSABHAENGIGE_ASPEKTE = new Set(['kosten', 'fristen', 'zustaendigkeit', 'voraussetzungen', 'online']);

/**
 * Bestimmt die massgebliche Rechtsebene einer Leistung, optional bezogen auf
 * einen Aspekt. Beispiel Personalausweis: Verfahren und Gebuehr sind Bund,
 * obwohl das Buergeramt (Kommune) ausfuehrt - ausschlaggebend ist, wer die
 * Regel setzt, nicht wer den Schalter besetzt.
 */
export function rechtsebene(leistungId, aspektId = null) {
  const l = LEISTUNG_BY_ID[leistungId];
  if (!l) return null;

  // Grundebene aus der Belastbarkeitskennung der Leistung.
  const basis = {
    bundesrecht: 'bund',
    'landesrecht-variiert': 'land',
    'kommunal-variiert': 'kommune',
  }[l.belastbarkeit.quelle] ?? 'bund';

  // Aspektschaerfung: Bei den Kosten zaehlt die Art der Gebuehrenpositionen.
  // Eine Leistung kann im Verfahren Bundesrecht sein, waehrend eine einzelne
  // Gebuehr kommunal festgesetzt wird (Beispiel Meldebescheinigung).
  let ebeneId = basis;
  if (aspektId === 'kosten' && l.gebuehren?.length) {
    const arten = new Set(l.gebuehren.map((g) => g.art));
    if (arten.has('kommunal')) ebeneId = 'kommune';
    else if (arten.has('landesrecht')) ebeneId = basis === 'kommune' ? 'kommune' : 'land';
    else if (arten.has('bundeseinheitlich') || arten.has('keine')) ebeneId = 'bund';
  }

  const ortsabhaengig = ebeneId !== 'bund'
    && (aspektId === null || ORTSABHAENGIGE_ASPEKTE.has(aspektId));

  return {
    ebene: EBENEN[ebeneId],
    /** Braucht eine praezise Antwort den Wohnort? */
    ortsabhaengig,
    /** Genuegt das Bundesland, oder entscheidet die einzelne Kommune? */
    aufloesung: ebeneId === 'kommune' ? 'kommune' : ebeneId === 'land' ? 'land' : 'keine',
    hinweis: l.belastbarkeit.hinweis,
  };
}

/** Kurzer Ansagesatz zur Ebene - Teil der Qualifizierungsantwort. */
export function ebenenAnsage(leistungId, aspektId = null) {
  const e = rechtsebene(leistungId, aspektId);
  if (!e) return null;
  if (e.ebene.id === 'bund') {
    return 'Das ist bundesweit einheitlich geregelt - die Angaben gelten überall gleich.';
  }
  if (e.ebene.id === 'land') {
    return 'Das ist Landesrecht - die Regeln unterscheiden sich je Bundesland.';
  }
  return 'Das ist kommunal geregelt - die Details legt Ihre Stadt oder Gemeinde in ihrer Satzung fest.';
}
