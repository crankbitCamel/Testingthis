/**
 * Sprachverstehen fuer den Verwaltungs-Voice-Agent.
 *
 * Bewusst ohne externes Modell: Die Erkennung laeuft vollstaendig lokal im
 * Browser auf Basis der Wissensbasis. Das hat drei Gruende, die im
 * Verwaltungskontext zaehlen - keine Uebermittlung von Buergeranliegen an
 * Dritte, nachvollziehbare Entscheidungen und Betrieb ohne Netzverbindung.
 *
 * Verfahren:
 *   1. Normalisierung (Umlaute, Fugen-s, Satzzeichen, Fuellwoerter)
 *   2. Leichtes Suffix-Stemming fuer deutsche Flexion
 *   3. Gewichtete Treffersuche gegen Synonyme, Namen und Cluster-Stichworte
 *      mit IDF-Gewichtung, damit haeufige Woerter nicht dominieren
 *   4. Zusammenfassung zu Cluster-Scores - das ist die geforderte grobe
 *      Klassifikation, bevor per Ziffernwahl praezisiert wird
 */
import { CLUSTER, LEISTUNGEN, ASPEKTE, HAEUFIGKEIT, suchbegriffe } from './kb/index.js';
import { LAENDER_LISTE } from './kb/regional/index.js';

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

const UMLAUTE = [
  [/ä/g, 'ae'], [/ö/g, 'oe'], [/ü/g, 'ue'], [/ß/g, 'ss'],
];

/** Fuellwoerter, die in gesprochener Sprache dominieren, aber nichts tragen. */
export const STOPPWOERTER = new Set([
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'man', 'mir', 'mich', 'mein', 'meine', 'meinen',
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'und', 'oder', 'aber', 'auch', 'noch', 'schon', 'nur', 'mal', 'halt', 'eben', 'denn', 'doch',
  'wie', 'was', 'wo', 'wann', 'warum', 'wer', 'welche', 'welcher', 'welches', 'wieso', 'weshalb',
  'ist', 'sind', 'war', 'bin', 'hat', 'habe', 'haben', 'hatte', 'wird', 'werden', 'wurde',
  'kann', 'koennen', 'muss', 'muessen', 'soll', 'sollen', 'darf', 'duerfen', 'moechte', 'will',
  'in', 'im', 'an', 'am', 'auf', 'fuer', 'mit', 'von', 'vom', 'zu', 'zum', 'zur', 'bei', 'beim',
  'nach', 'ueber', 'unter', 'aus', 'als', 'um', 'bitte', 'danke', 'hallo', 'guten', 'tag',
  'gerne', 'vielleicht', 'eigentlich', 'einfach', 'gerade', 'jetzt', 'dann', 'also', 'so',
  'nicht', 'kein', 'keine', 'sehr', 'ganz', 'viel', 'etwas', 'wieder', 'immer', 'da', 'dass',
  'aeh', 'aehm', 'hm', 'ja', 'nein', 'ok', 'okay', 'gut', 'brauche', 'brauch', 'benoetige',
  'wollte', 'wuerde', 'gern', 'wegen', 'thema', 'sache', 'frage', 'fragen',
]);

