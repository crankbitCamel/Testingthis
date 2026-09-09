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
