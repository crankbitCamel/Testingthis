/**
 * Tests der LLM-RAG-Schicht - ohne API-Schluessel gegen den Mock-Modus und
 * die Werkzeuge selbst. Die Werkzeuge sind der Vertrag zwischen Modell und
 * Wissensbasis; sie muessen unabhaengig vom Modell korrekt sein.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ladeIndex } from '../server/retrieval.mjs';
import { gespraechsschritt, werkzeugAusfuehren, llmKonfiguriert, WERKZEUGE } from '../server/assistent.mjs';

before(() => {
  if (!existsSync(new URL('../dist/chunks.jsonl', import.meta.url))) {
    execSync('node scripts/build-chunks.mjs', { cwd: new URL('..', import.meta.url) });
  }
});

describe('Retrieval (BM25 + Metadatenfilter)', () => {
  test('findet die richtige Detailauskunft', async () => {
    const index = await ladeIndex();
    const treffer = index.suche('welche unterlagen brauche ich für den reisepass');
    assert.ok(treffer[0].chunk.id.startsWith('leistung:reisepass:'), treffer[0].chunk.id);
  });

  test('Landesfilter hebt den Landeschunk über die Bundesspanne', async () => {
    const index = await ladeIndex();
    const rp = index.suche('bestattungsfrist', { filter: { land: 'rp' }, topK: 1 });
    assert.equal(rp[0].chunk.id, 'regional:rp:leistung:sterbefall');
    const nw = index.suche('bestattungsfrist wie schnell beerdigen', { filter: { land: 'nw' }, topK: 3 });
    assert.ok(nw.some((t) => t.chunk.id === 'regional:nw:leistung:sterbefall'));
  });

  test('Landesfilter schließt das jeweils andere Land aus', async () => {
    const index = await ladeIndex();
    const treffer = index.suche('kirchenaustritt zuständigkeit', { filter: { land: 'nw' }, topK: 8 });
    assert.ok(!treffer.some((t) => t.chunk.meta.land === 'rp'));
  });

  test('jeder Chunk trägt Stand und Ebene', async () => {
    const index = await ladeIndex();
    for (const c of index.chunks) {
      assert.ok(c.meta.ebene, `${c.id}: ebene fehlt`);
      assert.ok(c.meta.stand, `${c.id}: stand fehlt`);
      assert.ok(c.text.length > 40, `${c.id}: Text zu kurz`);
    }
  });
});

describe('Werkzeuge (Vertrag Modell <-> Wissensbasis)', () => {
  test('alle Werkzeugschemata sind strikt beschrieben', () => {
    for (const w of WERKZEUGE) {
      assert.ok(w.description.length > 60, `${w.name}: Beschreibung zu knapp für sinnvolle Werkzeugwahl`);
      assert.equal(w.input_schema.additionalProperties, false, w.name);
      assert.ok(w.input_schema.required?.length, w.name);
    }
  });

  test('rechtsebene_pruefen liefert die Ortsfrage-Entscheidung', async () => {
    const bund = await werkzeugAusfuehren('rechtsebene_pruefen', { leistung: 'personalausweis', aspekt: 'kosten' });
    assert.equal(bund.ebene, 'bund');
    assert.equal(bund.ortsabhaengig, false);
    const kommune = await werkzeugAusfuehren('rechtsebene_pruefen', { leistung: 'hundesteuer', aspekt: 'kosten' });
    assert.equal(kommune.ebene, 'kommune');
    assert.equal(kommune.ortsabhaengig, true);
    assert.deepEqual(kommune.hinterlegteLaender, ['nw', 'rp']);
  });

  test('leistung_auskunft liefert Regionaldaten bei gesetztem Land', async () => {
    const nw = await werkzeugAusfuehren('leistung_auskunft', { leistung: 'kirchenaustritt', aspekt: 'zustaendigkeit', land: 'nw' });
    assert.match(nw.regional.zustaendigkeit.stelle, /Amtsgericht/);
    const ohne = await werkzeugAusfuehren('leistung_auskunft', { leistung: 'kirchenaustritt', aspekt: 'zustaendigkeit' });
    assert.equal(ohne.regional, null);
  });

  test('anliegen_klassifizieren erkennt Leistung und Ort im selben Satz', async () => {
    const e = await werkzeugAusfuehren('anliegen_klassifizieren', { text: 'Was kostet die Hundesteuer in Mainz' });
    assert.equal(e.leistungTreffer[0].id, 'hundesteuer');
    assert.equal(e.landImText, 'rp');
  });

  test('unbekannte Leistung liefert einen Fehler statt einer Erfindung', async () => {
    const e = await werkzeugAusfuehren('leistung_auskunft', { leistung: 'gibt-es-nicht', aspekt: 'kosten' });
    assert.ok(e.fehler);
  });
});

describe('Gesprächsschritt (Mock ohne Schlüssel)', () => {
  test('läuft ohne API-Schlüssel im Mock-Modus mit Belegen', async (t) => {
    if (llmKonfiguriert()) return t.skip('API-Schlüssel gesetzt - Mock nicht aktiv');
    const r = await gespraechsschritt({ nachricht: 'Wie lange ist die Bestattungsfrist?', land: 'rp' });
    assert.equal(r.modus, 'mock');
    assert.ok(r.text.includes('14 Tage'), r.text);
    assert.ok(r.quellen.length >= 1);
  });
});
