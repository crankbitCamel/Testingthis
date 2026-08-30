/** Tests des Kommunen-Overlay-Formats und seines Validators. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pruefeKommune } from '../scripts/validate-kommune.mjs';

const musterstadt = JSON.parse(
  await readFile(new URL('../beispiele/kommunen/99999999-musterstadt.json', import.meta.url), 'utf8'),
);

describe('Kommunen-Overlay', () => {
  test('das Beispiel Musterstadt ist fehler- und warnungsfrei', () => {
    const { fehler, warnungen } = pruefeKommune(musterstadt);
    assert.deepEqual(fehler, []);
    assert.deepEqual(warnungen, []);
  });

  test('unbekannte Leistungs-IDs werden abgewiesen', () => {
    const kaputt = structuredClone(musterstadt);
    kaputt.leistungen['tippfehler-leistung'] = kaputt.leistungen.hundesteuer;
    const { fehler } = pruefeKommune(kaputt);
    assert.ok(fehler.some((f) => f.includes('tippfehler-leistung')));
  });

  test('Betrag und betragCent müssen zusammenpassen', () => {
    const kaputt = structuredClone(musterstadt);
    kaputt.leistungen.hundesteuer.gebuehren[0].betragCent = 99999;
    const { fehler } = pruefeKommune(kaputt);
    assert.ok(fehler.some((f) => f.includes('widersprechen')));
  });

  test('stelleRef muss auf eine existierende Stelle zeigen', () => {
    const kaputt = structuredClone(musterstadt);
    kaputt.leistungen.hundesteuer.stelleRef = 'gibt-es-nicht';
    const { fehler } = pruefeKommune(kaputt);
    assert.ok(fehler.some((f) => f.includes('gibt-es-nicht')));
  });

  test('AGS-Präfix und Bundesland müssen zusammenpassen', () => {
    const kaputt = structuredClone(musterstadt);
    kaputt.ags = '05315000';
    kaputt.land = 'rp';
    const { fehler } = pruefeKommune(kaputt);
    assert.ok(fehler.some((f) => f.includes('AGS-Präfix')));
  });

  test('überfällige Prüfdaten erzeugen eine Degradierungs-Warnung', () => {
    const alt = structuredClone(musterstadt);
    alt.leistungen.hundesteuer.quelle.geprueftAm = '2024-01-01';
    const { warnungen } = pruefeKommune(alt, { heute: new Date('2026-08-28') });
    assert.ok(warnungen.some((w) => w.includes('überfällig')));
  });

  test('fehlende Quelle ist ein Fehler, keine Warnung', () => {
    const kaputt = structuredClone(musterstadt);
    delete kaputt.leistungen.hundesteuer.quelle;
    const { fehler } = pruefeKommune(kaputt);
    assert.ok(fehler.some((f) => f.includes('Herkunft')));
  });
});
