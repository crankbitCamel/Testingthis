/**
 * Telefonie-Adapter: uebersetzt Twilio-Voice-Anrufe in die Gespraechslogik.
 *
 * Funktionsweise: Bei jedem Anruf (und nach jeder Aeusserung des Anrufers)
 * ruft Twilio unseren Server per HTTP-POST auf und erwartet als Antwort
 * TwiML - ein kleines XML, das beschreibt, was der Anrufer als Naechstes
 * hoert. Spracherkennung (<Gather input="speech">) und Sprachausgabe
 * (<Say> mit Neural-Stimme) bringt Twilio mit; unsere Aufgabe ist nur,
 * Text hereinzunehmen und Text zurueckzugeben. Dadurch bedient exakt
 * dieselbe Gespraechslogik (gespraechsschritt mit Bewertung, Rueckfragen
 * und Auflegen), die auch der Browser nutzt, eine echte Telefonnummer.
 *
 * Sprachwahl: Der Anruf beginnt mit einem Tastenmenue ("Fuer Deutsch die 1,
 * for English press 2"). Die gewaehlte Sprache liegt im Anrufzustand und
 * steuert die ganze Kette: Ansagetexte, Stimme, Erkennungssprache, die
 * Anweisung ans Modell und die Sprechnormalisierung. Ohne Tastendruck gilt
 * Deutsch. Ein Tastendruck ist deterministisch - anders als automatische
 * Spracherkennung auf kurzen Aeusserungen. In der spaeteren eigenen Pipeline
 * (Whisper) kommt eine Gegenpruefung ueber die von Whisper erkannte Sprache
 * hinzu; der Zustand hier wandert eins zu eins mit.
 *
 * Bewusst rundenbasiert statt Audio-Streaming: einfacher, robust, und fuer
 * Auskunftsdialoge voellig ausreichend.
 */
import { gespraechsschritt, llmKonfiguriert } from './assistent.mjs';
import { erkenneLand } from '../src/nlu.js';
import { protokolliere } from './gespraechslog.mjs';
import { normalisiereFuerSprache, entferneSchriftauszeichnung } from './sprechnormalisierung.mjs';

// ---------------------------------------------------------------------------
// Sprachen: alles, was je Sprache verschieden ist, an EINER Stelle.
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
const STANDARD_SPRACHE = 'de';
// Tastenmenue: Taste -> Sprachcode. Alles andere faellt auf Deutsch zurueck.
const TASTE_ZU_SPRACHE = { 1: 'de', 2: 'en' };
const sprachePer = (z) => SPRACHEN[z?.sprache] ?? SPRACHEN[STANDARD_SPRACHE];

// Gespraechszustand je Anruf, adressiert ueber Twilios CallSid. Telefonate
// sind kurzlebig - nach 30 Minuten ohne Aktivitaet wird aufgeraeumt.
const ANRUF_ABLAUF_MS = 30 * 60 * 1000;
const anrufe = new Map();

function zustandFuer(callSid) {
  const jetzt = Date.now();
  for (const [sid, z] of anrufe) {
    if (jetzt - z.zuletzt > ANRUF_ABLAUF_MS) anrufe.delete(sid);
  }
  let z = anrufe.get(callSid);
  if (!z) {
    // einwilligung: Opt-in zur Protokollierung - ohne ausdrueckliche Zustimmung
    // (Taste 1) wird die Runde NICHT ins Gespraechslog geschrieben.
    // letzteQuellen: Rechtsgrundlagen der letzten fachlichen Antwort. Vorgelesen
    // wird nur die Kurzform; fragt der Anrufer nach ("Welche Paragrafen?"),
    // bekommt das Modell sie als Kontext und muss nicht erneut suchen.
    z = { verlauf: [], land: null, sprache: STANDARD_SPRACHE, einwilligung: false, letzteQuellen: [], zuletzt: jetzt };
    anrufe.set(callSid, z);
  }
  z.zuletzt = jetzt;
  return z;
}

