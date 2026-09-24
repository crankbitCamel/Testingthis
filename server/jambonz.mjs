/**
 * Jambonz-Adapter: uebersetzt Jambonz-Webhooks in die Gespraechslogik
 * (dialog.mjs) und zurueck in Jambonz-"Verbs" (JSON).
 *
 * Jambonz ist eine quelloffene Telefonanlage, die wir selbst auf einem
 * EU-Server betreiben. Sie haengt ueber einen SIP-Trunk (z. B. sipgate) am
 * Telefonnetz und ruft bei jedem Anruf und jeder Aeusserung unseren Server
 * per HTTP-POST (JSON) auf. Die Antwort ist ein JSON-Array von Verben -
 * dasselbe Muster wie Twilios TwiML, nur JSON statt XML:
 *
 *   say     Text vorlesen (Stimme/Anbieter frei waehlbar, auch eigene)
 *   gather  Zuhoeren: Sprache und/oder Tasten, Ergebnis an actionHook
 *   hangup  Auflegen
 *
 * Spracherkennung und Sprachausgabe laufen NICHT in Jambonz selbst, sondern
 * bei den dort eingetragenen Anbietern. Fuer die Souveraenitaet zaehlt, was
 * dort steht: 'custom:whisper' fuer unser eigenes Whisper (ueber Jambonz'
 * Custom-Speech-Schnittstelle), fuer die Stimme ElevenLabs oder ein eigener
 * Dienst. Dieser Adapter gibt nur Anbieter und Sprache an; die Zugangsdaten
 * liegen in Jambonz.
 *
 * Unterschiede zum Twilio-Adapter, die hier bewusst anders geloest sind:
 * - Kein Poll-Trick: Jambonz wartet auf den Webhook und kann waehrenddessen
 *   per actionHookDelayAction "einen Moment" sagen. Die Modellantwort wird
 *   deshalb direkt abgewartet (sofort: true).
 * - Barge-in mit Mindestwortzahl: ein Husten unterbricht die Ansage nicht,
 *   ein echter Satz schon (minBargeinWordCount).
 * - Konfidenz kommt strukturiert (speech.alternatives[0].confidence) und
 *   Jambonz meldet zu leise Erkennung selbst als 'stt-low-confidence'.
 *
 * Konfiguration (Umgebungsvariablen):
 *   JAMBONZ_STT_VENDOR      Erkenner, Standard 'custom:whisper'
 *   JAMBONZ_TTS_VENDOR      Stimme-Anbieter, Standard 'elevenlabs'
 *   JAMBONZ_STIMME_DE/EN    Stimmen-Kennung je Sprache (anbieterabhaengig)
 *   JAMBONZ_WEBHOOK_SECRET  optional: Signaturpruefung der Webhooks
 *   JAMBONZ_MIN_WOERTER     Barge-in erst ab so vielen Woertern, Standard 2
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  SPRACHEN, STANDARD_SPRACHE, sprachePer, zustandFuer, spracheWaehlen, einwilligungWaehlen,
  sprechfassung, aeusserungVerarbeiten, anrufBeenden, MIN_KONFIDENZ,
} from './dialog.mjs';

const STT_VENDOR = process.env.JAMBONZ_STT_VENDOR ?? 'custom:whisper';
const TTS_VENDOR = process.env.JAMBONZ_TTS_VENDOR ?? 'elevenlabs';
const MIN_WOERTER = Number(process.env.JAMBONZ_MIN_WOERTER ?? 2);
// Stimmen je Sprache. Bei ElevenLabs ist das die Voice-ID, bei AWS der
// Polly-Name, bei einem eigenen Dienst dessen Kennung.
const STIMMEN = {
  de: process.env.JAMBONZ_STIMME_DE ?? '',
  en: process.env.JAMBONZ_STIMME_EN ?? '',
};
// Ab dieser Wartezeit auf den Webhook sagt Jambonz von sich aus "einen
// Moment", damit der Anrufer nicht in Stille haengt.
const MOMENT_NACH_S = 1.5;

// ---------------------------------------------------------------- Verben --

function say(text, s = SPRACHEN[STANDARD_SPRACHE]) {
  const synthesizer = { vendor: TTS_VENDOR, language: s.code };
  if (STIMMEN[s === SPRACHEN.en ? 'en' : 'de']) synthesizer.voice = STIMMEN[s === SPRACHEN.en ? 'en' : 'de'];
  return { verb: 'say', text: sprechfassung(text, s), synthesizer };
}

const hangup = () => ({ verb: 'hangup' });

/** Zuhoeren auf Sprache (und Tasten als Rueckfallweg), Ergebnis an eingabe. */
function zuhoeren(text, basis, s) {
  return {
    verb: 'gather',
    input: ['speech', 'digits'],
    numDigits: 1,
    timeout: 8,
    actionHook: `${basis}/api/jambonz/eingabe`,
    bargein: true,
    minBargeinWordCount: MIN_WOERTER,
    dtmfBargein: true,
    say: say(text, s),
    recognizer: {
      vendor: STT_VENDOR,
      language: s.code,
      // Jambonz meldet Erkennung unter dieser Schwelle als 'stt-low-confidence'.
      minConfidence: MIN_KONFIDENZ,
    },
    // Dauert unsere Antwort (Modellaufruf) laenger, ueberbrueckt Jambonz.
    actionHookDelayAction: {
      actions: ['say'],
      say: say(s.texte.moment, s),
      noResponseTimeout: MOMENT_NACH_S,
      noResponseGiveUpTimeout: 30,
    },
  };
}

