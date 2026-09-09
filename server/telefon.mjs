/**
 * Telefonie-Adapter: uebersetzt Twilio-Voice-Anrufe in die Gespraechslogik.
 *
 * Funktionsweise: Bei jedem Anruf (und nach jeder Aeusserung des Anrufers)
 * ruft Twilio unseren Server per HTTP-POST auf und erwartet als Antwort
 * TwiML - ein kleines XML, das beschreibt, was der Anrufer als Naechstes
 * hoert. Spracherkennung (<Gather input="speech">) und Sprachausgabe
 * (<Say> mit deutscher Neural-Stimme) bringt Twilio mit; unsere Aufgabe
 * ist nur, Text hereinzunehmen und Text zurueckzugeben. Dadurch bedient
 * exakt dieselbe Gespraechslogik (gespraechsschritt mit Bewertung,
 * Rueckfragen und Auflegen), die auch der Browser nutzt, eine echte
 * Telefonnummer.
 *
 * Bewusst rundenbasiert statt Audio-Streaming: einfacher, robust, und fuer
 * Auskunftsdialoge voellig ausreichend. Ein spaeterer Umbau auf Twilio
 * Media Streams (fuer Barge-in und geringere Latenz) ersetzt nur diese
 * Datei, nicht die Gespraechslogik.
 */
import { gespraechsschritt, llmKonfiguriert } from './assistent.mjs';
import { erkenneLand } from '../src/nlu.js';
import { protokolliere } from './gespraechslog.mjs';

const STIMME = process.env.TELEFON_STIMME ?? 'Polly.Vicki-Neural';
const SPRACHE = 'de-DE';

const BEGRUESSUNG = 'Guten Tag, hier ist der digitale Verwaltungsassistent. '
  + 'Schildern Sie Ihr Anliegen einfach in eigenen Worten - zum Beispiel: '
  + 'Ich bin umgezogen. Oder: Was kostet ein Reisepass?';

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
    z = { verlauf: [], land: null, schweigen: 0, zuletzt: jetzt };
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
const sag = (text) => `<Say voice="${STIMME}" language="${SPRACHE}">${xmlEscape(text)}</Say>`;

/**
 * Zuhoer-Parameter fuer <Gather>:
 * - input="speech dtmf": neben Sprache auch Tastendruck annehmen. Das dient
 *   als Diagnose (ein Tastendruck beweist, dass der Rueckruf zum Server geht)
 *   und als Rueckfallweg, falls die Spracherkennung nichts liefert.
 * - speechModel="phone_call" + enhanced="true": auf Telefonqualitaet trainiert,
 *   deutlich zuverlaessiger als das Standardmodell.
 * - timeout="8": bis zu 8 s auf den Sprechbeginn warten.
 * - speechTimeout="auto": Ende der Aeusserung automatisch erkennen.
 * - actionOnEmptyResult="true": den Server auch bei leerer Erkennung aufrufen,
 *   damit der Anruf nie stumm im TwiML weiterlaeuft.
 */
/**
 * Gather-Attribute. Die action-Adresse wird als VOLLSTAENDIGE URL ausgegeben,
 * wenn die oeffentliche Basis (Protokoll + Host, aus den Request-Headern)
 * bekannt ist. Grund: Bei per REST-API gestarteten Anrufen loest Twilio eine
 * relative action-Adresse nicht zuverlaessig zum Tunnel-Host auf - der erste
 * Webhook (mit voller Url) kommt an, der zweite (relativ) laeuft ins Leere.
 * Ohne Basis (lokale Tests) bleibt die Adresse relativ.
 */
const zuhoerAttrs = (basis = '') =>
  `input="speech dtmf" numDigits="1" language="${SPRACHE}" speechModel="phone_call" enhanced="true" timeout="8" speechTimeout="auto" actionOnEmptyResult="true" action="${basis}/api/telefon/eingabe" method="POST"`;

/**
 * Sprich den Text und hoere danach zu. Antwortet der Anrufer nicht, laeuft
 * das TwiML hinter dem Gather weiter: ein Hinweis, zweite Chance, dann Ende.
 */
