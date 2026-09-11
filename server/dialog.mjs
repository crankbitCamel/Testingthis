/**
 * Gespraechslogik am Telefon - unabhaengig vom Telefonie-Traeger.
 *
 * Hier liegt alles, was fuer JEDEN Traeger (Twilio, sipgate flow, Jambonz)
 * gleich ist: Sprachen und Ansagetexte, der Zustand je Anruf, Sprachwahl,
 * Einwilligung, die Konfidenz-Sperre, der Aufruf des Sprachmodells samt
 * Hintergrund-Job, Verlauf, Quellen fuer Nachfragen und das Protokoll.
 *
 * Die Adapter (telefon.mjs fuer Twilio, weitere folgen) uebersetzen nur
 * noch: Eingang (Formular, JSON, WebSocket) -> diese Funktionen -> Ausgang
 * (TwiML, JSON-Aktionen). Sie kennen keine Gespraechsregeln.
 *
 * Rueckgabeform aller Schritte ist ein "Schritt":
 *   { art: 'sagen',    text }           Text sprechen, dann weiter zuhoeren
 *   { art: 'auflegen', text }           Text sprechen, dann auflegen
 *   { art: 'warten' }                   Antwort wird im Hintergrund berechnet
 */
import { gespraechsschritt, llmKonfiguriert } from './assistent.mjs';
import { erkenneLand } from '../src/nlu.js';
import { protokolliere } from './gespraechslog.mjs';
import { normalisiereFuerSprache, entferneSchriftauszeichnung } from './sprechnormalisierung.mjs';

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
      // Runde, kein Tonmitschnitt - die Ansage muss dem entsprechen.
      einwilligung: 'Zur Verbesserung unserer KI-gestützten Auskunft würden wir das Gespräch gerne schriftlich protokollieren. '
        + 'Drücken Sie die Eins, wenn Sie zustimmen, oder die Zwei, wenn Sie dies nicht wünschen.',
      begruessung: 'Guten Tag, hier ist der digitale Verwaltungsassistent. '
        + 'Schildern Sie Ihr Anliegen einfach in eigenen Worten - zum Beispiel: '
        + 'Ich bin umgezogen. Oder: Was kostet ein Reisepass?',
      nichtsGehoert: 'Ich habe nichts gehört. Sagen Sie Ihr Anliegen bitte noch einmal - oder legen Sie einfach auf.',
      danke: 'Vielen Dank für Ihren Anruf. Auf Wiederhören.',
      tastendruck: 'Tastendruck erkannt. Der Rückruf zum Server funktioniert. Stellen Sie jetzt bitte Ihre Frage in eigenen Worten.',
      nichtVerstanden: 'Entschuldigung, das habe ich nicht verstanden. Sagen Sie es bitte noch einmal.',
      stoerung: 'Entschuldigung, es gab gerade eine technische Störung. Bitte versuchen Sie es in einem Moment erneut. Auf Wiederhören.',
      moment: 'Einen Moment, ich schaue das für Sie nach.',
      wiederholen: 'Entschuldigung, bitte wiederholen Sie Ihre Frage.',
      zuLange: 'Das dauert diesmal leider zu lange. Bitte versuchen Sie es erneut. Auf Wiederhören.',
    },
  },
  en: {
    code: 'en-GB',
    stimme: process.env.TELEFON_STIMME_EN ?? 'Polly.Amy-Neural',
    normalisieren: false,
    texte: {
      menue: 'For English, press two.',
      einwilligung: 'To improve our AI-assisted information service, we would like to keep a written record of this conversation. '
        + 'Press one if you agree, or two if you do not wish this.',
      begruessung: 'Hello, this is the digital public services assistant. '
        + 'Just describe what you need in your own words - for example: '
        + 'I have moved house. Or: How much does a passport cost?',
      nichtsGehoert: "I didn't hear anything. Please say what you need once more - or simply hang up.",
      danke: 'Thank you for calling. Goodbye.',
      tastendruck: 'Key press received. The connection to the server works. Please ask your question now in your own words.',
      nichtVerstanden: "Sorry, I didn't catch that. Please say it again.",
      stoerung: 'Sorry, there was a technical problem. Please try again in a moment. Goodbye.',
      moment: 'One moment, I am looking that up for you.',
      wiederholen: 'Sorry, please repeat your question.',
      zuLange: 'This is taking too long, unfortunately. Please try again. Goodbye.',
    },
  },
};
export const STANDARD_SPRACHE = 'de';
// Tastenmenue: Taste -> Sprachcode. Alles andere faellt auf Deutsch zurueck.
export const TASTE_ZU_SPRACHE = { 1: 'de', 2: 'en' };
export const sprachePer = (z) => SPRACHEN[z?.sprache] ?? SPRACHEN[STANDARD_SPRACHE];

