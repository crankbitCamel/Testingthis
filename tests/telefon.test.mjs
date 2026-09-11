/**
 * Tests des Telefonie-Adapters - ohne Twilio und ohne API-Schluessel:
 * simulierte Webhook-Aufrufe muessen gueltiges TwiML mit der richtigen
 * Gespraechsfuehrung liefern (zuhoeren, antworten, auflegen).
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { anrufBeginn, anrufEingabe, xmlEscape, _anrufZustand, _anrufeLeeren } from '../server/telefon.mjs';
import { llmKonfiguriert, MOCK_VERWARNUNG } from '../server/assistent.mjs';

before(() => {
  if (!existsSync(new URL('../dist/chunks.jsonl', import.meta.url))) {
    execSync('node scripts/build-chunks.mjs', { cwd: new URL('..', import.meta.url) });
  }
});

beforeEach(() => _anrufeLeeren());

describe('TwiML-Grundlagen', () => {
  test('Anrufbeginn: gültiges TwiML, deutsche Spracherkennung, Begrüßung', () => {
    const t = anrufBeginn({ CallSid: 'CA1' });
    assert.ok(t.startsWith('<?xml version="1.0"'));
    assert.match(t, /<Gather input="[^"]*speech[^"]*" [^>]*language="de-DE"[^>]*action="\/api\/telefon\/eingabe"/);
    assert.match(t, /Verwaltungsassistent/);
    assert.match(t, /<Hangup\/>/); // Ende nach doppeltem Schweigen
  });

  test('xmlEscape entschärft Sonderzeichen', () => {
    assert.equal(xmlEscape('Kosten < 5 € & "mehr"'), 'Kosten &lt; 5 € &amp; &quot;mehr&quot;');
  });
});

describe('Gesprächsrunden am Telefon (Mock)', () => {
  test('Frage wird beantwortet und weiter zugehört', async (t) => {
    if (llmKonfiguriert()) return t.skip('API-Schlüssel gesetzt - Mock nicht aktiv');
    const antwort = await anrufEingabe({ CallSid: 'CA2', SpeechResult: 'Wie lange ist die Bestattungsfrist in Rheinland-Pfalz?' });
    assert.match(antwort, /<Say[^>]*>.*14 Tage/s);
    assert.match(antwort, /<Gather/); // Gespräch läuft weiter
    assert.ok(!antwort.includes('<Hangup/>') || antwort.indexOf('<Hangup/>') > antwort.indexOf('<Gather'));
  });

  test('Bundesland aus der Äußerung bleibt für den Anruf gesetzt', async (t) => {
    if (llmKonfiguriert()) return t.skip('API-Schlüssel gesetzt - Mock nicht aktiv');
    await anrufEingabe({ CallSid: 'CA3', SpeechResult: 'Ich wohne in Mainz und habe eine Frage zur Bestattungsfrist' });
    assert.equal(_anrufZustand('CA3').land, 'rp');
  });

  test('leere Erkennung führt zur Bitte um Wiederholung, nicht zum Auflegen', async () => {
    const antwort = await anrufEingabe({ CallSid: 'CA4', SpeechResult: '' });
    assert.match(antwort, /nicht verstanden/);
    assert.match(antwort, /<Gather/);
  });

  test('Quellen der letzten Antwort bleiben fuer Nachfragen im Anrufzustand', async () => {
    await anrufEingabe({ CallSid: 'CA4q', SpeechResult: 'Was kostet ein Reisepass?' });
    const z = _anrufZustand('CA4q');
    assert.ok(Array.isArray(z.letzteQuellen) && z.letzteQuellen.length > 0, 'Quellen gemerkt');
    assert.ok(z.letzteQuellen.length <= 8, 'auf acht begrenzt');
  });

  test('Erkennung mit Konfidenz nahe null (Husten) geht nicht ans Modell', async () => {
    // Twilio transkribiert Nebengeraeusche als "Wort" mit Confidence 0.
    const antwort = await anrufEingabe({ CallSid: 'CA4k', SpeechResult: 'Liebe', Confidence: '0.0' });
    assert.match(antwort, /bitte wiederholen Sie Ihre Frage/);
    assert.match(antwort, /<Gather/);
    assert.equal(_anrufZustand('CA4k').verlauf.length, 0, 'kein Verlaufseintrag');

    // Normale Konfidenz wird beantwortet.
    const echt = await anrufEingabe({ CallSid: 'CA4k', SpeechResult: 'Was kostet ein Reisepass?', Confidence: '0.91' });
    assert.doesNotMatch(echt, /bitte wiederholen Sie Ihre Frage/);
    assert.equal(_anrufZustand('CA4k').verlauf.length, 2);
  });

  test('Missbrauch: erst Verwarnung, beim zweiten Mal Auflegen', async (t) => {
    if (llmKonfiguriert()) return t.skip('API-Schlüssel gesetzt - Mock nicht aktiv');
    const erste = await anrufEingabe({ CallSid: 'CA5', SpeechResult: 'Du bist doch ein Idiot' });
    assert.ok(erste.includes(xmlEscape(MOCK_VERWARNUNG)));
    assert.match(erste, /<Gather/);
    const zweite = await anrufEingabe({ CallSid: 'CA5', SpeechResult: 'Halt die Klappe' });
    assert.match(zweite, /<Hangup\/>\s*<\/Response>/);
    assert.ok(!zweite.includes('<Gather'));
    assert.equal(_anrufZustand('CA5'), null); // Anrufzustand geräumt
  });

  test('getrennte Anrufe teilen keinen Verlauf', async (t) => {
    if (llmKonfiguriert()) return t.skip('API-Schlüssel gesetzt - Mock nicht aktiv');
    await anrufEingabe({ CallSid: 'CA6', SpeechResult: 'Du bist doch ein Idiot' });
    const anderer = await anrufEingabe({ CallSid: 'CA7', SpeechResult: 'Halt die Klappe' });
    // Für CA7 ist es der ERSTE Verstoß - Verwarnung, kein Auflegen.
    assert.ok(anderer.includes(xmlEscape(MOCK_VERWARNUNG)));
    assert.match(anderer, /<Gather/);
  });
});

describe('Hintergrund-Jobs (LLM-Modus)', () => {
  test('verwaiste Jobs verfallen nach der Frist, frische bleiben', async () => {
    const { _jobs, _jobsAufraeumen } = await import('../server/telefon.mjs');
    const jobs = _jobs();
    jobs.clear();
    const jetzt = Date.now();
    // Ein alter Job (Anrufer hat aufgelegt, nie abgeholt) und ein frischer.
    jobs.set('CA_alt', { status: 'done', ergebnis: { text: 'x' }, fehler: null, polls: 0, erstellt: jetzt - 11 * 60 * 1000 });
    jobs.set('CA_neu', { status: 'pending', ergebnis: null, fehler: null, polls: 0, erstellt: jetzt - 5 * 1000 });
    _jobsAufraeumen(jetzt);
    assert.equal(jobs.has('CA_alt'), false, 'alter Job muss verfallen');
    assert.equal(jobs.has('CA_neu'), true, 'frischer Job muss bleiben');
    jobs.clear();
  });
});

describe('Sprachwahl per Taste', () => {
  test('Anrufbeginn ist ein Tastenmenue mit deutschem Rueckfall', async () => {
    const { sprachwahl } = await import('../server/telefon.mjs');
    const t = sprachwahl({ CallSid: 'CA_S1' }, 'https://x.example');
    assert.match(t, /<Gather input="dtmf" numDigits="1"[^>]*action="https:\/\/x\.example\/api\/telefon\/sprache"/);
    assert.match(t, /drücken Sie die Eins/);
    assert.match(t, /press two/);
    // Ohne Taste: deutsche Begruessung mit deutscher Erkennung.
    assert.match(t, /language="de-DE"[^>]*action="[^"]*\/api\/telefon\/eingabe"/);
    assert.match(t, /Verwaltungsassistent/);
  });

  test('Taste 2 schaltet den Anruf komplett auf Englisch', async () => {
    const t = anrufBeginn({ CallSid: 'CA_S2', Digits: '2' });
    assert.equal(_anrufZustand('CA_S2').sprache, 'en');
    assert.match(t, /<Say voice="Polly\.Amy-Neural" language="en-GB">/);
    assert.match(t, /public services assistant/);
    assert.match(t, /<Gather input="[^"]*speech[^"]*" [^>]*language="en-GB"/);
    assert.ok(!t.includes('de-DE'), 'kein deutsches Element mehr');
    // Folgerunden bleiben englisch: leere Erkennung -> englische Rueckfrage.
    const leer = await anrufEingabe({ CallSid: 'CA_S2', SpeechResult: '' });
    assert.match(leer, /didn&apos;t catch that|didn't catch that/);
    assert.match(leer, /language="en-GB"/);
  });

  test('Taste 1 oder unbekannte Taste bleibt Deutsch', () => {
    anrufBeginn({ CallSid: 'CA_S3', Digits: '1' });
    assert.equal(_anrufZustand('CA_S3').sprache, 'de');
    anrufBeginn({ CallSid: 'CA_S4', Digits: '9' });
    assert.equal(_anrufZustand('CA_S4').sprache, 'de');
  });

  test('deutsche Sprechnormalisierung gilt nur fuer Deutsch', async () => {
    const { SPRACHEN } = await import('../server/telefon.mjs');
    assert.equal(SPRACHEN.de.normalisieren, true);
    assert.equal(SPRACHEN.en.normalisieren, false);
  });
});

describe('Einwilligung zur Protokollierung (Opt-in)', () => {
  test('nach der Sprachwahl kommt die Einwilligungsfrage in dieser Sprache', async () => {
    const { sprachSetzen } = await import('../server/telefon.mjs');
    const de = sprachSetzen({ CallSid: 'CA_W1', Digits: '1' }, 'https://x.example');
    assert.match(de, /<Gather input="dtmf" numDigits="1"[^>]*action="https:\/\/x\.example\/api\/telefon\/einwilligung"/);
    assert.match(de, /schriftlich protokollieren/);
    assert.match(de, /Drücken Sie die Eins, wenn Sie zustimmen/);
    // Ohne Taste: keine Einwilligung, aber die Begruessung folgt trotzdem.
    assert.match(de, /Verwaltungsassistent/);
    assert.equal(_anrufZustand('CA_W1').einwilligung, false);

    const en = sprachSetzen({ CallSid: 'CA_W2', Digits: '2' }, 'https://x.example');
    assert.match(en, /written record of this conversation/);
    assert.match(en, /language="en-GB"/);
  });

  test('Taste 1 gibt die Einwilligung, Taste 2 oder nichts verweigert sie', async () => {
    const { einwilligungSetzen } = await import('../server/telefon.mjs');
    const ja = einwilligungSetzen({ CallSid: 'CA_W3', Digits: '1' });
    assert.equal(_anrufZustand('CA_W3').einwilligung, true);
    assert.match(ja, /Verwaltungsassistent/); // danach direkt die Begruessung
    einwilligungSetzen({ CallSid: 'CA_W4', Digits: '2' });
    assert.equal(_anrufZustand('CA_W4').einwilligung, false);
    einwilligungSetzen({ CallSid: 'CA_W5' });
    assert.equal(_anrufZustand('CA_W5').einwilligung, false);
  });

  test('ohne Einwilligung laeuft das Gespraech normal weiter', async (t) => {
    if (llmKonfiguriert()) return t.skip('API-Schlüssel gesetzt - Mock nicht aktiv');
    const { einwilligungSetzen } = await import('../server/telefon.mjs');
    einwilligungSetzen({ CallSid: 'CA_W6', Digits: '2' });
    const antwort = await anrufEingabe({ CallSid: 'CA_W6', SpeechResult: 'Wie lange ist die Bestattungsfrist in Rheinland-Pfalz?' });
    assert.match(antwort, /14 Tage/); // Antwort kommt, nur ohne Log-Eintrag
    assert.equal(_anrufZustand('CA_W6').einwilligung, false);
  });
});
