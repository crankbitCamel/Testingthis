/**
 * Tests des Jambonz-Adapters OHNE Telefonanlage: geprueft werden die
 * Uebersetzung der Gespraechsschritte in Jambonz-Verben, das Sprachmenue,
 * die Einwilligung, Stille, Konfidenz und die Webhook-Signatur.
 * Laeuft im Mock-Modus (kein Sprachmodell noetig).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  jambonzAnruf, jambonzSprache, jambonzEinwilligung, jambonzEingabe, jambonzStatus,
  signaturPruefen, _signieren,
} from '../server/jambonz.mjs';
import { _anrufZustand, _anrufeLeeren } from '../server/dialog.mjs';

const BASIS = 'https://verwaltung.example';
const sprache = (k) => ({ call_sid: 'JB1', speech: { alternatives: [{ transcript: k.text, confidence: k.konfidenz ?? 0.9 }] }, reason: 'speechDetected' });

describe('Jambonz: Anrufbeginn und Menues', () => {
  beforeEach(() => _anrufeLeeren());

  test('Anruf beginnt mit Tastenmenue, actionHook absolut', () => {
    const verben = jambonzAnruf({ call_sid: 'JB1', from: '+4930', to: '+4921' }, BASIS);
    assert.equal(verben.length, 1);
    const g = verben[0];
    assert.equal(g.verb, 'gather');
    assert.deepEqual(g.input, ['digits']);
    assert.equal(g.actionHook, `${BASIS}/api/jambonz/sprache`);
    assert.match(g.say.text, /Für Deutsch drücken Sie die Eins/);
    assert.match(g.say.text, /For English, press two/);
  });

  test('Taste 2 schaltet auf Englisch, Einwilligungsfrage englisch', () => {
    jambonzAnruf({ call_sid: 'JB1' }, BASIS);
    const verben = jambonzSprache({ call_sid: 'JB1', digits: '2', reason: 'dtmfDetected' }, BASIS);
    assert.equal(_anrufZustand('JB1').sprache, 'en');
    assert.equal(verben[0].actionHook, `${BASIS}/api/jambonz/einwilligung`);
    assert.match(verben[0].say.text, /written record/);
    assert.equal(verben[0].say.synthesizer.language, 'en-GB');
  });

  test('Einwilligung Taste 1 gesetzt, danach Begruessung mit Spracherkennung', () => {
    jambonzAnruf({ call_sid: 'JB1' }, BASIS);
    jambonzSprache({ call_sid: 'JB1', digits: '1' }, BASIS);
    const verben = jambonzEinwilligung({ call_sid: 'JB1', digits: '1' }, BASIS);
    assert.equal(_anrufZustand('JB1').einwilligung, true);
    const g = verben[0];
    assert.equal(g.verb, 'gather');
    assert.deepEqual(g.input, ['speech', 'digits']);
    assert.equal(g.actionHook, `${BASIS}/api/jambonz/eingabe`);
    assert.equal(g.recognizer.language, 'de-DE');
    assert.equal(g.bargein, true);
    assert.ok(g.minBargeinWordCount >= 2, 'Husten unterbricht nicht');
    assert.match(g.say.text, /Verwaltungsassistent/);
    assert.match(g.actionHookDelayAction.say.text, /Einen Moment/);
  });

  test('ohne Taste (timeout) keine Einwilligung', () => {
    jambonzAnruf({ call_sid: 'JB1' }, BASIS);
    jambonzSprache({ call_sid: 'JB1', reason: 'timeout' }, BASIS);
    jambonzEinwilligung({ call_sid: 'JB1', reason: 'timeout' }, BASIS);
    assert.equal(_anrufZustand('JB1').einwilligung, false);
    assert.equal(_anrufZustand('JB1').sprache, 'de');
  });
});

describe('Jambonz: Aeusserungen', () => {
  beforeEach(() => _anrufeLeeren());

  test('Frage wird beantwortet, Antwort in Sprechfassung, danach weiter zuhoeren', async () => {
    jambonzEinwilligung({ call_sid: 'JB1', digits: '2' }, BASIS);
    const verben = await jambonzEingabe(sprache({ text: 'Was kostet ein Reisepass?' }), BASIS);
    assert.equal(verben.length, 1);
    const g = verben[0];
    assert.equal(g.verb, 'gather');
    assert.match(g.say.text, /Reisepass|Euro/);
    assert.doesNotMatch(g.say.text, /\*\*/);
    assert.equal(_anrufZustand('JB1').verlauf.length, 2);
  });

  test('niedrige Konfidenz und stt-low-confidence fuehren zur Wiederholungsbitte', async () => {
    let verben = await jambonzEingabe(sprache({ text: 'Liebe', konfidenz: 0.05 }), BASIS);
    assert.match(verben[0].say.text, /bitte wiederholen/);
    verben = await jambonzEingabe({ call_sid: 'JB1', reason: 'stt-low-confidence', speech: { alternatives: [{ transcript: 'Hm', confidence: 0.8 }] } }, BASIS);
    assert.match(verben[0].say.text, /bitte wiederholen/);
    assert.equal(_anrufZustand('JB1').verlauf.length, 0);
  });

  test('Stille: erst Hinweis, beim zweiten Mal freundlich auflegen', async () => {
    let verben = await jambonzEingabe({ call_sid: 'JB1', reason: 'timeout' }, BASIS);
    assert.match(verben[0].say.text, /nichts gehört/);
    verben = await jambonzEingabe({ call_sid: 'JB1', reason: 'timeout' }, BASIS);
    assert.match(verben[0].text, /Vielen Dank/);
    assert.equal(verben[1].verb, 'hangup');
  });

  test('Tastendruck ohne Sprache bestaetigt den Rueckweg', async () => {
    const verben = await jambonzEingabe({ call_sid: 'JB1', digits: '5', reason: 'dtmfDetected' }, BASIS);
    assert.match(verben[0].say.text, /Tastendruck erkannt/);
  });

  test('Anrufende raeumt den Zustand auf', () => {
    jambonzAnruf({ call_sid: 'JB9' }, BASIS);
    assert.ok(_anrufZustand('JB9'));
    jambonzStatus({ call_sid: 'JB9', call_status: 'completed' });
    assert.equal(_anrufZustand('JB9'), null);
  });
});