/** Tastenabfrage (Sprachmenue, Einwilligung). */
function tasten(text, basis, ziel, s) {
  return {
    verb: 'gather',
    input: ['digits'],
    numDigits: 1,
    timeout: 5,
    actionHook: `${basis}/api/jambonz/${ziel}`,
    dtmfBargein: true,
    say: say(text, s),
  };
}

const sagUndZuhoeren = (text, basis, s) => [zuhoeren(text, basis, s)];

/** Einen Schritt der Gespraechslogik in Verben uebersetzen. */
function schrittAlsVerben(schritt, basis, s) {
  switch (schritt.art) {
    case 'auflegen': return [say(schritt.text, s), hangup()];
    // Weiterleitung an Menschen: Ansage, dann waehlen. Nimmt niemand ab,
    // geht es nach dem dial mit dem naechsten Verb weiter (wieder zuhoeren).
    case 'verbinden': return [
      say(schritt.text, s),
      { verb: 'dial', timeLimit: 3600, timeout: 25, target: [{ type: 'phone', number: schritt.nummer }] },
      zuhoeren(s.texte.verbindenFehlgeschlagen, basis, s),
    ];
    case 'warten': return [say(schritt.text ?? s.texte.moment, s), { verb: 'redirect', actionHook: `${basis}/api/jambonz/eingabe` }];
    default: return sagUndZuhoeren(schritt.text, basis, s);
  }
}

// ------------------------------------------------------------- Webhooks --
// Jambonz liefert den Anruf als call_sid; die Sprach-/Tastenergebnisse
// haengen als speech / digits / reason am selben JSON.

const anrufId = (k) => k?.call_sid ?? 'ohne-sid';

/** Anrufbeginn: Sprachmenue (1 Deutsch, 2 Englisch). */
export function jambonzAnruf(k = {}, basis = '') {
  const id = anrufId(k);
  const z = zustandFuer(id);
  z.stumm = 0;
  console.log(`  jambonz anruf ${id} von=${k.from ?? '?'} an=${k.to ?? '?'}`);
  const de = SPRACHEN.de;
  const text = `${de.texte.menue} ${SPRACHEN.en.texte.menue}`;
  return [tasten(text, basis, 'sprache', de)];
}

/** Sprache aus der Taste, dann Einwilligungsfrage in dieser Sprache. */
export function jambonzSprache(k = {}, basis = '') {
  const z = spracheWaehlen(anrufId(k), k.digits);
  const s = sprachePer(z);
  return [tasten(s.texte.einwilligung, basis, 'einwilligung', s)];
}

