/**
 * Sprechnormalisierung: macht Text fuer die Sprachausgabe (TTS) vorlesbar.
 *
 * Vorlesestimmen stolpern ueber Schriftkonventionen: "2026-08" wird als
 * Rechnung oder Ziffernfolge gelesen, "z. B." buchstabiert, "§" ausgelassen.
 * Diese Funktion uebersetzt solche Formen deterministisch in gesprochene
 * Sprache. Sie ist die letzte Stufe vor <Say> und wirkt damit in JEDEM
 * Modus - Mock wie Sprachmodell - unabhaengig davon, wie brav der Prompt
 * befolgt wurde.
 *
 * Regeln:
 *  - Datumsangaben: 2026-08-15 -> "15. August zweitausendsechsundzwanzig",
 *                   2026-08    -> "August zweitausendsechsundzwanzig"
 *  - Jahreszahlen (1900-2099) als Zahlwort: 2026 -> zweitausendsechsundzwanzig
 *  - Abkuerzungen ausschreiben: z. B. -> zum Beispiel, bzw. -> beziehungsweise,
 *    § -> Paragraf, Nr. -> Nummer, ...
 *  - Symbole: € -> Euro, % -> Prozent; Schrift-Trenner (|, —) zu Satzpausen
 *
 * Bewusst NICHT normalisiert: Betraege wie "70,00" und Zaehlwerte wie
 * "14 Tage" - die liest die Stimme korrekt. Auch sichtbarer Text (Browser,
 * Protokoll) bleibt unveraendert; normalisiert wird nur, was gesprochen wird.
 */

