/**
 * Tests der Regionalschicht: Landeserkennung, Aufloesung der Overlays und
 * das Dialogverhalten, wenn ein Bundesland gesetzt ist. Der Kern: Dieselbe
 * Frage muss in NRW und RP unterschiedliche, jeweils richtige Antworten
 * ergeben - und ohne Landesangabe die ehrliche bundesweite Spanne.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { erkenneLand, istReineOrtsangabe } from '../src/nlu.js';
import { Dialog } from '../src/dialog.js';
import { REGISTERBEREICHE, LAENDER_LISTE, regional, registerbereichFuer } from '../src/kb/regional/index.js';
import { LEISTUNG_BY_ID, LEISTUNGEN } from '../src/kb/index.js';

describe('Landeserkennung', () => {
  const faelle = [
    ['ich wohne in Köln', 'nw'],
    ['wir kommen aus Mainz', 'rp'],
    ['in NRW', 'nw'],
    ['Rheinland-Pfalz', 'rp'],
    ['rlp', 'rp'],
    ['bin nach Düsseldorf gezogen', 'nw'],
    ['Koblenz', 'rp'],
    ['Hamburg', null],
    ['ich habe einen Körper', null],
  ];
  for (const [text, erwartet] of faelle) {
    test(`"${text}" → ${erwartet}`, () => {
      assert.equal(erkenneLand(text)?.code ?? null, erwartet);
    });
  }

  test('reine Ortsangabe wird von Anliegen mit Ortsnennung unterschieden', () => {
    const koeln = erkenneLand('ich wohne in Köln');
    assert.equal(istReineOrtsangabe('ich wohne in Köln', koeln.stichwort), true);
    const dus = erkenneLand('ich bin nach Düsseldorf gezogen');
    assert.equal(istReineOrtsangabe('ich bin nach Düsseldorf gezogen', dus.stichwort), false);
  });
});

describe('Struktur der Regionalschicht', () => {
  test('es gibt genau 20 Registerbereiche und jede referenzierte Leistung existiert', () => {
    assert.equal(REGISTERBEREICHE.length, 20);
    for (const b of REGISTERBEREICHE) {
      for (const lid of b.leistungen) {
        assert.ok(LEISTUNG_BY_ID[lid], `${b.id}: unbekannte Leistung ${lid}`);
      }
    }
  });

  test('beide Länder füllen alle 20 Registerbereiche', () => {
    for (const land of LAENDER_LISTE) {
      for (const b of REGISTERBEREICHE) {
        const profil = land.registerprofile[b.id];
        assert.ok(profil?.kurz && profil.fakten?.length >= 1,
          `${land.kuerzel}/${b.id}: Registerprofil fehlt oder ist leer`);
      }
    }
  });

  test('jede Leistung mit Registerbereich hat in beiden Ländern eine Regionalauflösung', () => {
    for (const l of LEISTUNGEN) {
      if (!registerbereichFuer(l.id)) continue;
      for (const land of LAENDER_LISTE) {
        assert.ok(regional(l.id, land.code), `${land.kuerzel}/${l.id}: keine Auflösung`);
      }
    }
  });

  test('unbekanntes Land löst zu null auf - der Dialog fällt auf die Basis zurück', () => {
    assert.equal(regional('kirchenaustritt', 'by'), null);
    assert.equal(regional('kirchenaustritt', null), null);
  });
});

describe('Fachlich gegensätzliche Landesantworten', () => {
  test('Kirchenaustritt: NRW Amtsgericht, RP Standesamt', () => {
    assert.match(regional('kirchenaustritt', 'nw').eintrag.zustaendigkeit.stelle, /Amtsgericht/);
    assert.match(regional('kirchenaustritt', 'rp').eintrag.zustaendigkeit.stelle, /Standesamt/);
  });

  test('Bestattungsfrist: NRW zehn Tage, RP vierzehn Tage', () => {
    assert.ok(regional('bestattung', 'nw').eintrag.fristen.some((f) => f.includes('zehn Tage')));
    assert.ok(regional('bestattung', 'rp').eintrag.fristen.some((f) => f.includes('14 Tage')));
  });

  test('Schwerbehindertenfeststellung: NRW kommunalisiert, RP Landesamt', () => {
    assert.match(regional('schwerbehindertenausweis', 'nw').eintrag.zustaendigkeit.stelle, /Kreis/);
    assert.match(regional('schwerbehindertenausweis', 'rp').eintrag.zustaendigkeit.stelle, /Landesamt/);
  });

  test('Schulanmeldung: NRW Stichtag 30. September und freie Wahl, RP 31. August und Sprengel', () => {
    const nw = regional('schulanmeldung', 'nw').eintrag;
    const rp = regional('schulanmeldung', 'rp').eintrag;
    assert.ok(nw.fristen[0].includes('30. September'));
    assert.ok(rp.fristen[0].includes('31. August'));
    assert.ok(nw.besonderheiten.some((b) => b.includes('Freie Grundschulwahl')));
    assert.ok(rp.besonderheiten.some((b) => b.includes('Schulbezirke')));
  });
});

describe('Dialog mit gesetztem Land', () => {
  function dialogMit(land) {
    const d = new Dialog();
    d.begruessung();
    if (land) d.landSetzen(land);
    return d;
  }

  test('reine Ortsangabe setzt das Land und bestätigt', () => {
    const d = dialogMit(null);
    const a = d.verarbeite('Ich wohne in Köln');
    assert.equal(d.land, 'nw');
    assert.ok(a.sprich.includes('Nordrhein-Westfalen'));
  });

  test('Anliegen mit Ortsnennung setzt das Land UND beantwortet das Anliegen', () => {
    const d = dialogMit(null);
    const a = d.verarbeite('Was kostet die Hundesteuer in Mainz');
    assert.equal(d.land, 'rp');
    assert.equal(a.quelle.leistungId, 'hundesteuer');
    assert.equal(a.quelle.aspektId, 'kosten');
    assert.ok(a.sprich.includes('Rheinland-Pfalz'));
  });

  test('Leistungsansicht trägt den Regionalblock', () => {
    const d = dialogMit('nw');
    const a = d.verarbeite('Kirchenaustritt');
    const regionalListe = a.anzeige.listen.find((l) => l.titel.startsWith('Regional:'));
    assert.ok(regionalListe, 'Regionalblock fehlt');
    assert.ok(regionalListe.titel.includes('Nordrhein-Westfalen'));
    assert.ok(regionalListe.eintraege.some((e) => e.includes('Amtsgericht')));
    assert.ok(a.sprich.includes('Amtsgericht'));
  });

  test('dieselbe Frage liefert je Land die jeweils richtige Zuständigkeit', () => {
    const nw = dialogMit('nw').verarbeite('Wo trete ich aus der Kirche aus');
    const rp = dialogMit('rp').verarbeite('Wo trete ich aus der Kirche aus');
    assert.ok(nw.sprich.includes('Amtsgericht'), nw.sprich);
    assert.ok(rp.sprich.includes('Standesamt'), rp.sprich);
  });

  test('ohne Land: erst die Ortsfrage, nach Verzicht die bundesweite Spanne', () => {
    const d = dialogMit(null);
    const frage = d.verarbeite('Was kostet die Hundesteuer');
    assert.equal(frage.zustand, 'ortsklaerung');
    assert.ok(frage.sprich.includes('kommunal geregelt'), frage.sprich);
    assert.ok(frage.sprich.includes('Stadt oder Gemeinde'), frage.sprich);
    const antwort = d.verarbeite('3');
    assert.ok(antwort.sprich.includes('30 bis 180'), antwort.sprich);
    // Nach dem Verzicht wird nicht erneut gefragt.
    const zweite = d.verarbeite('Was kostet ein Bewohnerparkausweis');
    assert.notEqual(zweite.zustand, 'ortsklaerung');
  });

  test('das Land überdauert ein neues Anliegen', () => {
    const d = dialogMit(null);
    d.verarbeite('Ich wohne in Koblenz');
    d.verarbeite('neues Anliegen');
    assert.equal(d.land, 'rp');
  });

  test('Regionalblock erscheint nur bei passendem Aspekt', () => {
    const d = dialogMit('nw');
    d.verarbeite('Kirchenaustritt');
    const kosten = d.verarbeite('was kostet das');
    assert.ok(kosten.anzeige.listen.some((l) => l.titel.startsWith('Regional:')));
    const d2 = dialogMit('nw');
    d2.verarbeite('Führungszeugnis beantragen');
    const rechts = d2.verarbeite('rechtsgrundlagen');
    // Fuehrungszeugnis hat kein NRW-Overlay mit Rechtsgrundlagen - kein leerer Block.
    const block = rechts.anzeige.listen.find((l) => l.titel.startsWith('Regional:'));
    if (block) assert.ok(block.eintraege.length > 0);
  });

  test('Vollauskunft mit Land beginnt mit dem Regionalblock', () => {
    const d = dialogMit('rp');
    d.verarbeite('Kita-Platz beantragen');
    const a = d.verarbeite('alles');
    assert.ok(a.anzeige.listen[0].titel.startsWith('Regional: Rheinland-Pfalz'));
    assert.ok(a.anzeige.listen[0].eintraege.some((e) => e.includes('beitragsfrei')));
  });

  test('Rechtsebenen-Klärung: Bundesrecht wird nie mit einer Ortsfrage belastet', () => {
    const d = dialogMit(null);
    const a = d.verarbeite('Was kostet ein Personalausweis');
    assert.notEqual(a.zustand, 'ortsklaerung');
    assert.ok(a.sprich.includes('37,00 Euro'));
  });

  test('Rechtsebenen-Klärung: Stadtname in der Rückfrage löst direkt auf', () => {
    const d = dialogMit(null);
    d.verarbeite('Was kostet die Hundesteuer');
    const a = d.verarbeite('ich wohne in Bonn');
    assert.equal(d.land, 'nw');
    assert.ok(a.sprich.startsWith('Nordrhein-Westfalen, verstanden'), a.sprich.slice(0, 60));
    assert.ok(a.sprich.includes('96 bis 180') || a.anzeige.listen.some((l) => l.titel.startsWith('Regional:')));
  });

  test('Rechtsebenen-Klärung: unbekannter Ort fällt ehrlich auf die Spanne zurück', () => {
    const d = dialogMit(null);
    d.verarbeite('Was kostet die Hundesteuer');
    const a = d.verarbeite('München');
    assert.ok(a.sprich.includes('keine eigenen Daten'), a.sprich.slice(0, 120));
    assert.ok(a.sprich.includes('30 bis 180'));
  });

  test('Rechtsebenen-Klärung: neues Anliegen während der Rückfrage verwirft sie', () => {
    const d = dialogMit(null);
    d.verarbeite('Was kostet die Hundesteuer');
    const a = d.verarbeite('Ich habe ein Auto gekauft');
    assert.equal(a.quelle?.leistungId ?? a.quelle?.clusterId, 'kfz-ummeldung');
  });

  test('keine Regionalantwort enthält undefined', () => {
    for (const land of ['nw', 'rp']) {
      for (const l of LEISTUNGEN) {
        const d = dialogMit(land);
        const a = d.zeigeLeistung(l.id);
        assert.ok(!a.sprich.includes('undefined'), `${land}/${l.id}: ${a.sprich}`);
        for (const liste of a.anzeige.listen) {
          for (const e of liste.eintraege) {
            assert.ok(!String(e).includes('undefined'), `${land}/${l.id}/${liste.titel}`);
          }
        }
      }
    }
  });
});
