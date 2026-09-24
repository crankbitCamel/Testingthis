/**
 * Gespraechslogik am Telefon - unabhaengig vom Telefonie-Traeger.
 *
 * Hier liegt alles, was fuer JEDEN Traeger (Twilio, Jambonz, ...) gleich
 * ist: Sprachen und Ansagetexte, der Zustand je Anruf, Sprachwahl,
 * Einwilligung samt Widerruf, Stille- und Wiederholungszaehler, Tasten mit
 * fester Bedeutung, Weiterleitung an Menschen, der Aufruf des Sprachmodells
 * samt Hintergrund-Job, Verlauf, Quellen fuer Nachfragen und das Protokoll.
 *
 * Die Adapter (telefon.mjs fuer Twilio, jambonz.mjs) uebersetzen nur noch:
 * Eingang (Formular, JSON) -> diese Funktionen -> Ausgang (TwiML, Verben).
 * Sie kennen keine Gespraechsregeln.
 *
 * Rueckgabeform aller Schritte ist ein "Schritt":
 *   { art: 'sagen',     text }           Text sprechen, dann weiter zuhoeren
 *   { art: 'auflegen',  text }           Text sprechen, dann auflegen
 *   { art: 'verbinden', text, nummer }   Text sprechen, dann an Menschen verbinden
 *   { art: 'warten' }                    Antwort wird im Hintergrund berechnet
 *
 * Tasten waehrend des Gespraechs (beide Traeger):
 *   0  Weiterleitung an eine Mitarbeiterin oder einen Mitarbeiter
 *   2  Widerruf der Einwilligung zur Protokollierung (loescht die Eintraege)
 */
import { gespraechsschritt, llmKonfiguriert } from './assistent.mjs';
import { erkenneLand } from '../src/nlu.js';
import { protokolliere, protokollLoeschen } from './gespraechslog.mjs';
import { normalisiereFuerSprache, normalisiereEnglisch, entferneSchriftauszeichnung } from './sprechnormalisierung.mjs';
import { beobachte, zaehle } from './metriken.mjs';