export function xmlEscape(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const twiml = (inhalt) => `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inhalt}</Response>`;

// Letzte Stufe vor der Stimme. Fuer Deutsch werden Jahreszahlen, Daten,
// Abkuerzungen und Symbole vorlesbar gemacht (2026-08 -> "August zweitausend-
// sechsundzwanzig"); fuer andere Sprachen bleibt der Text unveraendert.
function sag(text, s = SPRACHEN[STANDARD_SPRACHE]) {
  // Schriftauszeichnung (Markdown) fliegt in jeder Sprache raus; die deutsche
  // Zahl-/Datums-/Abkuerzungsnormalisierung nur, wo die Sprachtabelle es sagt.
  const t = s.normalisieren ? normalisiereFuerSprache(text) : entferneSchriftauszeichnung(text);
  return `<Say voice="${s.stimme}" language="${s.code}">${xmlEscape(t)}</Say>`;
}

/**
 * Gather-Attribute fuers Zuhoeren:
 * - input="speech dtmf": Sprache und Tastendruck; der Tastendruck dient als
 *   Diagnose und Rueckfallweg, falls die Erkennung nichts liefert.
 * - language: die gewaehlte Sprache des Anrufs (steuert die Erkennung).
 * - speechModel="phone_call" + enhanced="true": auf Telefonqualitaet trainiert.
 * - timeout="8" / speechTimeout="auto" / actionOnEmptyResult="true": bis 8 s
 *   auf Sprechbeginn warten, Ende automatisch erkennen, Server auch bei
 *   leerer Erkennung aufrufen, damit der Anruf nie stumm weiterlaeuft.
 * Die action-Adresse ist VOLLSTAENDIG (mit Basis), weil Twilio bei per API
 * gestarteten Anrufen relative Adressen nicht zuverlaessig aufloest.
 */
const zuhoerAttrs = (basis, s) =>
  `input="speech dtmf" numDigits="1" language="${s.code}" speechModel="phone_call" enhanced="true" timeout="8" speechTimeout="auto" actionOnEmptyResult="true" action="${basis}/api/telefon/eingabe" method="POST"`;

/**
 * Innerer TwiML-Inhalt: Text sprechen und zuhoeren. Antwortet der Anrufer
 * nicht, laeuft es weiter: ein Hinweis, zweite Chance, dann Ende.
 */
function zuhoerenInhalt(text, basis, s) {
  const attrs = zuhoerAttrs(basis, s);
  return `<Gather ${attrs}>${sag(text, s)}</Gather>`
    + sag(s.texte.nichtsGehoert, s)
    + `<Gather ${attrs}/>`
    + sag(s.texte.danke, s)
    + '<Hangup/>';
}

const sagUndZuhoeren = (text, basis = '', s = SPRACHEN[STANDARD_SPRACHE]) =>
  twiml(zuhoerenInhalt(text, basis, s));

// --- Hintergrund-Antworten (LLM) -------------------------------------------
// Der LLM-Aufruf dauert einige Sekunden. Wuerde der Server so lange warten,
// bevor er Twilio antwortet, bricht der Anruf ab - Twilio und der Tunnel
// halten eine einzelne Verbindung nicht ~15 s offen. Deshalb: sofort mit
// "Einen Moment" antworten, im Hintergrund rechnen und per <Redirect> so
// lange nachfragen, bis die Antwort bereitliegt.
const jobs = new Map(); // CallSid -> { status, ergebnis, fehler, polls, erstellt }
const MAX_POLLS = 12;   // bis zu ~12 * 2 s = 24 s Rechenzeit
// Unterhalb dieser Erkennungs-Konfidenz (0..1) gilt eine Aeusserung als nicht
// verstanden. Echte Saetze liegen bei Twilio meist ueber 0,7; Husten,
// Raeuspern und Nebengeraeusche kommen mit 0,0 bis 0,3 an.
const MIN_KONFIDENZ = Number(process.env.TELEFON_MIN_KONFIDENZ ?? 0.4);
// Legt ein Anrufer auf, waehrend seine Antwort noch berechnet wird, holt den
// fertigen Job niemand mehr ab. Damit sich das nicht ansammelt, verfallen
// Jobs nach einer grosszuegigen Frist.
const JOB_ABLAUF_MS = 10 * 60 * 1000;

function jobsAufraeumen(jetzt = Date.now()) {
  for (const [sid, j] of jobs) {
    if (jetzt - j.erstellt > JOB_ABLAUF_MS) jobs.delete(sid);
  }
}

const wartenRedirect = (basis = '') =>
  `<Redirect method="POST">${basis}/api/telefon/warten</Redirect>`;

/**
 * Anrufbeginn (Twilio-Webhook "A call comes in"): das Sprachmenue.
 * Ohne Tastendruck innerhalb von 5 s geht es in der Standardsprache weiter.
 */
export function sprachwahl({ CallSid } = {}, basis = '') {
  zustandFuer(CallSid ?? 'ohne-sid');
  const de = SPRACHEN.de;
  const en = SPRACHEN.en;
  return twiml(
    `<Gather input="dtmf" numDigits="1" timeout="5" action="${basis}/api/telefon/sprache" method="POST">`
    + sag(de.texte.menue, de)
    + sag(en.texte.menue, en)
    + '</Gather>'
    + zuhoerenInhalt(de.texte.begruessung, basis, de),
  );
}

/**
 * Schritt 2 (action des Sprachmenues): Sprache aus der Taste setzen und die
 * Einwilligungsfrage in dieser Sprache stellen. Ohne Taste innerhalb von 5 s
 * gilt KEINE Einwilligung, und es geht direkt mit der Begruessung weiter.
 */
export function sprachSetzen({ CallSid, Digits } = {}, basis = '') {
  const z = zustandFuer(CallSid ?? 'ohne-sid');
  if (Digits !== undefined) z.sprache = TASTE_ZU_SPRACHE[String(Digits).trim()] ?? STANDARD_SPRACHE;
  const s = sprachePer(z);
  return twiml(
    `<Gather input="dtmf" numDigits="1" timeout="5" action="${basis}/api/telefon/einwilligung" method="POST">`
    + sag(s.texte.einwilligung, s)
    + '</Gather>'
    + zuhoerenInhalt(s.texte.begruessung, basis, s),
  );
}

/**
 * Schritt 3 (action der Einwilligungsfrage): Taste 1 = Zustimmung zur
 * Protokollierung, alles andere = keine. Danach die Begruessung.
 */
export function einwilligungSetzen({ CallSid, Digits } = {}, basis = '') {
  const z = zustandFuer(CallSid ?? 'ohne-sid');
  z.einwilligung = String(Digits ?? '').trim() === '1';
  const s = sprachePer(z);
  return sagUndZuhoeren(s.texte.begruessung, basis, s);
}

/**
 * Begruessung in der gewaehlten Sprache. Kommt Digits mit, wird die Sprache
 * gesetzt; ohne Digits bleibt die bisherige (bzw. die Standardsprache). Als
 * direkter Anrufbeginn ohne Menues nutzbar (Tests, einfache Konfigurationen).
 */
export function anrufBeginn({ CallSid, Digits } = {}, basis = '') {
  const z = zustandFuer(CallSid ?? 'ohne-sid');
  if (Digits !== undefined) z.sprache = TASTE_ZU_SPRACHE[String(Digits).trim()] ?? STANDARD_SPRACHE;
  const s = sprachePer(z);
  return sagUndZuhoeren(s.texte.begruessung, basis, s);
}

/** TwiML fuer jede erkannte Aeusserung (action des Gather). */
export async function anrufEingabe({ CallSid, SpeechResult, Digits, Confidence } = {}, basis = '') {
  const z = zustandFuer(CallSid ?? 'ohne-sid');
  const s = sprachePer(z);
  const gesagt = (SpeechResult ?? '').trim();

  // Diagnose-/Sichtbarkeitszeile: zeigt im Server-Fenster, was Twilio liefert.
  if (SpeechResult !== undefined || Digits !== undefined) {
    console.log(`  eingabe CallSid=${CallSid} sprache=${z.sprache} Digits=${Digits ?? ''} Confidence=${Confidence ?? ''} SpeechResult=${JSON.stringify(gesagt)}`);
  }

  // Tastendruck ohne erkannte Sprache: bestaetigt hoerbar, dass der Rueckweg
  // Twilio -> Server funktioniert.
  if (!gesagt && Digits) {
    return sagUndZuhoeren(s.texte.tastendruck, basis, s);
  }

  if (!gesagt) {
    return sagUndZuhoeren(s.texte.nichtVerstanden, basis, s);
  }

  // Twilio liefert auch fuer Husten oder Nebengeraeusche ein "Wort" - dann
  // aber mit Konfidenz nahe null. Solche Eingaben nicht ans Sprachmodell
  // geben (es wuerde aus dem Verlauf eine Antwort erfinden), sondern um
  // Wiederholung bitten. Ohne Konfidenzangabe (Tests, andere Traeger)
  // greift die Sperre nicht.
  const sicher = Number.parseFloat(Confidence);
  if (Number.isFinite(sicher) && sicher < MIN_KONFIDENZ) {
    return sagUndZuhoeren(s.texte.wiederholen, basis, s);
  }

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
      callSid: CallSid, kanal: 'telefon', land: z.land, sprache: z.sprache, frage: gesagt,
      antwort: ergebnis.text, modus: ergebnis.modus, modell: ergebnis.modell,
      confidence: sicher, quellen: ergebnis.quellen, werkzeuge: ergebnis.werkzeuge,
      dauerMs: Date.now() - beginn, beendet: Boolean(ergebnis.beendet),
    });
  };

  // Mock-Modus: schnell und synchron - kein Timeout-Risiko, deckt die Tests ab.
  if (!llmKonfiguriert()) {
    let ergebnis;
    try {
      ergebnis = await gespraechsschritt(anfrage);
    } catch (fehler) {
      return twiml(sag(s.texte.stoerung, s) + '<Hangup/>');
    }
    merken(ergebnis);
    protokoll(ergebnis);
    if (ergebnis.beendet) {
      anrufe.delete(CallSid);
      return twiml(sag(ergebnis.text, s) + '<Hangup/>');
    }
    return sagUndZuhoeren(ergebnis.text, basis, s);
  }

  // LLM-Modus: Antwort im Hintergrund berechnen, Twilio sofort vertroesten.
  const schluessel = CallSid ?? 'ohne-sid';
  jobsAufraeumen();
  const job = { status: 'pending', ergebnis: null, fehler: null, polls: 0, erstellt: Date.now() };
  jobs.set(schluessel, job);
  gespraechsschritt(anfrage)
    .then((ergebnis) => {
      job.ergebnis = ergebnis;
      job.status = 'done';
      merken(ergebnis);
      protokoll(ergebnis);
    })
    .catch((fehler) => { job.fehler = fehler; job.status = 'error'; });

  return twiml(sag(s.texte.moment, s) + wartenRedirect(basis));
}