/** Vereinheitlicht Umlaute, Satzzeichen und Mehrfachleerzeichen. */
export function normalisieren(text) {
  let t = (text ?? '').toLowerCase();
  for (const [re, ersatz] of UMLAUTE) t = t.replace(re, ersatz);
  t = t.replace(/[^a-z0-9\s-]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/**
 * Sehr zurueckhaltendes Stemming: schneidet nur die haeufigsten deutschen
 * Flexionsendungen ab und laesst kurze Woerter unangetastet. Aggressiveres
 * Stemming wuerde "Pass" und "Passe" zusammenwerfen, aber auch "Bau" und
 * "Bauen" mit "Bauch" - deshalb die Laengengrenzen.
 */
export function stamm(wort) {
  let w = wort;
  if (w.length > 7) {
    for (const suffix of ['ungen', 'lichen', 'ische', 'ungs']) {
      if (w.endsWith(suffix)) return w.slice(0, -suffix.length);
    }
  }
  if (w.length > 6) {
    for (const suffix of ['ung', 'nen', 'end', 'ern']) {
      if (w.endsWith(suffix)) return w.slice(0, -suffix.length);
    }
  }
  if (w.length > 5) {
    for (const suffix of ['en', 'er', 'es', 'em', 'et', 'st']) {
      if (w.endsWith(suffix)) return w.slice(0, -suffix.length);
    }
  }
  if (w.length > 4) {
    for (const suffix of ['e', 'n', 's', 't']) {
      if (w.endsWith(suffix)) return w.slice(0, -suffix.length);
    }
  }
  return w;
}

/** Zerlegt einen Text in inhaltstragende Wortstaemme. */
export function tokenisieren(text, { stoppwoerterEntfernen = true } = {}) {
  return normalisieren(text)
    .split(' ')
    .filter((w) => w.length > 1)
    .filter((w) => !(stoppwoerterEntfernen && STOPPWOERTER.has(w)))
    .map(stamm)
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/**
 * Der Index wird einmal beim Laden aufgebaut. Er enthaelt fuer jede Leistung
 * und jedes Cluster die Wortstaemme ihrer Suchbegriffe samt Gewicht sowie eine
 * Dokumenthaeufigkeit fuer die IDF-Gewichtung.
 */
function baueIndex() {
  const dokumentHaeufigkeit = new Map();
  const zaehle = (staemme) => {
    for (const s of new Set(staemme)) {
      dokumentHaeufigkeit.set(s, (dokumentHaeufigkeit.get(s) ?? 0) + 1);
    }
  };

  const leistungen = LEISTUNGEN.map((l) => {
    // Namen und Synonyme wiegen schwerer als Unterlagenbezeichnungen.
    const phrasen = [
      { text: l.name, gewicht: 3 },
      { text: l.sprechName, gewicht: 3 },
      ...(l.synonyme ?? []).map((s) => ({ text: s, gewicht: 4 })),
      ...(l.unterlagen ?? []).map((u) => ({ text: u.was, gewicht: 0.6 })),
      { text: l.kurzbeschreibung, gewicht: 0.4 },
    ];
    const staemme = new Map();
    for (const p of phrasen) {
      const tokens = tokenisieren(p.text);
      // Ein einzelnes Wort aus einer mehrwortigen Phrase traegt weniger
      // Evidenz als ein einwortiges Synonym: "Geld" aus "Geld fuer Kinder"
      // darf nicht so schwer wiegen wie "Kindergeld".
      const daempfung = 1 / Math.sqrt(Math.max(1, tokens.length));
      for (const t of tokens) {
        staemme.set(t, Math.max(staemme.get(t) ?? 0, p.gewicht * daempfung));
      }
    }
    zaehle([...staemme.keys()]);
    return {
      id: l.id,
      cluster: l.cluster,
      staemme,
      // Normalisierte Synonymphrasen fuer exakte Volltrefferpruefung
      phrasen: [l.name, l.sprechName, ...(l.synonyme ?? [])].map(normalisieren),
    };
  });

  const cluster = CLUSTER.map((c) => {
    const staemme = new Map();
    for (const s of c.stichworte) {
      const tokens = tokenisieren(s);
      const daempfung = 1 / Math.sqrt(Math.max(1, tokens.length));
      for (const t of tokens) staemme.set(t, Math.max(staemme.get(t) ?? 0, 3 * daempfung));
    }
    for (const t of tokenisieren(c.name)) staemme.set(t, Math.max(staemme.get(t) ?? 0, 2));
    for (const ll of c.lebenslagen) {
      for (const t of tokenisieren(ll)) staemme.set(t, Math.max(staemme.get(t) ?? 0, 2));
    }
    zaehle([...staemme.keys()]);
    return { id: c.id, staemme, phrasen: c.stichworte.map(normalisieren) };
  });

  const gesamt = leistungen.length + cluster.length;
  const idf = new Map();
  for (const [s, df] of dokumentHaeufigkeit) {
    idf.set(s, Math.log(1 + gesamt / (1 + df)));
  }
  return { leistungen, cluster, idf };
}

export const INDEX = baueIndex();

// ---------------------------------------------------------------------------
// Ziffern, Bestaetigungen und Steuerbefehle
// ---------------------------------------------------------------------------

const ZAHLWOERTER = {
  null: 0, kein: 0, keins: 0,
  ein: 1, eins: 1, eine: 1, erste: 1, erster: 1, erstens: 1, nummer1: 1, a: 1,
  zwei: 2, zweite: 2, zweiter: 2, zweitens: 2, b: 2, zwo: 2,
  drei: 3, dritte: 3, dritter: 3, drittens: 3, c: 3,
  vier: 4, vierte: 4, vierter: 4, viertens: 4, d: 4,
  fuenf: 5, fuenfte: 5, fuenfter: 5, fuenftens: 5, e: 5,
  sechs: 6, sechste: 6, sechster: 6, f: 6,
  sieben: 7, siebte: 7, siebte4: 7, g: 7,
  acht: 8, achte: 8, h: 8,
  neun: 9, neunte: 9, i: 9,
};

/**
 * Erkennt eine Auswahlziffer in gesprochener oder getippter Form.
 * Beruecksichtigt "die zweite", "nummer 3", "Punkt eins", "b" wie im
 * Telefonmenue - und liefert null, wenn keine Ziffer gemeint ist.
 */
export function erkenneZiffer(text) {
  const t = normalisieren(text);
  if (!t) return null;

  // Reine Ziffernangabe oder "nummer 2", "punkt 3", "die 1"
  const direkt = t.match(/(?:^|\s)(?:nummer|punkt|option|auswahl|antwort|die|der|das)?\s*([0-9])(?:\s|$|\.)/);
  if (direkt) {
    const n = Number(direkt[1]);
    // "2 wochen" oder "3 kinder" ist keine Menueauswahl
    const rest = t.slice(direkt.index + direkt[0].length).trim();
    const ersteWeitere = rest.split(' ')[0] ?? '';
    if (!ersteWeitere || ZIFFER_FOLGEWOERTER.has(ersteWeitere)) return n;
    if (t.trim() === String(n)) return n;
    if (/^(nummer|punkt|option|auswahl)/.test(t)) return n;
    return null;
  }

  const woerter = t.split(' ');
  for (let i = 0; i < woerter.length; i += 1) {
    const w = woerter[i];
    if (w in ZAHLWOERTER) {
      const naechstes = woerter[i + 1] ?? '';
      if (!naechstes || ZIFFER_FOLGEWOERTER.has(naechstes)) return ZAHLWOERTER[w];
      // "eine wohnung anmelden" ist keine Menueauswahl
      if (i === 0 && woerter.length === 1) return ZAHLWOERTER[w];
    }
  }
  return null;
}

/** Woerter, die nach einer Ziffer stehen duerfen, ohne die Auswahl zu entwerten. */
const ZIFFER_FOLGEWOERTER = new Set(['bitte', 'danke', 'gern', 'gerne', 'nehme', 'waehle', 'punkt', 'option', 'stimmt', 'genau', 'sag', 'sagen']);

const JA = new Set(['ja', 'jau', 'jo', 'genau', 'richtig', 'stimmt', 'korrekt', 'passt', 'exakt', 'jawohl', 'yes', 'ok', 'okay', 'klar', 'sicher', 'bestaetige']);
const NEIN = new Set(['nein', 'ne', 'nee', 'falsch', 'nicht', 'no', 'quatsch', 'anderes', 'anders', 'stimmt nicht']);

/** Erkennt Bestaetigung oder Verneinung; null bei Unklarheit. */
export function erkenneJaNein(text) {
  const woerter = normalisieren(text).split(' ');
  if (woerter.some((w) => NEIN.has(w))) return false;
  if (woerter.some((w) => JA.has(w))) return true;
  return null;
}

/** Steuerbefehle, die in jedem Dialogzustand gelten. */
export const BEFEHLE = [
  { id: 'zurueck', muster: ['zurueck', 'zurueck bitte', 'eine ebene zurueck', 'nochmal von vorne der punkt', 'vorheriges', 'zurueckgehen'] },
  { id: 'hauptmenue', muster: ['hauptmenue', 'von vorne', 'neu anfangen', 'neues anliegen', 'anderes anliegen', 'startseite', 'abbrechen', 'zum anfang'] },
  { id: 'wiederholen', muster: ['wiederholen', 'nochmal sagen', 'noch einmal', 'wie bitte', 'habe nicht verstanden', 'nicht verstanden', 'wiederhole'] },
  { id: 'mensch', muster: ['mitarbeiter', 'mensch', 'echte person', 'sachbearbeiter', 'jemanden sprechen', 'weiterverbinden', 'berater', 'kollegen', 'persoenlich sprechen'] },
  { id: 'hilfe', muster: ['hilfe', 'was kannst du', 'was koennen sie', 'wie funktioniert das', 'welche moeglichkeiten', 'uebersicht'] },
  { id: 'langsamer', muster: ['langsamer', 'zu schnell', 'nicht so schnell'] },
  { id: 'schneller', muster: ['schneller', 'zu langsam'] },
  { id: 'alles', muster: ['alles', 'alle details', 'komplett', 'vollstaendig', 'alles vorlesen', 'gesamte auskunft'] },
  { id: 'beenden', muster: ['beenden', 'tschuess', 'auf wiederhoeren', 'auf wiedersehen', 'ende', 'fertig', 'das wars', 'danke das wars'] },
];

/** Erkennt einen Steuerbefehl im Text; null, wenn es keiner ist. */
export function erkenneBefehl(text) {
  const t = normalisieren(text);
  if (!t) return null;
  for (const b of BEFEHLE) {
    for (const m of b.muster) {
      const mn = normalisieren(m);
      if (t === mn || t.includes(mn)) return b.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Landeserkennung
// ---------------------------------------------------------------------------

/**
 * Erkennt eine Landesangabe in der Aeusserung: Landesname, Kuerzel oder eine
 * hinterlegte Stadt ("ich wohne in Koeln"). Kurze Kuerzel wie "rp" werden nur
 * als eigenstaendiges Wort akzeptiert, sonst faende sich "rp" in "Koerper".
 */
export function erkenneLand(text) {
  const t = ` ${normalisieren(text)} `;
  for (const land of LAENDER_LISTE) {
    for (const stichwort of land.stichworte) {
      const sn = normalisieren(stichwort);
      if (sn.length <= 3) {
        if (t.includes(` ${sn} `)) return { code: land.code, stichwort: sn };
      } else if (t.includes(sn)) {
        return { code: land.code, stichwort: sn };
      }
    }
  }
  return null;
}

/** Woerter, die eine reine Wohnortangabe bilden ("ich wohne in Koeln"). */
const ORTSANGABE_WOERTER = new Set(['wohn', 'leb', 'komm', 'stamm', 'stadt', 'gemeind', 'heimat', 'bundesland', 'land']);

/**
 * True, wenn der Satz nur den Wohnort mitteilt und kein Anliegen enthaelt.
 * "Ich wohne in Koeln" - ja. "Ich bin nach Koeln gezogen" - nein, das ist
 * ein Umzugsanliegen und gehoert in die Klassifikation.
 */
export function istReineOrtsangabe(text, stichwort) {
  const rest = normalisieren(text).replace(stichwort, ' ');
  const tokens = tokenisieren(rest);
  return tokens.every((t) => ORTSANGABE_WOERTER.has(t));
}

// ---------------------------------------------------------------------------
// Bewertung
// ---------------------------------------------------------------------------

function bewerteEintrag(eintrag, tokens, rohText) {
  let score = 0;
  let treffer = [];
  for (const t of tokens) {
    const gewicht = eintrag.staemme.get(t);
    if (gewicht) {
      score += gewicht * (INDEX.idf.get(t) ?? 1);
      treffer.push(t);
    }
  }
  // Ein vollstaendig enthaltener Synonymausdruck ist ein sehr starkes Signal.
  for (const p of eintrag.phrasen) {
    if (p.length >= 5 && rohText.includes(p)) {
      score += 6 + p.split(' ').length * 2;
      treffer.push(p);
    }
  }
  return { score, treffer };
}

/**
 * Klassifiziert eine freie Aeusserung.
 *
 * Rueckgabe:
 *   clusterTreffer  - nach Score sortierte Bereiche (Stufe 1)
 *   leistungTreffer - nach Score sortierte Einzelleistungen (Stufe 2)
 *   aspekt          - erkannter Detailaspekt, falls die Frage schon konkret ist
 *   sicherheit      - 0..1, Abstand des besten Treffers zum Feld
 */
export function verstehe(text) {
  const roh = normalisieren(text);
  const tokens = tokenisieren(text);
  const leer = tokens.length === 0;

  const leistungTreffer = INDEX.leistungen
    .map((e) => {
      const { score, treffer } = bewerteEintrag(e, tokens, roh);
      // Sehr leichte Praeferenz fuer haeufige Anliegen bei Gleichstand
      const bonus = score > 0 ? (HAEUFIGKEIT[e.id] ?? 40) / 400 : 0;
      return { id: e.id, cluster: e.cluster, score: score + bonus, treffer };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score);

  // Cluster-Score: eigene Stichworte plus das, was die Leistungen des Clusters
  // beigetragen haben. So wird "Ich bin umgezogen" ueber das Cluster-Stichwort
  // erkannt, "Ich brauche einen neuen Perso" ueber die Leistung.
  const ausLeistungen = new Map();
  for (const t of leistungTreffer) {
    ausLeistungen.set(t.cluster, (ausLeistungen.get(t.cluster) ?? 0) + t.score);
  }

  const clusterTreffer = INDEX.cluster
    .map((e) => {
      const { score, treffer } = bewerteEintrag(e, tokens, roh);
      const gesamt = score + (ausLeistungen.get(e.id) ?? 0) * 0.8;
      return { id: e.id, score: gesamt, eigen: score, treffer };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score);

  const aspekt = erkenneAspekt(text);

  const bester = clusterTreffer[0]?.score ?? 0;
  const zweiter = clusterTreffer[1]?.score ?? 0;
  const sicherheit = bester === 0
    ? 0
    : Math.min(1, (bester / (bester + zweiter + 4)) * Math.min(1, bester / 8) * 1.6);

  return { text, tokens, leer, clusterTreffer, leistungTreffer, aspekt, sicherheit };
}

/** Erkennt, nach welchem Detailaspekt gefragt wird - etwa Kosten oder Unterlagen. */
export function erkenneAspekt(text) {
  const roh = normalisieren(text);
  const tokens = new Set(tokenisieren(text));
  let bester = null;
  let besterScore = 0;
  for (const a of ASPEKTE) {
    let score = 0;
    for (const s of a.stichworte) {
      const sn = normalisieren(s);
      if (sn.includes(' ')) {
        if (roh.includes(sn)) score += 4;
      } else if (tokens.has(stamm(sn))) {
        score += 2;
      }
    }
    if (score > besterScore) {
      besterScore = score;
      bester = a.id;
    }
  }
  return besterScore >= 2 ? bester : null;
}

/**
 * Schwellenwerte des Dialogs. Sie entscheiden, ob der Bot direkt antwortet,
 * eine Rueckfrage stellt oder das Ziffernmenue anbietet.
 */
export const SCHWELLEN = {
  /** Ab hier gilt eine einzelne Leistung als eindeutig getroffen. */
  leistungDirekt: 14,
  /** Ab hier gilt ein Cluster als sicher erkannt. */
  clusterSicher: 6,
  /** Mindestvorsprung des besten vor dem zweiten Treffer fuer "eindeutig". */
  vorsprung: 1.45,
};

/**
 * Entscheidet auf Basis der Trefferlage, wie der Dialog weitergeht.
 * Ergebnisarten:
 *   'leistung'  - eine Leistung ist eindeutig, direkt zu Stufe 2
 *   'cluster'   - Bereich erkannt, Grobwissen ausgeben und 1/2/3 anbieten
 *   'auswahl'   - mehrere Bereiche moeglich, Ziffernmenue ueber Bereiche
 *   'unklar'    - nichts erkannt, offene Rueckfrage
 */
export function entscheide(analyse) {
  const { leistungTreffer, clusterTreffer } = analyse;
  const l1 = leistungTreffer[0];
  const l2 = leistungTreffer[1];
  const c1 = clusterTreffer[0];
  const c2 = clusterTreffer[1];

  if (l1 && l1.score >= SCHWELLEN.leistungDirekt
      && (!l2 || l1.score >= l2.score * SCHWELLEN.vorsprung)) {
    return { art: 'leistung', leistungId: l1.id, clusterId: l1.cluster, score: l1.score };
  }
  if (c1 && c1.score >= SCHWELLEN.clusterSicher
      && (!c2 || c1.score >= c2.score * SCHWELLEN.vorsprung)) {
    return { art: 'cluster', clusterId: c1.id, score: c1.score };
  }
  if (c1 && c1.score > 0) {
    return {
      art: 'auswahl',
      clusterIds: clusterTreffer.slice(0, 3).map((c) => c.id),
      score: c1.score,
    };
  }
  return { art: 'unklar' };
}