// ---------------------------------------------------------------------------
// Sprachen: alles, was je Sprache verschieden ist, an EINER Stelle.
// "stimme" ist die Twilio/Polly-Stimme; andere Traeger haben eigene Felder
// und ignorieren dieses.
// ---------------------------------------------------------------------------
export const SPRACHEN = {
  de: {
    code: 'de-DE',
    stimme: process.env.TELEFON_STIMME ?? 'Polly.Vicki-Neural',
    // Die deutsche Sprechnormalisierung (Zahlwoerter, Abkuerzungen) gilt nur hier.
    normalisieren: true,
    texte: {
      menue: 'Für Deutsch drücken Sie die Eins.',
      // Einwilligung (Opt-in) zur Protokollierung. Bewusst "schriftlich
      // protokollieren", nicht "aufzeichnen": gespeichert wird der Text der
      // Runde, kein Tonmitschnitt - die Ansage muss dem entsprechen. Der
      // Wortlaut wird zum Nachweis mit jedem Eintrag gespeichert.
      einwilligung: 'Zur Verbesserung unserer KI-gestützten Auskunft würden wir das Gespräch gerne schriftlich protokollieren. '
        + 'Drücken Sie die Eins, wenn Sie zustimmen, oder die Zwei, wenn Sie dies nicht wünschen. '
        + 'Sie können die Zustimmung jederzeit mit der Zwei widerrufen.',
      begruessung: 'Guten Tag, hier ist der digitale Verwaltungsassistent, ein KI-System. '
        + 'Schildern Sie Ihr Anliegen einfach in eigenen Worten - zum Beispiel: '
        + 'Ich bin umgezogen. Oder: Was kostet ein Reisepass? '
        + 'Mit der Null erreichen Sie jederzeit eine Mitarbeiterin oder einen Mitarbeiter.',
      nichtsGehoert: 'Ich habe nichts gehört. Sagen Sie Ihr Anliegen bitte noch einmal - oder legen Sie einfach auf.',
      danke: 'Vielen Dank für Ihren Anruf. Auf Wiederhören.',
      tasteUnbekannt: 'Mit der Null erreichen Sie eine Mitarbeiterin oder einen Mitarbeiter, mit der Zwei widerrufen Sie die Protokollierung. Sagen Sie sonst einfach Ihr Anliegen.',
      nichtVerstanden: 'Entschuldigung, das habe ich nicht verstanden. Sagen Sie es bitte noch einmal.',
      unverstandenEnde: 'Ich konnte Sie leider mehrfach nicht verstehen. Bitte versuchen Sie es später erneut. Auf Wiederhören.',
      stoerung: 'Entschuldigung, es gab gerade eine technische Störung. Bitte versuchen Sie es in einem Moment erneut. Auf Wiederhören.',
      moment: 'Einen Moment, ich schaue das für Sie nach.',
      wiederholen: 'Entschuldigung, bitte wiederholen Sie Ihre Frage.',
      zuLange: 'Das dauert diesmal leider zu lange. Bitte versuchen Sie es erneut. Auf Wiederhören.',
      widerrufBestaetigt: 'In Ordnung. Die Protokollierung ist beendet, und die bisherigen Einträge dieses Gesprächs wurden gelöscht. Wie kann ich weiterhelfen?',
      keinWiderruf: 'Dieses Gespräch wird nicht protokolliert. Wie kann ich weiterhelfen?',
      verbinden: 'Ich verbinde Sie mit einer Mitarbeiterin oder einem Mitarbeiter. Einen Moment bitte.',
      verbindenNichtMoeglich: 'Eine Weiterleitung ist im Moment nicht möglich. Bitte wenden Sie sich zu den Öffnungszeiten direkt an die zuständige Stelle.',
      verbindenFehlgeschlagen: 'Leider nimmt gerade niemand ab. Ich bin weiter für Sie da - was kann ich für Sie tun?',
    },
  },
  en: {
    code: 'en-GB',
    stimme: process.env.TELEFON_STIMME_EN ?? 'Polly.Amy-Neural',
    normalisieren: false,
    texte: {
      menue: 'For English, press two.',
      einwilligung: 'To improve our AI-assisted information service, we would like to keep a written record of this conversation. '
        + 'Press one if you agree, or two if you do not wish this. You can withdraw your consent at any time by pressing two.',
      begruessung: 'Hello, this is the digital public services assistant, an AI system. '
        + 'Just describe what you need in your own words - for example: '
        + 'I have moved house. Or: How much does a passport cost? '
        + 'Press zero at any time to reach a member of staff.',
      nichtsGehoert: "I didn't hear anything. Please say what you need once more - or simply hang up.",
      danke: 'Thank you for calling. Goodbye.',
      tasteUnbekannt: 'Press zero to reach a member of staff, or two to withdraw consent to the written record. Otherwise, just tell me what you need.',
      nichtVerstanden: "Sorry, I didn't catch that. Please say it again.",
      unverstandenEnde: "I'm sorry, I could not understand you several times. Please try again later. Goodbye.",
      stoerung: 'Sorry, there was a technical problem. Please try again in a moment. Goodbye.',
      moment: 'One moment, I am looking that up for you.',
      wiederholen: 'Sorry, please repeat your question.',
      zuLange: 'This is taking too long, unfortunately. Please try again. Goodbye.',
      widerrufBestaetigt: 'Understood. The written record has been stopped and the entries for this call have been deleted. How can I help?',
      keinWiderruf: 'This call is not being recorded in writing. How can I help?',
      verbinden: 'I am connecting you to a member of staff. One moment, please.',
      verbindenNichtMoeglich: 'A transfer is not possible right now. Please contact the responsible office directly during opening hours.',
      verbindenFehlgeschlagen: 'Unfortunately nobody is available right now. I am still here - what can I do for you?',
    },
  },
};
export const STANDARD_SPRACHE = 'de';
// Tastenmenue zu Beginn: Taste -> Sprachcode. Alles andere faellt auf Deutsch zurueck.
export const TASTE_ZU_SPRACHE = { 1: 'de', 2: 'en' };
// Tasten waehrend des Gespraechs.
export const TASTE_MITARBEITER = '0';
export const TASTE_WIDERRUF = '2';
export const sprachePer = (z) => SPRACHEN[z?.sprache] ?? SPRACHEN[STANDARD_SPRACHE];