function sagUndZuhoeren(text, basis = '') {
  const attrs = zuhoerAttrs(basis);
  return twiml(
    `<Gather ${attrs}>${sag(text)}</Gather>`
    + sag('Ich habe nichts gehört. Sagen Sie Ihr Anliegen bitte noch einmal - oder legen Sie einfach auf.')
    + `<Gather ${attrs}/>`
    + sag('Vielen Dank für Ihren Anruf. Auf Wiederhören.')
    + '<Hangup/>',
  );
}

// --- Hintergrund-Antworten (LLM) -------------------------------------------
// Der LLM-Aufruf dauert einige Sekunden. Wuerde der Server so lange warten,
// bevor er Twilio antwortet, bricht der Anruf ab - Twilio und der Tunnel
// halten eine einzelne Verbindung nicht ~15 s offen. Deshalb: sofort mit
// "Einen Moment" antworten, im Hintergrund rechnen und per <Redirect> so
// lange nachfragen, bis die Antwort bereitliegt. Jede einzelne Antwort ist
// dadurch sofort da, ein Timeout kann nicht mehr entstehen.
const jobs = new Map(); // CallSid -> { status, ergebnis, fehler, polls }
const MAX_POLLS = 12;   // bis zu ~12 * 2 s = 24 s Rechenzeit

const wartenRedirect = (basis = '') =>
  `<Redirect method="POST">${basis}/api/telefon/warten</Redirect>`;

/** TwiML fuer den Anrufbeginn (Twilio-Webhook "A call comes in"). */
export function anrufBeginn({ CallSid } = {}, basis = '') {
  if (CallSid) zustandFuer(CallSid); // Zustand anlegen, Verlauf beginnt leer
  return sagUndZuhoeren(BEGRUESSUNG, basis);
}

/** TwiML fuer jede erkannte Aeusserung (action des Gather). */
export async function anrufEingabe({ CallSid, SpeechResult, Digits, Confidence } = {}, basis = '') {
  const z = zustandFuer(CallSid ?? 'ohne-sid');
  const gesagt = (SpeechResult ?? '').trim();

  // Diagnose-/Sichtbarkeitszeile: zeigt im Server-Fenster, was Twilio liefert.
  if (SpeechResult !== undefined || Digits !== undefined) {
    console.log(`  eingabe CallSid=${CallSid} Digits=${Digits ?? ''} Confidence=${Confidence ?? ''} SpeechResult=${JSON.stringify(gesagt)}`);
  }

  // Tastendruck ohne erkannte Sprache: bestaetigt hoerbar, dass der Rueckweg
  // Twilio -> Server funktioniert. Danach zeigt sich, ob nur die Sprach-
  // erkennung das Problem ist.
  if (!gesagt && Digits) {
    return sagUndZuhoeren('Tastendruck erkannt. Der Rückruf zum Server funktioniert. Stellen Sie jetzt bitte Ihre Frage in eigenen Worten.', basis);
  }

  if (!gesagt) {
    return sagUndZuhoeren('Entschuldigung, das habe ich nicht verstanden. Sagen Sie es bitte noch einmal.', basis);
  }

  // Nennt der Anrufer sein Bundesland oder eine bekannte Stadt, bleibt das
  // fuer den Rest des Anrufs gesetzt - wie im Browser-Dialog.
  const landTreffer = erkenneLand(gesagt);
  if (landTreffer) z.land = landTreffer.code;

  const sicher = Number.parseFloat(Confidence);
  const beginn = Date.now();

  // Mock-Modus: schnell und synchron - kein Timeout-Risiko, deckt die Tests ab.
  if (!llmKonfiguriert()) {
    let ergebnis;
    try {
      ergebnis = await gespraechsschritt({ nachricht: gesagt, verlauf: z.verlauf, land: z.land });
    } catch (fehler) {
      return twiml(
        sag('Entschuldigung, es gab gerade eine technische Störung. Bitte versuchen Sie es in einem Moment erneut. Auf Wiederhören.')
        + '<Hangup/>',
      );
    }
    z.verlauf.push({ rolle: 'nutzer', text: gesagt }, { rolle: 'bot', text: ergebnis.text });
    if (z.verlauf.length > 24) z.verlauf = z.verlauf.slice(-24);
    protokolliere({
      callSid: CallSid, kanal: 'telefon', land: z.land, frage: gesagt,
      antwort: ergebnis.text, modus: ergebnis.modus, modell: ergebnis.modell,
      confidence: sicher, quellen: ergebnis.quellen, werkzeuge: ergebnis.werkzeuge,
      dauerMs: Date.now() - beginn, beendet: Boolean(ergebnis.beendet),
    });
    if (ergebnis.beendet) {
      anrufe.delete(CallSid);
      return twiml(sag(ergebnis.text) + '<Hangup/>');
    }
    return sagUndZuhoeren(ergebnis.text, basis);
  }

  // LLM-Modus: Antwort im Hintergrund berechnen, Twilio sofort vertroesten.
  const schluessel = CallSid ?? 'ohne-sid';
  const job = { status: 'pending', ergebnis: null, fehler: null, polls: 0 };
  jobs.set(schluessel, job);
  gespraechsschritt({ nachricht: gesagt, verlauf: z.verlauf, land: z.land })
    .then((ergebnis) => {
      job.ergebnis = ergebnis;
      job.status = 'done';
      z.verlauf.push({ rolle: 'nutzer', text: gesagt }, { rolle: 'bot', text: ergebnis.text });
      if (z.verlauf.length > 24) z.verlauf = z.verlauf.slice(-24);
      protokolliere({
        callSid: CallSid, kanal: 'telefon', land: z.land, frage: gesagt,
        antwort: ergebnis.text, modus: ergebnis.modus, modell: ergebnis.modell,
        confidence: sicher, quellen: ergebnis.quellen, werkzeuge: ergebnis.werkzeuge,
        dauerMs: Date.now() - beginn, beendet: Boolean(ergebnis.beendet),
      });
    })
    .catch((fehler) => { job.fehler = fehler; job.status = 'error'; });

  return twiml(sag('Einen Moment, ich schaue das für Sie nach.') + wartenRedirect(basis));
}

