/**
 * Tests der PVOG-Normalisierung ohne Netz: Betragserkennung und Ueberfuehrung
 * einer Leistungsbeschreibung (verkuerztes Echtbeispiel Reisepass Koeln) in
 * feste Felder mit Quelle und Stand.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { betraegeAus, normalisiere } from '../scripts/pvog.mjs';

describe('Betraege', () => {
  test('erkennt Euro-Angaben in allen ueblichen Schreibweisen', () => {
    assert.deepEqual(betraegeAus('37,50 Euro unter 24, 70 Euro ab 24'), [37.5, 70]);
    assert.deepEqual(betraegeAus('Gebühr: 70,00 EUR; Express 32,00 €'), [70, 32]);
    assert.deepEqual(betraegeAus('Grundbetrag 1.250,00 Euro'), [1250]);
    assert.deepEqual(betraegeAus('keine Gebühren'), []);
  });
});

describe('Normalisieren', () => {
  const roh = {
    id: 'L100002.LB.121370768',
    name: 'Reisepass beantragen',
    ars: ['050000000000'],
    leikakeys: ['99085001012000'],
    externalLastUpdate: '2026-05-21T10:21:56.440Z',
    onlineServiceLinks: [{ title: 'Reisepass beantragen', uri: 'https://www.stadt-koeln.de/service/produkte/reisepass' }],
    details: [
      { code: '24', text: '<p>Kurzinfo</p>' },
      { code: '08', text: '<ul><li>Personalausweis</li><li>Passfoto</li></ul>' },
      { code: '98', text: '<p>37,50 Euro unter 24 Jahren</p>', details: [{ title: 'Gebühr: 70,00 Euro', text: 'ab 24 Jahren' }] },
      { code: '97', text: 'nicht angegeben', placeholder: true },
      { code: '07', links: [{ title: '§ 6 PassG', uri: 'https://www.gesetze-im-internet.de/pa_g_1986/__6.html' }] },
      { code: '93', text: 'Bundesministerium des Innern (BMI)', date: '2026-05-13' },
      { code: '94', links: [{ uri: 'http://portal/deeplink?x=1' }] },
    ],
  };
  const kommune = { ars: '053150000000', name: 'Köln', bundesland: 'Nordrhein-Westfalen' };
  const s = normalisiere(roh, { kommune, leistungId: 'reisepass', leika: '99085001012000', abgerufen: '2026-10-04T08:00:00Z' });

  test('feste Felder, Gebühr strukturiert und als Beträge', () => {
    assert.equal(s.pvogId, 'L100002.LB.121370768');
    assert.equal(s.ebene, 'landesweit');
    assert.equal(s.unterlagen, '- Personalausweis\n- Passfoto');
    assert.equal(s.gebuehren.strukturiert, true);
    assert.deepEqual(s.gebuehren.betraegeEuro, [37.5, 70]);
    assert.equal(s.fristen, null, 'Platzhalter "nicht angegeben" wird null');
  });

  test('Quelle und Stand: Freigabe, Rechtsgrundlage, Online-Dienst; interne Portal-Links fallen weg', () => {
    assert.deepEqual(s.freigabe, { stelle: 'Bundesministerium des Innern (BMI)', datum: '2026-05-13' });
    assert.equal(s.rechtsgrundlagen[0].uri, 'https://www.gesetze-im-internet.de/pa_g_1986/__6.html');
    assert.equal(s.onlineDienste[0].uri, 'https://www.stadt-koeln.de/service/produkte/reisepass');
    assert.equal(s.quellen.length, 0, 'http://portal/... ist kein oeffentlicher Link');
    assert.equal(s.pvogStand, '2026-05-21T10:21:56.440Z');
    assert.equal(s.abgerufen, '2026-10-04T08:00:00Z');
  });
});

describe('Paket im Repository', () => {
  test('setzt Textfelder wieder ein, Gebuehren und Quellen sind da', async () => {
    const { paketLesen, PAKET } = await import('../scripts/pvog.mjs');
    const { existsSync } = await import('node:fs');
    if (!existsSync(PAKET)) return;
    const p = await paketLesen();
    assert.equal(p.saetze.length, p.anzahl);
    const koeln = p.saetze.find((s) => s.kommune.ars === '053150000000' && s.leistungId === 'reisepass');
    assert.ok(koeln, 'Reisepass Koeln vorhanden');
    assert.ok(koeln.gebuehren.betraegeEuro.includes(70) && koeln.gebuehren.betraegeEuro.includes(37.5));
    assert.ok(koeln.onlineDienste[0].uri.startsWith('https://www.stadt-koeln.de/'));
  });
});