/**
 * Poll-Endpunkt: Twilio kehrt per <Redirect> hierher zurueck, bis die im
 * Hintergrund berechnete Antwort bereitliegt. Jede Antwort kommt sofort,
 * sodass nie eine Zeitueberschreitung entsteht.
 */
export async function anrufWarten({ CallSid } = {}, basis = '') {
  const schluessel = CallSid ?? 'ohne-sid';
  const s = sprachePer(anrufe.get(schluessel));
  const job = jobs.get(schluessel);

  if (!job) {
    // Kein laufender Job (etwa nach Server-Neustart): einfach weiter zuhoeren.
    return sagUndZuhoeren(s.texte.wiederholen, basis, s);
  }
  if (job.status === 'error') {
    jobs.delete(schluessel);
    return twiml(sag(s.texte.stoerung, s) + '<Hangup/>');
  }
  if (job.status === 'done') {
    jobs.delete(schluessel);
    const { ergebnis } = job;
    if (ergebnis.beendet) {
      anrufe.delete(CallSid);
      return twiml(sag(ergebnis.text, s) + '<Hangup/>');
    }
    return sagUndZuhoeren(ergebnis.text, basis, s);
  }

  // Noch nicht fertig: kurze Stille, dann erneut nachfragen (begrenzt).
  job.polls += 1;
  if (job.polls > MAX_POLLS) {
    jobs.delete(schluessel);
    return twiml(sag(s.texte.zuLange, s) + '<Hangup/>');
  }
  return twiml('<Pause length="2"/>' + wartenRedirect(basis));
}

/** Nur fuer Tests: Zustand eines Anrufs einsehen bzw. alles verwerfen. */
export function _anrufZustand(callSid) { return anrufe.get(callSid) ?? null; }
export function _anrufeLeeren() { anrufe.clear(); }
/** Nur fuer Tests: Hintergrund-Jobs einsehen, setzen und aufraeumen. */
export function _jobs() { return jobs; }
export function _jobsAufraeumen(jetzt) { jobsAufraeumen(jetzt); }