// Unterhalb dieser Erkennungs-Konfidenz (0..1) gilt eine Aeusserung als nicht
// verstanden. Echte Saetze liegen bei Twilio meist ueber 0,7; Husten,
// Raeuspern und Nebengeraeusche kommen mit 0,0 bis 0,3 an.
export const MIN_KONFIDENZ = Number(process.env.TELEFON_MIN_KONFIDENZ ?? 0.4);
// Hintergrund-Antworten: so oft darf ein Traeger nachfragen, bevor der
// Anruf mit "zu lange" endet (Twilio: 12 * 2 s Pause = 24 s Rechenzeit).
export const MAX_POLLS = 12;

// ---------------------------------------------------------------------------
// Zustand je Anruf, adressiert ueber die Anruf-Kennung des Traegers
// (Twilio CallSid, sipgate session id, ...). Telefonate sind kurzlebig -
// nach 30 Minuten ohne Aktivitaet wird aufgeraeumt.
// ---------------------------------------------------------------------------
const ANRUF_ABLAUF_MS = 30 * 60 * 1000;
const anrufe = new Map();

export function zustandFuer(anrufId) {
  const jetzt = Date.now();
  for (const [id, z] of anrufe) {
    if (jetzt - z.zuletzt > ANRUF_ABLAUF_MS) anrufe.delete(id);
  }
  let z = anrufe.get(anrufId);
  if (!z) {
    // einwilligung: Opt-in zur Protokollierung - ohne ausdrueckliche Zustimmung
    // (Taste 1) wird die Runde NICHT ins Gespraechslog geschrieben.
    // letzteQuellen: Rechtsgrundlagen der letzten fachlichen Antwort. Vorgelesen
    // wird nur die Kurzform; fragt der Anrufer nach ("Welche Paragrafen?"),
    // bekommt das Modell sie als Kontext und muss nicht erneut suchen.
    z = { verlauf: [], land: null, sprache: STANDARD_SPRACHE, einwilligung: false, letzteQuellen: [], zuletzt: jetzt };
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
  return z;
}

// ---------------------------------------------------------------------------
// Sprechfassung: letzte Stufe vor der Stimme. Fuer Deutsch werden Jahres-
// zahlen, Daten, Abkuerzungen und Symbole vorlesbar gemacht; Markdown fliegt
// in jeder Sprache raus.
// ---------------------------------------------------------------------------
export function sprechfassung(text, s = SPRACHEN[STANDARD_SPRACHE]) {
  return s.normalisieren ? normalisiereFuerSprache(text) : entferneSchriftauszeichnung(text);
}

// ---------------------------------------------------------------------------
// Hintergrund-Antworten (LLM). Der Modellaufruf dauert einige Sekunden;
// Traeger mit kurzer Webhook-Frist (Twilio ~15 s) bekommen sofort "einen
// Moment" und fragen per Poll nach. Traeger ohne diese Frist koennen mit
// { sofort: true } auf die Antwort warten.
// ---------------------------------------------------------------------------
const jobs = new Map(); // anrufId -> { status, ergebnis, fehler, polls, erstellt }
// Legt ein Anrufer auf, waehrend seine Antwort noch berechnet wird, holt den
// fertigen Job niemand mehr ab. Damit sich das nicht ansammelt, verfallen
// Jobs nach einer grosszuegigen Frist.
const JOB_ABLAUF_MS = 10 * 60 * 1000;

function jobsAufraeumen(jetzt = Date.now()) {
  for (const [id, j] of jobs) {
    if (jetzt - j.erstellt > JOB_ABLAUF_MS) jobs.delete(id);
  }
}

// Ergebnis des Sprachmodells in einen Schritt uebersetzen und den Zustand
// nachfuehren (Verlauf, Quellen, Auflegen).
function ergebnisAnwenden(anrufId, z, ergebnis) {
  if (ergebnis.beendet) {
    anrufBeenden(anrufId);
    return { art: 'auflegen', text: ergebnis.text, ergebnis };
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
 * @param {string} [p.kanal]     Kanalname fuers Protokoll ('telefon', 'sipgate', ...)
 * @param {boolean} [p.sofort]   auf die Modellantwort warten statt Hintergrund-Job
 * @returns {Promise<{art:'sagen'|'auflegen'|'warten', text?:string, ergebnis?:object}>}
 */
export async function aeusserungVerarbeiten({ anrufId, text, konfidenz, taste, kanal = 'telefon', sofort = false }) {
  const z = zustandFuer(anrufId);
  const s = sprachePer(z);
  const gesagt = String(text ?? '').trim();

  // Diagnose-/Sichtbarkeitszeile: zeigt im Server-Fenster, was der Traeger liefert.
  if (text !== undefined || taste !== undefined) {
    console.log(`  eingabe ${kanal} ${anrufId} sprache=${z.sprache} Taste=${taste ?? ''} Konfidenz=${konfidenz ?? ''} Text=${JSON.stringify(gesagt)}`);
  }

  // Tastendruck ohne erkannte Sprache: bestaetigt hoerbar, dass der Rueckweg
  // Traeger -> Server funktioniert.
  if (!gesagt && taste) return { art: 'sagen', text: s.texte.tastendruck };
  if (!gesagt) return { art: 'sagen', text: s.texte.nichtVerstanden };

  // Erkenner liefern auch fuer Husten oder Nebengeraeusche ein "Wort" - dann
  // aber mit Konfidenz nahe null. Solche Eingaben nicht ans Sprachmodell
  // geben (es wuerde aus dem Verlauf eine Antwort erfinden), sondern um
  // Wiederholung bitten. Ohne Konfidenzangabe greift die Sperre nicht.
  const sicher = Number.parseFloat(konfidenz);
  if (Number.isFinite(sicher) && sicher < MIN_KONFIDENZ) return { art: 'sagen', text: s.texte.wiederholen };

  // Nennt der Anrufer sein Bundesland oder eine bekannte Stadt, bleibt das
  // fuer den Rest des Anrufs gesetzt - wie im Browser-Dialog.
  const landTreffer = erkenneLand(gesagt);
  if (landTreffer) z.land = landTreffer.code;

  const beginn = Date.now();
  const anfrage = { nachricht: gesagt, verlauf: z.verlauf, land: z.land, sprache: z.sprache, quellenZuvor: z.letzteQuellen };
  const merken = (ergebnis) => {
    z.verlauf.push({ rolle: 'nutzer', text: gesagt }, { rolle: 'bot', text: ergebnis.text });
    if (z.verlauf.length > 24) z.verlauf = z.verlauf.slice(-24);
    if (ergebnis.quellen?.length) z.letzteQuellen = ergebnis.quellen.slice(0, 8);
  };
  // Protokolliert wird NUR mit ausdruecklicher Einwilligung (Taste 1 zu
  // Gespraechsbeginn). Ohne Zustimmung laeuft das Gespraech normal, aber
  // ohne Log-Eintrag.
  const protokoll = (ergebnis) => {
    if (!z.einwilligung) return;
    protokolliere({
      callSid: anrufId, kanal, land: z.land, sprache: z.sprache, frage: gesagt,
      antwort: ergebnis.text, modus: ergebnis.modus, modell: ergebnis.modell,
      confidence: sicher, quellen: ergebnis.quellen, werkzeuge: ergebnis.werkzeuge,
      dauerMs: Date.now() - beginn, beendet: Boolean(ergebnis.beendet),
    });
  };

  // Mock-Modus ist schnell: immer synchron. Sonst nur auf Wunsch des Traegers.
  if (sofort || !llmKonfiguriert()) {
    let ergebnis;
    try {
      ergebnis = await gespraechsschritt(anfrage);
    } catch (fehler) {
      console.error('  sprachmodell:', fehler.message);
      return { art: 'auflegen', text: s.texte.stoerung };
    }
    merken(ergebnis);
    protokoll(ergebnis);
    return ergebnisAnwenden(anrufId, z, ergebnis);
  }

  // Hintergrund: sofort vertroesten, Traeger fragt per antwortAbholen nach.
  jobsAufraeumen();
  const job = { status: 'pending', ergebnis: null, fehler: null, polls: 0, erstellt: Date.now() };
  jobs.set(anrufId, job);
  gespraechsschritt(anfrage)
    .then((ergebnis) => {
      job.ergebnis = ergebnis;
      job.status = 'done';
      merken(ergebnis);
      protokoll(ergebnis);
    })
    .catch((fehler) => { job.fehler = fehler; job.status = 'error'; });
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
    return { art: 'auflegen', text: s.texte.stoerung };
  }
  if (job.status === 'done') {
    jobs.delete(anrufId);
    return ergebnisAnwenden(anrufId, z ?? zustandFuer(anrufId), job.ergebnis);
  }
  job.polls += 1;
  if (job.polls > MAX_POLLS) {
    jobs.delete(anrufId);
    return { art: 'auflegen', text: s.texte.zuLange };
  }
  return { art: 'warten' };
}

/** Nur fuer Tests: Zustand eines Anrufs einsehen bzw. alles verwerfen. */
export function _anrufZustand(anrufId) { return anrufe.get(anrufId) ?? null; }
export function _anrufeLeeren() { anrufe.clear(); }
/** Nur fuer Tests: Hintergrund-Jobs einsehen, setzen und aufraeumen. */
export function _jobs() { return jobs; }
export function _jobsAufraeumen(jetzt) { jobsAufraeumen(jetzt); }