const EINER = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
const ZEHN_BIS_NEUNZEHN = ['zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const ZEHNER = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
const MONATE = ['', 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// 0-99 als Wort. "eins" wird vor "und" zu "ein" (einundzwanzig).
function unterHundert(n) {
  if (n < 10) return EINER[n];
  if (n < 20) return ZEHN_BIS_NEUNZEHN[n - 10];
  const e = n % 10;
  const z = Math.floor(n / 10);
  if (e === 0) return ZEHNER[z];
  return `${e === 1 ? 'ein' : EINER[e]}und${ZEHNER[z]}`;
}

/** Ganze Zahl 0-9999 als deutsches Zahlwort (Kardinalzahl). */
export function zahlAlsWort(n) {
  n = Math.trunc(Number(n));
  if (!Number.isFinite(n) || n < 0 || n > 9999) return String(n);
  if (n < 100) return unterHundert(n);

  let wort = '';
  const tausender = Math.floor(n / 1000);
  const hunderter = Math.floor((n % 1000) / 100);
  const rest = n % 100;

  if (tausender > 0) wort += `${tausender === 1 ? 'ein' : EINER[tausender]}tausend`;
  if (hunderter > 0) wort += `${hunderter === 1 ? 'ein' : EINER[hunderter]}hundert`;
  if (rest > 0) wort += unterHundert(rest);
  return wort;
}

// Abkuerzungen: Muster -> gesprochene Form. Die Muster erlauben optionale
// Leerzeichen zwischen den Buchstaben ("z. B." wie "z.B.").
const ABKUERZUNGEN = [
  [/\bz\.\s?B\./g, 'zum Beispiel'],
  [/\bu\.\s?a\./g, 'unter anderem'],
  [/\bd\.\s?h\./g, 'das heißt'],
  [/\bo\.\s?Ä\./g, 'oder Ähnliches'],
  [/\bo\.\s?ä\./g, 'oder ähnliches'],
  [/\bbzw\./g, 'beziehungsweise'],
  [/\bggf\./g, 'gegebenenfalls'],
  [/\bevtl\./g, 'eventuell'],
  [/\binkl\./g, 'inklusive'],
  [/\bexkl\./g, 'exklusive'],
  [/\bca\./g, 'circa'],
  [/\busw\./g, 'und so weiter'],
  [/\betc\./g, 'et cetera'],
  [/\bvgl\./g, 'vergleiche'],
  [/\bNr\./g, 'Nummer'],
  [/\bAbs\./g, 'Absatz'],
  [/\bTel\./g, 'Telefon'],
  [/\bStr\./g, 'Straße'],
  [/\bMio\./g, 'Millionen'],
  [/\bMrd\./g, 'Milliarden'],
  [/§§/g, 'Paragrafen'],
  [/§\s?/g, 'Paragraf '],
  [/\bEUR\b/g, 'Euro'],
  [/\s?€/g, ' Euro'],
  [/\s?%/g, ' Prozent'],
];

function monatsname(mm) {
  const m = Number(mm);
  return m >= 1 && m <= 12 ? MONATE[m] : null;
}

/**
 * Entfernt Schriftauszeichnung (Markdown), die Sprachmodelle trotz Prompt
 * gern einstreuen: **fett**, *kursiv*, Ueberschriften, Listenpunkte,
 * Zeilenumbrueche. Vorlesestimmen lesen "Sternchen Sternchen" oder machen
 * unnatuerliche Pausen. Sprachunabhaengig - gilt fuer Deutsch wie Englisch.
 */
export function entferneSchriftauszeichnung(text) {
  let t = String(text ?? '');
  t = t.replace(/\*\*+|__+/g, '');                       // **fett**, __fett__
  t = t.replace(/(^|\s)[*_](?=\S)/g, '$1').replace(/(?<=\S)[*_](?=[\s.,;:!?)]|$)/g, ''); // *kursiv*
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');               // # Ueberschrift
  t = t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '');         // - Punkt / 1. Punkt
  t = t.replace(/`+/g, '');
  // Listenzeilen ohne Satzzeichen bekommen eines, damit die Stimme pausiert.
  t = t.replace(/([^\s.,;:!?])\s*\n+/g, '$1. ').replace(/\n+/g, ' ');
  return t.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Normalisiert Text fuer die Sprachausgabe. Reihenfolge ist wichtig:
 * erst Datumsangaben (enthalten Jahreszahlen), dann freie Jahreszahlen,
 * dann Abkuerzungen und Symbole, zuletzt Schrift-Trenner.
 */
export function normalisiereFuerSprache(text) {
  let t = entferneSchriftauszeichnung(text);

  // Vollstaendiges Datum: 2026-08-15 -> "15. August zweitausendsechsundzwanzig"
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (ganz, jjjj, mm, tt) => {
    const monat = monatsname(mm);
    if (!monat) return ganz;
    return `${Number(tt)}. ${monat} ${zahlAlsWort(jjjj)}`;
  });

  // Jahr-Monat: 2026-08 -> "August zweitausendsechsundzwanzig"
  t = t.replace(/\b(\d{4})-(\d{2})\b/g, (ganz, jjjj, mm) => {
    const monat = monatsname(mm);
    if (!monat) return ganz;
    return `${monat} ${zahlAlsWort(jjjj)}`;
  });

  // Freie Jahreszahlen 1900-2099 (nicht Teil groesserer Zahlen/Betraege).
  t = t.replace(/(?<![\d.,-])((?:19|20)\d{2})(?!\d)(?![.,]\d)/g, (ganz, jahr) => zahlAlsWort(jahr));

  for (const [muster, ersatz] of ABKUERZUNGEN) t = t.replace(muster, ersatz);

  // Schrift-Trenner aus Listen/Titeln in Satzpausen verwandeln.
  t = t.replace(/\s*\|\s*/g, '. ');
  t = t.replace(/\s*—\s*/g, ', ');
  t = t.replace(/\s*–\s*/g, ', ');

  // Doppelte Leerzeichen und ". ." aufraeumen.
  t = t.replace(/\.\s*\./g, '.').replace(/\s{2,}/g, ' ').trim();
  return t;
}