// Unterhalb dieser Erkennungs-Konfidenz (0..1) gilt eine Aeusserung als nicht
// verstanden. Echte Saetze liegen meist ueber 0,7; Husten, Raeuspern und
// Nebengeraeusche kommen mit 0,0 bis 0,3 an.
export const MIN_KONFIDENZ = Number(process.env.TELEFON_MIN_KONFIDENZ ?? 0.4);
// So oft hintereinander darf nichts / nichts Verstaendliches kommen.
export const MAX_STUMM = Number(process.env.TELEFON_MAX_STUMM ?? 2);
export const MAX_UNVERSTANDEN = Number(process.env.TELEFON_MAX_UNVERSTANDEN ?? 3);
// Hintergrund-Antworten: so oft darf ein Traeger nachfragen, bevor der
// Anruf mit "zu lange" endet (Twilio: 12 * 2 s Pause = 24 s Rechenzeit).
export const MAX_POLLS = 12;
// Zeitbudget fuer den Modellaufruf je Runde am Telefon (siehe aeusserungVerarbeiten).
export const RUNDEN_BUDGET_MS = Number(process.env.TELEFON_RUNDEN_BUDGET_MS ?? 20_000);
// Aeusserungstext ins Log nur auf Wunsch (Datenschutz); sonst nur die Laenge.
const LOG_TEXT = process.env.LOG_TEXT === '1';

