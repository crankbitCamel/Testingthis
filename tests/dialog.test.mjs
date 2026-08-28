/**
 * Tests der Dialogfuehrung. Geprueft wird das Verhalten, das ein Anrufer
 * erlebt: dass die drei Stufen in der richtigen Reihenfolge kommen, dass
 * jede Antwort ein Ziffernmenue anbietet, dass Rueckwege funktionieren und
 * dass der Bot rechtzeitig an einen Menschen uebergibt.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Dialog, ZUSTAND, aspektInhalt } from '../src/dialog.js';
import { LEISTUNGEN, LEISTUNG_BY_ID, CLUSTER, ASPEKT_MENUE, topLeistungen } from '../src/kb/index.js';

function neuerDialog() {
  const d = new Dialog();
  d.begruessung();
  return d;
}

describe('Dreistufiger Ablauf', () => {
  test('offene Frage führt auf Stufe 1 mit Bereichswissen und Ziffernmenü', () => {
    const d = neuerDialog();
    const a = d.verarbeite('Ich wurde gekündigt und weiß nicht weiter');
    assert.equal(a.stufe, 1);
    assert.equal(a.zustand, ZUSTAND.CLUSTER);
    assert.ok(a.sprich.includes('Grob gilt hier'), 'Bereichswissen fehlt in der Ansage');
    const ziffern = a.optionen.map((o) => o.ziffer);
    assert.ok(ziffern.includes(1) && ziffern.includes(2) && ziffern.includes(3));
    assert.ok(a.anzeige.listen.some((l) => l.titel.includes('Faustregeln')));
  });

  test('Ziffernwahl führt von Stufe 1 auf Stufe 2', () => {
    const d = neuerDialog();
    d.verarbeite('Ich wurde gekündigt');
    const a = d.verarbeite('1');
    assert.equal(a.stufe, 2);
    assert.equal(a.zustand, ZUSTAND.LEISTUNG);
    assert.ok(a.pfad.length === 2);
  });

  test('Ziffernwahl führt von Stufe 2 auf Stufe 3', () => {
    const d = neuerDialog();
    d.verarbeite('Ich möchte ein Gewerbe anmelden');
    const a = d.verarbeite('1');
    assert.equal(a.stufe, 3);
    assert.equal(a.zustand, ZUSTAND.ASPEKT);
    assert.equal(a.quelle.aspektId, 'unterlagen');
    assert.ok(a.pfad.length === 3);
  });

  test('konkrete Frage überspringt Stufen und landet direkt auf Stufe 3', () => {
    const d = neuerDialog();
    const a = d.verarbeite('Was kostet ein Personalausweis');
    assert.equal(a.stufe, 3);
    assert.equal(a.quelle.leistungId, 'personalausweis');
    assert.equal(a.quelle.aspektId, 'kosten');
    assert.ok(a.sprich.includes('37,00 Euro'), a.sprich);
  });

  test('nach einem Aspekt werden nur noch ungehörte Aspekte angeboten', () => {
    const d = neuerDialog();
    d.verarbeite('Reisepass beantragen');
    const ersteAntwort = d.verarbeite('1');
    const zweiteAntwort = d.verarbeite('1');
    assert.notEqual(ersteAntwort.quelle.aspektId, zweiteAntwort.quelle.aspektId);
  });
});

describe('Navigation', () => {
  test('"zurück" führt Stufe für Stufe zurück', () => {
    const d = neuerDialog();
    d.verarbeite('Ich habe ein Auto gekauft');
    d.verarbeite('1');
    assert.equal(d.zustand, ZUSTAND.ASPEKT);
    assert.equal(d.verarbeite('zurück').zustand, ZUSTAND.LEISTUNG);
    assert.equal(d.verarbeite('zurück').zustand, ZUSTAND.CLUSTER);
    assert.equal(d.verarbeite('zurück').zustand, ZUSTAND.START);
  });

  test('"neues Anliegen" setzt den Kontext zurück', () => {
    const d = neuerDialog();
    d.verarbeite('Ich bin umgezogen');
    d.verarbeite('neues Anliegen');
    assert.equal(d.leistungId, null);
    assert.equal(d.clusterId, null);
  });

  test('"alles" liefert die vollständige Auskunft mit allen Blöcken', () => {
    const d = neuerDialog();
    d.verarbeite('Gewerbe anmelden');
    const a = d.verarbeite('alles');
    const titel = a.anzeige.listen.map((l) => l.titel);
    for (const erwartet of ['Voraussetzungen', 'Benötigte Unterlagen', 'Kosten', 'Fristen', 'Ablauf Schritt für Schritt', 'Rechtsgrundlagen']) {
      assert.ok(titel.some((t) => t.startsWith(erwartet)), `Block "${erwartet}" fehlt`);
    }
  });

  test('Ziffer außerhalb des Menüs wird erklärt statt ignoriert', () => {
    const d = neuerDialog();
    d.verarbeite('Ich bin umgezogen');
    const a = d.verarbeite('9');
    assert.ok(a.sprich.includes('steht hier nicht zur Auswahl'), a.sprich);
  });

  test('Auswahl über den Leistungsnamen funktioniert wie die Ziffer', () => {
    const d = neuerDialog();
    d.verarbeite('Ich bin umgezogen');
    const a = d.verarbeite('Meldebescheinigung');
    assert.equal(a.quelle.leistungId, 'meldebescheinigung');
  });
});

describe('Eskalation und Robustheit', () => {
  test('nach drei unverständlichen Eingaben wird an einen Menschen übergeben', () => {
    const d = neuerDialog();
    d.verarbeite('xyzzy');
    d.verarbeite('blubb blubb');
    const a = d.verarbeite('qwertz asdfgh');
    assert.equal(a.zustand, ZUSTAND.MENSCH);
    assert.ok(a.anzeige.listen[0].eintraege.some((e) => e.startsWith('Grund:')));
  });

  test('die zweite Fehlerkennung bietet ein Bereichsmenü an', () => {
    const d = neuerDialog();
    d.verarbeite('xyzzy');
    const a = d.verarbeite('blubb');
    assert.equal(a.zustand, ZUSTAND.BEREICHSWAHL);
    assert.ok(a.optionen.length >= 3);
  });

  test('Wunsch nach einem Menschen wird sofort erfüllt und übergibt Kontext', () => {
    const d = neuerDialog();
    d.verarbeite('Ich möchte Bürgergeld beantragen');
    const a = d.verarbeite('Ich will mit einem Mitarbeiter sprechen');
    assert.equal(a.zustand, ZUSTAND.MENSCH);
    const protokoll = a.anzeige.listen[0].eintraege.join(' ');
    assert.ok(protokoll.includes('Bürgergeld'));
    assert.ok(protokoll.includes('Jobcenter'));
  });

  test('leere Eingabe stürzt nicht ab', () => {
    const d = neuerDialog();
    const a = d.verarbeite('   ');
    assert.ok(a.sprich.length > 0);
  });

  test('Zähler für Missverständnisse wird nach Erfolg zurückgesetzt', () => {
    const d = neuerDialog();
    d.verarbeite('xyzzy');
    d.verarbeite('Ich bin umgezogen');
    assert.equal(d.missverstaendnisse, 0);
  });
});

describe('Qualität der gesprochenen Antworten', () => {
  test('kein Sprechtext ist länger als 800 Zeichen', () => {
    const zuLang = [];
    for (const l of LEISTUNGEN) {
      const d = new Dialog();
      d.begruessung();
      const a = d.zeigeLeistung(l.id);
      if (a.sprich.length > 800) zuLang.push(`${l.id} (${a.sprich.length})`);
      for (const aspekt of ASPEKT_MENUE) {
        const b = d.zeigeAspekt(l.id, aspekt);
        if (b.sprich.length > 800) zuLang.push(`${l.id}/${aspekt} (${b.sprich.length})`);
      }
    }
    assert.deepEqual(zuLang, [], `Zu lange Sprechtexte: ${zuLang.join(', ')}`);
  });

  test('keine Antwort enthält Platzhalter oder undefined', () => {
    const d = new Dialog();
    for (const l of LEISTUNGEN) {
      for (const aspekt of ASPEKT_MENUE) {
        const a = d.zeigeAspekt(l.id, aspekt);
        assert.ok(!a.sprich.includes('undefined'), `${l.id}/${aspekt}: ${a.sprich}`);
        assert.ok(!a.sprich.includes('[object'), `${l.id}/${aspekt}`);
        assert.ok(!/\s{3,}/.test(a.sprich), `${l.id}/${aspekt}: mehrfache Leerzeichen`);
      }
    }
  });

  test('jede Antwort auf jeder Stufe bietet mindestens eine Option an', () => {
    const d = new Dialog();
    for (const c of CLUSTER) {
      assert.ok(d.zeigeCluster(c.id).optionen.length >= 3, `Cluster ${c.id}`);
    }
    for (const l of LEISTUNGEN) {
      assert.ok(d.zeigeLeistung(l.id).optionen.length >= 3, `Leistung ${l.id}`);
    }
  });

  test('alle zehn Detailaspekte liefern für jede Leistung Inhalt', () => {
    const aspekte = ['unterlagen', 'kosten', 'ablauf', 'voraussetzungen', 'fristen', 'zustaendigkeit', 'online', 'rechtsgrundlagen', 'fehler', 'faq'];
    for (const l of LEISTUNGEN) {
      for (const a of aspekte) {
        const inhalt = aspektInhalt(l, a);
        assert.ok(inhalt.sprich && inhalt.sprich.length > 10, `${l.id}/${a}: kein Sprechtext`);
        assert.ok(Array.isArray(inhalt.listen), `${l.id}/${a}: keine Listen`);
      }
    }
  });
});

describe('Vollständige Erreichbarkeit der Wissensbasis', () => {
  test('jede Leistung ist über das Ziffernmenü ihres Bereichs erreichbar', () => {
    const d = new Dialog();
    const unerreichbar = [];
    for (const l of LEISTUNGEN) {
      const imTop = topLeistungen(l.cluster, 3).some((t) => t.id === l.id);
      if (imTop) continue;
      // sonst über "Etwas anderes aus diesem Bereich"
      // ueber "Etwas anderes aus diesem Bereich", notfalls ueber mehrere Seiten
      let gefunden = false;
      for (let seite = 0; seite < 4 && !gefunden; seite += 1) {
        const alle = d.zeigeClusterAlle(l.cluster, seite);
        gefunden = alle.optionen.some((o) => o.ziel.leistungId === l.id);
      }
      if (!gefunden) unerreichbar.push(l.id);
    }
    assert.deepEqual(unerreichbar, [], `Nicht per Ziffernwahl erreichbar: ${unerreichbar.join(', ')}`);
  });

  test('jeder Bereich nennt Zuständigkeit, Kosten und Fristen im Grobwissen', () => {
    const d = new Dialog();
    for (const c of CLUSTER) {
      const a = d.zeigeCluster(c.id);
      const titel = a.anzeige.listen.map((l) => l.titel).join('|');
      assert.ok(titel.includes('Wer ist zuständig'), c.id);
      assert.ok(titel.includes('Was es meistens kostet'), c.id);
      assert.ok(titel.includes('Typische Fristen'), c.id);
    }
  });

  test('Weiterleitungshinweis existiert für jede Leistung', () => {
    for (const l of LEISTUNGEN) {
      assert.ok(l.eskalation.length > 20, `${l.id}: Eskalationshinweis zu knapp`);
    }
  });

  test('kommunal variierende Angaben tragen immer einen Vorbehalt', () => {
    const d = new Dialog();
    for (const l of LEISTUNGEN.filter((x) => x.belastbarkeit.quelle !== 'bundesrecht')) {
      const a = d.zeigeAspekt(l.id, 'kosten');
      assert.ok(a.anzeige.hinweis?.includes('zuständige Behörde'),
        `${l.id}: fehlender Vorbehalt bei kommunal/landesrechtlich abweichenden Angaben`);
    }
  });
});