describe('Jambonz: Webhook-Signatur', () => {
  test('ohne Geheimnis wird abgelehnt, ausser JAMBONZ_OHNE_SIGNATUR=1 ist gesetzt', () => {
    const vorher = process.env.JAMBONZ_OHNE_SIGNATUR;
    delete process.env.JAMBONZ_OHNE_SIGNATUR;
    assert.equal(signaturPruefen(undefined, '{}', ''), false);
    process.env.JAMBONZ_OHNE_SIGNATUR = '1';
    assert.equal(signaturPruefen(undefined, '{}', ''), true);
    if (vorher === undefined) delete process.env.JAMBONZ_OHNE_SIGNATUR; else process.env.JAMBONZ_OHNE_SIGNATUR = vorher;
  });

  test('gueltige Signatur wird akzeptiert, manipulierte und veraltete abgelehnt', () => {
    const koerper = JSON.stringify({ call_sid: 'JB1' });
    const zeit = 1700000000;
    const kopf = _signieren(koerper, 'geheim', zeit);
    assert.equal(signaturPruefen(kopf, koerper, 'geheim', zeit + 10), true);
    assert.equal(signaturPruefen(kopf, koerper + ' ', 'geheim', zeit + 10), false);
    assert.equal(signaturPruefen('t=1,v1=00', koerper, 'geheim', zeit), false);
    assert.equal(signaturPruefen(undefined, koerper, 'geheim', zeit), false);
    // Replay: dieselbe gueltige Signatur 10 Minuten spaeter
    assert.equal(signaturPruefen(kopf, koerper, 'geheim', zeit + 600), false);
  });
});