// ---------------------------------------------------------------------------
// Weiterleitung an Menschen: Zielnummer und Servicezeiten aus der Umgebung.
//   TELEFON_WEITERLEITUNG_NUMMER   E.164, z. B. +4930123456 (leer = keine)
//   TELEFON_WEITERLEITUNG_ZEITEN   z. B. "Mo-Fr 08:00-16:00" (leer = immer)
//   TELEFON_WEITERLEITUNG_HINWEIS  Satz, wenn nicht verfuegbar (optional)
// ---------------------------------------------------------------------------
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** "Mo-Fr 08:00-16:00" -> { tage:[1..5], von:480, bis:960 } (Minuten). */
export function servicezeitenParsen(text) {
  const m = String(text ?? '').trim().match(/^([A-Za-z]{2})(?:-([A-Za-z]{2}))?\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const a = WOCHENTAGE.indexOf(m[1]);
  const b = m[2] ? WOCHENTAGE.indexOf(m[2]) : a;
  if (a < 0 || b < 0) return null;
  const tage = [];
  for (let t = a; ; t = (t + 1) % 7) { tage.push(t); if (t === b) break; }
  return { tage, von: Number(m[3]) * 60 + Number(m[4]), bis: Number(m[5]) * 60 + Number(m[6]) };
}

function berlinJetzt(datum = new Date()) {
  const teile = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(datum);
  const w = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(teile.find((p) => p.type === 'weekday')?.value);
  const h = Number(teile.find((p) => p.type === 'hour')?.value) % 24;
  const mi = Number(teile.find((p) => p.type === 'minute')?.value);
  return { tag: w, minuten: h * 60 + mi };
}

/** Ist die Weiterleitung jetzt moeglich? Liefert { verfuegbar, nummer, hinweis }. */
export function weiterleitungStatus(datum = new Date(), env = process.env) {
  const nummer = String(env.TELEFON_WEITERLEITUNG_NUMMER ?? '').trim();
  const hinweis = String(env.TELEFON_WEITERLEITUNG_HINWEIS ?? '').trim() || SPRACHEN.de.texte.verbindenNichtMoeglich;
  if (!/^\+?\d{6,15}$/.test(nummer)) return { verfuegbar: false, nummer: '', hinweis };
  const zeiten = servicezeitenParsen(env.TELEFON_WEITERLEITUNG_ZEITEN);
  if (!zeiten) return { verfuegbar: true, nummer, hinweis };
  const { tag, minuten } = berlinJetzt(datum);
  const offen = zeiten.tage.includes(tag) && minuten >= zeiten.von && minuten < zeiten.bis;
  return { verfuegbar: offen, nummer, hinweis };
}

// ---------------------------------------------------------------------------
// Zustand je Anruf, adressiert ueber die Anruf-Kennung des Traegers
// (Twilio CallSid, Jambonz call_sid, ...). Telefonate sind kurzlebig -
// nach 30 Minuten ohne Aktivitaet wird aufgeraeumt. Obergrenze gegen
// Zufalls-IDs: die aeltesten fliegen raus.
// ---------------------------------------------------------------------------
const ANRUF_ABLAUF_MS = 30 * 60 * 1000;
const MAX_ANRUFE = Number(process.env.TELEFON_MAX_ZUSTAENDE ?? 1000);
const anrufe = new Map();

export function zustandFuer(anrufId) {
  const jetzt = Date.now();
  let z = anrufe.get(anrufId);
  if (!z) {
    for (const [id, alt] of anrufe) {
      if (jetzt - alt.zuletzt > ANRUF_ABLAUF_MS) anrufe.delete(id);
    }
    while (anrufe.size >= MAX_ANRUFE) anrufe.delete(anrufe.keys().next().value);
    // einwilligung: Opt-in zur Protokollierung - ohne ausdrueckliche Zustimmung
    // (Taste 1) wird die Runde NICHT ins Gespraechslog geschrieben.
    // letzteQuellen: Rechtsgrundlagen der letzten fachlichen Antwort fuer
    // Nachfragen ("Welche Paragrafen?") ohne erneute Suche.
    z = {
      verlauf: [], land: null, sprache: STANDARD_SPRACHE,
      einwilligung: false, einwilligungZeit: null,
      letzteQuellen: [], stumm: 0, unverstanden: 0, zuletzt: jetzt,
    };
    anrufe.set(anrufId, z);
  }
  z.zuletzt = jetzt;
  return z;
}

export function anrufBeenden(anrufId) {
  anrufe.delete(anrufId);
  jobs.delete(anrufId);
}

/** Sprache aus einer Menuetaste setzen; unbekannte Taste -> Standardsprache. */
export function spracheWaehlen(anrufId, taste) {
  const z = zustandFuer(anrufId);
  if (taste !== undefined && taste !== null) z.sprache = TASTE_ZU_SPRACHE[String(taste).trim()] ?? STANDARD_SPRACHE;
  return z;
}

/** Einwilligung zur Protokollierung: nur Taste 1 (bzw. "1") ist ein Ja. */
export function einwilligungWaehlen(anrufId, taste) {
  const z = zustandFuer(anrufId);
  z.einwilligung = String(taste ?? '').trim() === '1';
  z.einwilligungZeit = z.einwilligung ? Date.now() : null;
  return z;
}

// ---------------------------------------------------------------------------
// Sprechfassung: letzte Stufe vor der Stimme. Deutsch: Jahreszahlen, Daten,
// Abkuerzungen, Symbole; Englisch: Paragrafen, Daten, Abkuerzungen; Markdown
// fliegt in jeder Sprache raus.
// ---------------------------------------------------------------------------
export function sprechfassung(text, s = SPRACHEN[STANDARD_SPRACHE]) {
  if (s.normalisieren) return normalisiereFuerSprache(text);
  if (s === SPRACHEN.en) return normalisiereEnglisch(text);
  return entferneSchriftauszeichnung(text);
}

// ---------------------------------------------------------------------------
// Hintergrund-Antworten (LLM). Der Modellaufruf dauert einige Sekunden;
// Traeger mit kurzer Webhook-Frist (Twilio ~15 s) bekommen sofort "einen
// Moment" und fragen per Poll nach. Traeger ohne diese Frist koennen mit
// { sofort: true } auf die Antwort warten.
// ---------------------------------------------------------------------------
const jobs = new Map(); // anrufId -> { status, ergebnis, fehler, polls, erstellt, verworfen }
const JOB_ABLAUF_MS = 10 * 60 * 1000;

function jobsAufraeumen(jetzt = Date.now()) {
  for (const [id, j] of jobs) {
    if (jetzt - j.erstellt > JOB_ABLAUF_MS) jobs.delete(id);
  }
}
// Aufraeumen im Takt statt nur beim Anlegen neuer Jobs.
setInterval(() => jobsAufraeumen(), 60_000).unref();

const anrufKurz = (id) => String(id ?? '').slice(-8);
const textFuerLog = (t) => (LOG_TEXT ? JSON.stringify(t) : `${t.length} Zeichen`);

// Ergebnis des Sprachmodells in einen Schritt uebersetzen und den Zustand
// nachfuehren (Auflegen, Weiterleitung).
function ergebnisAnwenden(anrufId, z, ergebnis) {
  const s = sprachePer(z);
  if (ergebnis.beendet) {
    anrufBeenden(anrufId);
    return { art: 'auflegen', text: ergebnis.text, ergebnis };
  }
  if (ergebnis.weiterleiten) {
    const w = weiterleitungStatus();
    if (w.verfuegbar) return { art: 'verbinden', text: ergebnis.text || s.texte.verbinden, nummer: w.nummer, ergebnis };
    // Das Modell hat trotz Kontext weitergeleitet: Hinweis statt Zusage.
    return { art: 'sagen', text: s === SPRACHEN.de ? w.hinweis : s.texte.verbindenNichtMoeglich, ergebnis };
  }
  return { art: 'sagen', text: ergebnis.text, ergebnis };
}

/**
 * Eine Aeusserung des Anrufers verarbeiten.
 *
 * @param {object} p
 * @param {string} p.anrufId     Kennung des Anrufs beim Traeger
 * @param {string} [p.text]      erkannter Text (leer = nichts erkannt)
 * @param {number|string} [p.konfidenz]  Erkennungs-Konfidenz 0..1, optional
 * @param {string} [p.taste]     gedrueckte Taste, optional
 * @param {string} [p.kanal]     Kanalname fuers Protokoll ('telefon', 'jambonz', ...)
 * @param {boolean} [p.sofort]   auf die Modellantwort warten statt Hintergrund-Job
 * @returns {Promise<{art:'sagen'|'auflegen'|'verbinden'|'warten', text?:string, nummer?:string, ergebnis?:object}>}
 */
export async function aeusserungVerarbeiten({ anrufId, text, konfidenz, taste, kanal = 'telefon', sofort = false }) {
  const z = zustandFuer(anrufId);
  const s = sprachePer(z);
  const gesagt = String(text ?? '').trim();
  const tasteStr = taste === undefined || taste === null ? '' : String(taste).trim();

  // Diagnose-/Sichtbarkeitszeile ohne Inhalt (LOG_TEXT=1 zeigt den Text).
  if (text !== undefined || tasteStr) {
    console.log(`  eingabe ${kanal} anruf=${anrufKurz(anrufId)} sprache=${z.sprache} taste=${tasteStr} konfidenz=${konfidenz ?? ''} text=${textFuerLog(gesagt)}`);
  }

  // --- Tasten mit fester Bedeutung ---------------------------------------
  if (tasteStr === TASTE_MITARBEITER) {
    z.stumm = 0; z.unverstanden = 0;
    const w = weiterleitungStatus();
    if (w.verfuegbar) return { art: 'verbinden', text: s.texte.verbinden, nummer: w.nummer };
    return { art: 'sagen', text: s === SPRACHEN.de ? w.hinweis : s.texte.verbindenNichtMoeglich };
  }
  if (tasteStr === TASTE_WIDERRUF) {
    z.stumm = 0; z.unverstanden = 0;
    if (!z.einwilligung) return { art: 'sagen', text: s.texte.keinWiderruf };
    z.einwilligung = false;
    z.einwilligungZeit = null;
    const geloescht = await protokollLoeschen(anrufId);
    console.log(`  widerruf ${kanal} anruf=${anrufKurz(anrufId)} geloescht=${geloescht}`);
    return { art: 'sagen', text: s.texte.widerrufBestaetigt };
  }
  if (!gesagt && tasteStr) return { art: 'sagen', text: s.texte.tasteUnbekannt };

  // --- Stille ---------------------------------------------------------------
  if (!gesagt) {
    z.stumm += 1;
    if (z.stumm >= MAX_STUMM) {
      anrufBeenden(anrufId);
      return { art: 'auflegen', text: s.texte.danke };
    }
    return { art: 'sagen', text: s.texte.nichtsGehoert };
  }
  z.stumm = 0;

  // --- Zu unsichere Erkennung (Husten, Nebengeraeusche) ---------------------
  // Nicht ans Sprachmodell geben - es wuerde aus dem Verlauf eine Antwort
  // erfinden. Ohne Konfidenzangabe greift die Sperre nicht.
  const sicher = Number.parseFloat(konfidenz);
  if (Number.isFinite(sicher) && sicher < MIN_KONFIDENZ) {
    z.unverstanden += 1;
    if (z.unverstanden >= MAX_UNVERSTANDEN) {
      anrufBeenden(anrufId);
      return { art: 'auflegen', text: s.texte.unverstandenEnde };
    }
    return { art: 'sagen', text: s.texte.wiederholen };
  }
  z.unverstanden = 0;

  // Nennt der Anrufer sein Bundesland oder eine bekannte Stadt, bleibt das
  // fuer den Rest des Anrufs gesetzt - wie im Browser-Dialog.
  const landTreffer = erkenneLand(gesagt);
  if (landTreffer) z.land = landTreffer.code;

  const beginn = Date.now();
  // Zeitbudget je Runde am Telefon: Jambonz gibt nach 30 s auf, Twilio nach
  // ~24 s Polling. 20 s lassen Luft fuer Sprachausgabe und Uebertragung.
  const anfrage = {
    nachricht: gesagt, verlauf: z.verlauf, land: z.land, sprache: z.sprache, quellenZuvor: z.letzteQuellen,
    kanal, budgetMs: RUNDEN_BUDGET_MS, weiterleitung: weiterleitungStatus(),
  };
  const merken = (ergebnis) => {
    z.verlauf.push({ rolle: 'nutzer', text: gesagt }, { rolle: 'bot', text: ergebnis.text });
    if (z.verlauf.length > 24) z.verlauf = z.verlauf.slice(-24);
    if (ergebnis.quellen?.length) z.letzteQuellen = ergebnis.quellen.slice(0, 8);
  };
  // Protokolliert wird NUR mit ausdruecklicher Einwilligung (Taste 1 zu
  // Gespraechsbeginn), mit Zeitpunkt und Wortlaut als Nachweis.
  const protokoll = (ergebnis) => {
    if (!z.einwilligung) return;
    protokolliere({
      callSid: anrufId, kanal, land: z.land, sprache: z.sprache, frage: gesagt,
      antwort: ergebnis.text, modus: ergebnis.modus, modell: ergebnis.modell,
      confidence: sicher, quellen: ergebnis.quellen, werkzeuge: ergebnis.werkzeuge,
      dauerMs: Date.now() - beginn, beendet: Boolean(ergebnis.beendet),
      einwilligungZeit: z.einwilligungZeit, einwilligungText: s.texte.einwilligung,
    });
  };
  // Latenz ist kein personenbezogenes Datum: immer loggen, ohne Inhalt.
  const bilanz = (ergebnis) => {
    const ms = Date.now() - beginn;
    console.log(`  runde ${kanal} anruf=${anrufKurz(anrufId)} modus=${ergebnis.modus} llm_ms=${ms} werkzeuge=${ergebnis.werkzeuge?.length ?? 0}${ergebnis.beendet ? ' beendet' : ''}${ergebnis.weiterleiten ? ' weiterleiten' : ''}`);
    beobachte('runde_dauer_ms', ms, { kanal });
    zaehle('runden_total', { kanal, modus: ergebnis.modus ?? 'unbekannt' });
  };
  // Zeitueberschreitung ist keine "technische Stoerung": eigener Text, auflegen.
  const fehlerSchritt = (fehler) => {
    console.error(`  sprachmodell ${kanal} anruf=${anrufKurz(anrufId)}: ${fehler.message}`);
    anrufBeenden(anrufId);
    return { art: 'auflegen', text: fehler?.name === 'BudgetFehler' ? s.texte.zuLange : s.texte.stoerung };
  };

  // Mock-Modus ist schnell: immer synchron. Sonst nur auf Wunsch des Traegers.
  if (sofort || !llmKonfiguriert()) {
    let ergebnis;
    try {
      ergebnis = await gespraechsschritt(anfrage);
    } catch (fehler) {
      return fehlerSchritt(fehler);
    }
    merken(ergebnis);
    protokoll(ergebnis);
    bilanz(ergebnis);
    return ergebnisAnwenden(anrufId, z, ergebnis);
  }

  // Hintergrund: sofort vertroesten, Traeger fragt per antwortAbholen nach.
  // Ein noch laufender aelterer Job (Doppelzustellung) wird verworfen.
  const alt = jobs.get(anrufId);
  if (alt && alt.status === 'pending') alt.verworfen = true;
  const job = { status: 'pending', ergebnis: null, fehler: null, polls: 0, erstellt: Date.now(), verworfen: false };
  jobs.set(anrufId, job);
  gespraechsschritt(anfrage)
    .then((ergebnis) => {
      if (job.verworfen) return;
      job.ergebnis = ergebnis;
      job.status = 'done';
      merken(ergebnis);
      protokoll(ergebnis);
      bilanz(ergebnis);
    })
    .catch((fehler) => { if (!job.verworfen) { job.fehler = fehler; job.status = 'error'; } });
  return { art: 'warten', text: s.texte.moment };
}

/**
 * Hintergrund-Antwort abholen. Liefert 'warten', solange gerechnet wird
 * (zaehlt die Nachfragen und bricht nach MAX_POLLS ab), sonst den Schritt.
 */
export function antwortAbholen(anrufId) {
  const z = anrufe.get(anrufId);
  const s = sprachePer(z);
  const job = jobs.get(anrufId);

  // Kein laufender Job (etwa nach Server-Neustart): einfach weiter zuhoeren.
  if (!job) return { art: 'sagen', text: s.texte.wiederholen };
  if (job.status === 'error') {
    jobs.delete(anrufId);
    anrufBeenden(anrufId);
    return { art: 'auflegen', text: job.fehler?.name === 'BudgetFehler' ? s.texte.zuLange : s.texte.stoerung };
  }
  if (job.status === 'done') {
    jobs.delete(anrufId);
    return ergebnisAnwenden(anrufId, z ?? zustandFuer(anrufId), job.ergebnis);
  }
  job.polls += 1;
  if (job.polls > MAX_POLLS) {
    job.verworfen = true;
    jobs.delete(anrufId);
    anrufBeenden(anrufId);
    return { art: 'auflegen', text: s.texte.zuLange };
  }
  return { art: 'warten' };
}

/** Anzahl bekannter Anrufzustaende (fuer Gesundheit und Metriken). */
export function anrufeAnzahl() { return anrufe.size; }

/** Nur fuer Tests: Zustand eines Anrufs einsehen bzw. alles verwerfen. */
export function _anrufZustand(anrufId) { return anrufe.get(anrufId) ?? null; }
export function _anrufeLeeren() { anrufe.clear(); }
/** Nur fuer Tests: Hintergrund-Jobs einsehen, setzen und aufraeumen. */
export function _jobs() { return jobs; }
export function _jobsAufraeumen(jetzt) { jobsAufraeumen(jetzt); }
