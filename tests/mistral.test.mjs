/**
 * Tests des Mistral-Anbieters OHNE Netzwerk: geprueft werden die
 * Werkzeug-Uebersetzung (Anthropic-Form -> Mistrals Function-Form) und die
 * Anbieterwahl. Ein echter Modellaufruf braucht einen MISTRAL_API_KEY und
 * wird hier bewusst nicht ausgeloest.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { alsMistralWerkzeuge } from '../server/mistral.mjs';
import { WERKZEUGE, anbieter, mistralKonfiguriert, llmKonfiguriert } from '../server/assistent.mjs';

describe('Mistral-Anbieter', () => {
  test('Werkzeuge werden vollstaendig in Mistrals Function-Form uebersetzt', () => {
    const m = alsMistralWerkzeuge();
    assert.equal(m.length, WERKZEUGE.length);
    for (const [i, w] of m.entries()) {
      assert.equal(w.type, 'function');
      assert.equal(w.function.name, WERKZEUGE[i].name);
      assert.equal(w.function.description, WERKZEUGE[i].description);
      // Das Parameter-Schema wird 1:1 aus input_schema uebernommen.
      assert.deepEqual(w.function.parameters, WERKZEUGE[i].input_schema);
    }
    // Die vier Kernwerkzeuge muessen vorhanden sein.
    const namen = m.map((w) => w.function.name);
    for (const n of ['wissen_suchen', 'leistung_auskunft', 'rechtsebene_pruefen', 'gespraech_beenden']) {
      assert.ok(namen.includes(n), `Werkzeug ${n} fehlt`);
    }
  });

  test('Anbieterwahl ohne Schluessel: mistralKonfiguriert=false, Standard anthropic', () => {
    // Tests laufen ohne MISTRAL_API_KEY und ohne ASSISTENT_PROVIDER.
    assert.equal(mistralKonfiguriert(), false);
    assert.equal(anbieter(), 'anthropic');
    // Ohne jeglichen Schluessel ist gar kein LLM konfiguriert -> Mock.
    assert.equal(llmKonfiguriert(), false);
  });
});
