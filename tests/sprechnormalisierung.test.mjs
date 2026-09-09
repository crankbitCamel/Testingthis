/**
 * Tests der Sprechnormalisierung: Jahreszahlen, Datumsangaben, Abkuerzungen
 * und Symbole muessen fuer die Vorlesestimme ausgeschrieben werden - ohne
 * Betraege und Zaehlwerte zu verfaelschen.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalisiereFuerSprache, zahlAlsWort } from '../server/sprechnormalisierung.mjs';

describe('Zahlwoerter', () => {
  test('Jahreszahlen und Grenzfaelle', () => {
    assert.equal(zahlAlsWort(2026), 'zweitausendsechsundzwanzig');
    assert.equal(zahlAlsWort(2000), 'zweitausend');
    assert.equal(zahlAlsWort(1999), 'eintausendneunhundertneunundneunzig');
    assert.equal(zahlAlsWort(2001), 'zweitausendeins');
    assert.equal(zahlAlsWort(2021), 'zweitausendeinundzwanzig');
    assert.equal(zahlAlsWort(1900), 'eintausendneunhundert');
    assert.equal(zahlAlsWort(100), 'einhundert');
    assert.equal(zahlAlsWort(17), 'siebzehn');
    assert.equal(zahlAlsWort(1), 'eins');
    assert.equal(zahlAlsWort(0), 'null');
  });
});

describe('Sprechnormalisierung', () => {
  test('Jahr-Monat und volles Datum werden ausgesprochen', () => {
    assert.equal(normalisiereFuerSprache('Stand 2026-08.'), 'Stand August zweitausendsechsundzwanzig.');
    assert.equal(normalisiereFuerSprache('Frist bis 2026-08-15.'), 'Frist bis 15. August zweitausendsechsundzwanzig.');
  });

  test('freie Jahreszahl wird Zahlwort, Betraege und Zaehlwerte bleiben', () => {
    assert.equal(normalisiereFuerSprache('Bestattungsgesetz 2025.'), 'Bestattungsgesetz zweitausendfünfundzwanzig.');
    // 14 Tage, 70,00 und 37,50 duerfen unangetastet bleiben.
    const t = normalisiereFuerSprache('spätestens 14 Tage; 70,00 Euro; 37,50 Euro');
    assert.match(t, /14 Tage/);
    assert.match(t, /70,00 Euro/);
    assert.match(t, /37,50 Euro/);
  });

  test('Abkuerzungen und Symbole werden ausgeschrieben', () => {
    assert.equal(normalisiereFuerSprache('z. B. ein Reisepass, z.B. bzw. ggf.'), 'zum Beispiel ein Reisepass, zum Beispiel beziehungsweise gegebenenfalls');
    assert.equal(normalisiereFuerSprache('§ 17 Bundesmeldegesetz'), 'Paragraf 17 Bundesmeldegesetz');
    assert.equal(normalisiereFuerSprache('Gebühr 70€ und 5%'), 'Gebühr 70 Euro und 5 Prozent');
    assert.equal(normalisiereFuerSprache('Nr. 3, Abs. 2'), 'Nummer 3, Absatz 2');
  });

  test('Schrift-Trenner aus dem Testmodus werden zu Satzpausen', () => {
    const t = normalisiereFuerSprache('Reisepass — Kosten. A: 70,00 Euro | B: 37,50 Euro');
    assert.ok(!t.includes('|') && !t.includes('—'));
    assert.match(t, /Reisepass, Kosten\. A: 70,00 Euro\. B: 37,50 Euro/);
  });

  test('Prompt-Beispiel aus dem System-Prompt wird sprechbar', () => {
    assert.equal(
      normalisiereFuerSprache('Stand 2026-08, § 17 Bundesmeldegesetz'),
      'Stand August zweitausendsechsundzwanzig, Paragraf 17 Bundesmeldegesetz',
    );
  });
});
