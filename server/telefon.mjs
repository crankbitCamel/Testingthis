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
import { gespraechsschritt } from './assistent.mjs';
import { erkenneLand } from '../src/nlu.js';

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
 * Sprich den Text und hoere danach zu. Antwortet der Anrufer nicht, laeuft
 * das TwiML hinter dem Gather weiter: ein Hinweis, zweite Chance, dann Ende.
 */
function sagUndZuhoeren(text) {
  return twiml(
    `<Gather input="speech" language="${SPRACHE}" speechTimeout="auto" action="/api/telefon/eingabe" method="POST">${sag(text)}</Gather>`
    + sag('Ich habe nichts gehört. Sagen Sie Ihr Anliegen bitte noch einmal - oder legen Sie einfach auf.')
    + `<Gather input="speech" language="${SPRACHE}" speechTimeout="auto" action="/api/telefon/eingabe" method="POST"/>`
    + sag('Vielen Dank für Ihren Anruf. Auf Wiederhören.')
    + '<Hangup/>',
  );
}

/** TwiML fuer den Anrufbeginn (Twilio-Webhook "A call comes in"). */
export function anrufBeginn({ CallSid } = {}) {
  if (CallSid) zustandFuer(CallSid); // Zustand anlegen, Verlauf beginnt leer
  return sagUndZuhoeren(BEGRUESSUNG);
}

/** TwiML fuer jede erkannte Aeusserung (action des Gather). */
export async function anrufEingabe({ CallSid, SpeechResult } = {}) {
  const z = zustandFuer(CallSid ?? 'ohne-sid');
  const gesagt = (SpeechResult ?? '').trim();
  if (!gesagt) {
    return sagUndZuhoeren('Entschuldigung, das habe ich nicht verstanden. Sagen Sie es bitte noch einmal.');
  }

  // Nennt der Anrufer sein Bundesland oder eine bekannte Stadt, bleibt das
  // fuer den Rest des Anrufs gesetzt - wie im Browser-Dialog.
  const landTreffer = erkenneLand(gesagt);
  if (landTreffer) z.land = landTreffer.code;

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

  // Auflegen: die Interaktionsschleife hat das Gespraech beendet
  // (Verabschiedung oder Missbrauch nach Verwarnung).
  if (ergebnis.beendet) {
    anrufe.delete(CallSid);
    return twiml(sag(ergebnis.text) + '<Hangup/>');
  }

  return sagUndZuhoeren(ergebnis.text);
}

/** Nur fuer Tests: Zustand eines Anrufs einsehen bzw. alles verwerfen. */
export function _anrufZustand(callSid) { return anrufe.get(callSid) ?? null; }
export function _anrufeLeeren() { anrufe.clear(); }