/** Einwilligung aus der Taste (1 = ja), dann Begruessung. */
export function jambonzEinwilligung(k = {}, basis = '') {
  const z = einwilligungWaehlen(anrufId(k), k.digits);
  const s = sprachePer(z);
  return sagUndZuhoeren(s.texte.begruessung, basis, s);
}

/** Jede Aeusserung (actionHook des Zuhoerens). */
export async function jambonzEingabe(k = {}, basis = '') {
  const id = anrufId(k);
  const z = zustandFuer(id);
  const s = sprachePer(z);

  const alternative = k.speech?.alternatives?.[0];
  const text = alternative?.transcript ?? '';
  // 'stt-low-confidence' kommt von Jambonz selbst; wir behandeln es wie
  // Konfidenz null, damit die Sperre in dialog.mjs greift.
  const konfidenz = k.reason === 'stt-low-confidence' ? 0 : alternative?.confidence;
  const taste = k.digits;

  // Erkennerfehler (Whisper weg, Bruecke weg) sind keine Stille: nicht
  // "nichts gehoert" sagen, sondern die Stoerung benennen und beenden.
  if (k.reason === 'error') {
    console.warn(`  jambonz ${id} erkennerfehler: ${JSON.stringify(k.error ?? k.speech?.error ?? '')}`);
    anrufBeenden(id);
    return [say(s.texte.stoerung, s), hangup()];
  }

  // Stille, Wiederholungen, Tasten und Modellaufruf: alles in dialog.mjs,
  // damit beide Traeger identisch reagieren.
  const schritt = await aeusserungVerarbeiten({
    anrufId: id, text, konfidenz, taste, kanal: 'jambonz', sofort: true,
  });
  return schrittAlsVerben(schritt, basis, s);
}

/** Anrufstatus (optionaler zweiter Webhook): bei Ende aufraeumen. */
export function jambonzStatus(k = {}) {
  if (k.call_status === 'completed' || k.call_status === 'failed' || k.call_status === 'no-answer') {
    anrufBeenden(anrufId(k));
  }
  return [];
}

// ------------------------------------------------------------ Signatur --
/**
 * Prueft die Jambonz-Signatur eines Webhooks (Header "Jambonz-Signature",
 * Form "t=<Zeit>,v1=<hex HMAC-SHA256 ueber '<Zeit>.<Rohkoerper>'>").
 * Ohne konfiguriertes Geheimnis wird nicht geprueft (Rueckgabe true).
 * Auf dem Server gegen eine echte Jambonz-Installation verifizieren.
 */
export const SIGNATUR_FENSTER_S = 300;

export function signaturPruefen(kopf, rohkoerper, geheimnis = process.env.JAMBONZ_WEBHOOK_SECRET, jetztS = Math.floor(Date.now() / 1000)) {
  // Ohne Geheimnis nur, wenn das ausdruecklich gewollt ist (erster Test gegen
  // eine frische Installation) - sonst waere jeder POST an /api/jambonz gueltig.
  if (!geheimnis) return process.env.JAMBONZ_OHNE_SIGNATUR === '1';
  const header = String(kopf ?? '');
  const teile = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  if (!teile.t || !teile.v1) return false;
  // Zeitfenster gegen Wiederholung mitgeschnittener Webhooks.
  const t = Number(teile.t);
  if (!Number.isFinite(t) || Math.abs(jetztS - t) > SIGNATUR_FENSTER_S) return false;
  const erwartet = createHmac('sha256', geheimnis).update(`${teile.t}.${rohkoerper}`).digest('hex');
  const a = Buffer.from(erwartet);
  const b = Buffer.from(String(teile.v1));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Nur fuer Tests: Signatur erzeugen, wie Jambonz es taete. */
export function _signieren(rohkoerper, geheimnis, zeit = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', geheimnis).update(`${zeit}.${rohkoerper}`).digest('hex');
  return `t=${zeit},v1=${v1}`;
}