/**
 * Poll-Endpunkt: Twilio kehrt per <Redirect> hierher zurueck, bis die im
 * Hintergrund berechnete Antwort bereitliegt. Jede Antwort kommt sofort,
 * sodass nie eine Zeitueberschreitung entsteht.
 */
export async function anrufWarten({ CallSid } = {}, basis = '') {
  const schluessel = CallSid ?? 'ohne-sid';
  const job = jobs.get(schluessel);

  if (!job) {
    // Kein laufender Job (etwa nach Server-Neustart): einfach weiter zuhoeren.
    return sagUndZuhoeren('Entschuldigung, bitte wiederholen Sie Ihre Frage.', basis);
  }
  if (job.status === 'error') {
    jobs.delete(schluessel);
    return twiml(sag('Entschuldigung, es gab gerade eine technische Störung. Bitte versuchen Sie es in einem Moment erneut. Auf Wiederhören.') + '<Hangup/>');
  }
  if (job.status === 'done') {
    jobs.delete(schluessel);
    const { ergebnis } = job;
    if (ergebnis.beendet) {
      anrufe.delete(CallSid);
      return twiml(sag(ergebnis.text) + '<Hangup/>');
    }
    return sagUndZuhoeren(ergebnis.text, basis);
  }

  // Noch nicht fertig: kurze Stille, dann erneut nachfragen (begrenzt).
  job.polls += 1;
  if (job.polls > MAX_POLLS) {
    jobs.delete(schluessel);
    return twiml(sag('Das dauert diesmal leider zu lange. Bitte versuchen Sie es erneut. Auf Wiederhören.') + '<Hangup/>');
  }
  return twiml('<Pause length="2"/>' + wartenRedirect(basis));
}

/** Nur fuer Tests: Zustand eines Anrufs einsehen bzw. alles verwerfen. */
export function _anrufZustand(callSid) { return anrufe.get(callSid) ?? null; }
export function _anrufeLeeren() { anrufe.clear(); }
