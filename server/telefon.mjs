/**
 * Twilio-Adapter: uebersetzt Twilio-Voice-Webhooks in die Gespraechslogik
 * (dialog.mjs) und zurueck in TwiML.
 *
 * Funktionsweise: Bei jedem Anruf (und nach jeder Aeusserung des Anrufers)
 * ruft Twilio unseren Server per HTTP-POST auf und erwartet als Antwort
 * TwiML - ein kleines XML, das beschreibt, was der Anrufer als Naechstes
 * hoert. Spracherkennung (<Gather input="speech">) und Sprachausgabe
 * (<Say> mit Neural-Stimme) bringt Twilio mit; unsere Aufgabe ist nur,
 * Text hereinzunehmen und Text zurueckzugeben.
 *
 * Alle Gespraechsregeln (Sprachen, Sprachwahl, Einwilligung, Konfidenz-
 * Sperre, Modellaufruf, Verlauf, Protokoll) liegen in dialog.mjs und sind
 * fuer jeden Traeger gleich. Diese Datei kennt nur Twilio: Formularfelder
 * herein, TwiML hinaus, plus den Poll-Trick fuer Twilios 15-Sekunden-Frist.
 *
 * Bewusst rundenbasiert statt Audio-Streaming: einfacher, robust, und fuer
 * Auskunftsdialoge voellig ausreichend.
 */
import {
  SPRACHEN, STANDARD_SPRACHE, sprachePer, zustandFuer, spracheWaehlen, einwilligungWaehlen,
  sprechfassung, aeusserungVerarbeiten, antwortAbholen,
  _anrufZustand, _anrufeLeeren, _jobs, _jobsAufraeumen,
} from './dialog.mjs';

export { SPRACHEN, _anrufZustand, _anrufeLeeren, _jobs, _jobsAufraeumen };

export function xmlEscape(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const twiml = (inhalt) => `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inhalt}</Response>`;

// <Say> in der Stimme der gewaehlten Sprache, Text in Sprechfassung.
function sag(text, s = SPRACHEN[STANDARD_SPRACHE]) {
  return `<Say voice="${s.stimme}" language="${s.code}">${xmlEscape(sprechfassung(text, s))}</Say>`;
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

// Der LLM-Aufruf dauert einige Sekunden. Wuerde der Server so lange warten,
// bevor er Twilio antwortet, bricht der Anruf ab - Twilio und der Tunnel
// halten eine einzelne Verbindung nicht ~15 s offen. Deshalb: sofort mit
// "Einen Moment" antworten, im Hintergrund rechnen und per <Redirect> so
// lange nachfragen, bis die Antwort bereitliegt.
const wartenRedirect = (basis = '') =>
  `<Redirect method="POST">${basis}/api/telefon/warten</Redirect>`;

/** Einen Schritt der Gespraechslogik in TwiML uebersetzen. */
function schrittAlsTwiml(schritt, basis, s) {
  switch (schritt.art) {
    case 'auflegen': return twiml(sag(schritt.text, s) + '<Hangup/>');
    case 'warten': return schritt.text
      ? twiml(sag(schritt.text, s) + wartenRedirect(basis))
      : twiml('<Pause length="2"/>' + wartenRedirect(basis));
    default: return sagUndZuhoeren(schritt.text, basis, s);
  }
}

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
  const z = spracheWaehlen(CallSid ?? 'ohne-sid', Digits);
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
  const z = einwilligungWaehlen(CallSid ?? 'ohne-sid', Digits);
  const s = sprachePer(z);
  return sagUndZuhoeren(s.texte.begruessung, basis, s);
}

/**
 * Begruessung in der gewaehlten Sprache. Kommt Digits mit, wird die Sprache
 * gesetzt; ohne Digits bleibt die bisherige (bzw. die Standardsprache). Als
 * direkter Anrufbeginn ohne Menues nutzbar (Tests, einfache Konfigurationen).
 */
export function anrufBeginn({ CallSid, Digits } = {}, basis = '') {
  const z = spracheWaehlen(CallSid ?? 'ohne-sid', Digits);
  const s = sprachePer(z);
  return sagUndZuhoeren(s.texte.begruessung, basis, s);
}

/** TwiML fuer jede erkannte Aeusserung (action des Gather). */
export async function anrufEingabe({ CallSid, SpeechResult, Digits, Confidence } = {}, basis = '') {
  const anrufId = CallSid ?? 'ohne-sid';
  const s = sprachePer(zustandFuer(anrufId));
  const schritt = await aeusserungVerarbeiten({
    anrufId, text: SpeechResult, konfidenz: Confidence, taste: Digits, kanal: 'telefon',
  });
  return schrittAlsTwiml(schritt, basis, s);
}

/**
 * Poll-Endpunkt: Twilio kehrt per <Redirect> hierher zurueck, bis die im
 * Hintergrund berechnete Antwort bereitliegt. Jede Antwort kommt sofort,
 * sodass nie eine Zeitueberschreitung entsteht.
 */
export async function anrufWarten({ CallSid } = {}, basis = '') {
  const anrufId = CallSid ?? 'ohne-sid';
  const s = sprachePer(_anrufZustand(anrufId));
  return schrittAlsTwiml(antwortAbholen(anrufId), basis, s);
}
