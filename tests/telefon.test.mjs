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
