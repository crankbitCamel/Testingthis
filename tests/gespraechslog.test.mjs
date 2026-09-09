/**
 * Tests des Gespraechsprotokolls OHNE Datenbank: Der Assistent muss auch dann
 * einwandfrei laufen, wenn keine DATABASE_URL gesetzt ist. Das Log ist dann
 * inaktiv und protokolliere() ein folgenloser No-op - es darf nie werfen.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { protokollAktiv, protokolliere } from '../server/gespraechslog.mjs';

describe('Gespraechsprotokoll ohne Datenbank', () => {
  test('protokollAktiv ist false ohne DATABASE_URL', () => {
    // Die Tests laufen ohne gesetzte DATABASE_URL/NEON_DATABASE_URL.
    assert.equal(protokollAktiv(), false);
  });

  test('protokolliere ist ein folgenloser No-op und wirft nicht', async () => {
    await assert.doesNotReject(protokolliere({
      callSid: 'CA1', kanal: 'telefon', frage: 'Test?', antwort: 'Antwort.',
      quellen: [{ id: 'x' }], werkzeuge: [], dauerMs: 12, confidence: 0.9,
    }));
    // Auch mit leerem Eintrag darf nichts passieren.
    await assert.doesNotReject(protokolliere());
  });
});
