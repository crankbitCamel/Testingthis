/**
 * Tests der Erkennung. Der Kern ist die Klassifikationstabelle: reale
 * Formulierungen, wie sie am Buergertelefon vorkommen, mit dem Bereich, in
 * dem sie landen muessen. Sie ist zugleich die Regressionsgrenze - wer die
 * Wissensbasis erweitert, darf diese Zuordnungen nicht verschlechtern.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalisieren, tokenisieren, stamm, verstehe, entscheide,
  erkenneZiffer, erkenneJaNein, erkenneBefehl, erkenneAspekt,
} from '../src/nlu.js';
import { CLUSTER_BY_ID, LEISTUNG_BY_ID } from '../src/kb/index.js';

describe('Normalisierung', () => {
  test('wandelt Umlaute und entfernt Satzzeichen', () => {
    assert.equal(normalisieren('Führerschein, bitte!'), 'fuehrerschein bitte');
    assert.equal(normalisieren('Größe: 3 m²'), 'groesse 3 m');
    assert.equal(normalisieren('  Mehrere   Leerzeichen '), 'mehrere leerzeichen');
  });

  test('entfernt Füllwörter beim Tokenisieren', () => {
    const t = tokenisieren('Ich möchte bitte einen neuen Personalausweis beantragen');
    assert.ok(!t.includes('ich'));
    assert.ok(!t.includes('bitte'));
    // Das Stemming kappt das Plural-s, deshalb der gekuerzte Stamm.
    assert.ok(t.some((w) => w.startsWith('personalauswei')), t.join(','));
  });

  test('stemmt konservativ und lässt kurze Wörter unangetastet', () => {
    assert.equal(stamm('anmelden'), 'anmeld');
    assert.equal(stamm('Anmeldung'.toLowerCase()), 'anmeld');
    assert.equal(stamm('pass'), 'pass');
    assert.equal(stamm('bau'), 'bau');
  });
});

describe('Ziffernerkennung', () => {
  const faelle = [
    ['1', 1], ['2', 2], ['eins', 1], ['zwei', 2], ['drei', 3],
    ['die zweite', 2], ['nummer 3', 3], ['Punkt eins', 1], ['eins bitte', 1],
    ['b', 2], ['null', 0], ['0', 0],
  ];
  for (const [eingabe, erwartet] of faelle) {
    test(`"${eingabe}" ergibt ${erwartet}`, () => {
      assert.equal(erkenneZiffer(eingabe), erwartet);
    });
  }

  test('erkennt Zahlen im Fließtext nicht als Menüauswahl', () => {
    assert.equal(erkenneZiffer('ich habe 2 Kinder'), null);
    assert.equal(erkenneZiffer('ich wohne seit 3 Jahren hier'), null);
    assert.equal(erkenneZiffer('mein Ausweis ist seit zwei Wochen abgelaufen'), null);
  });
});

describe('Bestätigung und Befehle', () => {
  test('erkennt Ja und Nein', () => {
    assert.equal(erkenneJaNein('ja genau'), true);
    assert.equal(erkenneJaNein('nein das stimmt nicht'), false);
    assert.equal(erkenneJaNein('Personalausweis'), null);
  });

  test('erkennt Steuerbefehle in jedem Kontext', () => {
    assert.equal(erkenneBefehl('zurück'), 'zurueck');
    assert.equal(erkenneBefehl('ich möchte ein neues Anliegen'), 'hauptmenue');
    assert.equal(erkenneBefehl('bitte wiederholen'), 'wiederholen');
    assert.equal(erkenneBefehl('ich will mit einem Mitarbeiter sprechen'), 'mensch');
    assert.equal(erkenneBefehl('auf Wiederhören'), 'beenden');
    assert.equal(erkenneBefehl('Ich brauche einen Ausweis'), null);
  });
});

describe('Aspekterkennung', () => {
  const faelle = [
    ['Was kostet das', 'kosten'],
    ['Wie teuer ist das', 'kosten'],
    ['Welche Unterlagen brauche ich', 'unterlagen'],
    ['Was muss ich mitbringen', 'unterlagen'],
    ['Wie läuft das ab', 'ablauf'],
    ['Welche Fristen gelten', 'fristen'],
    ['Wo muss ich hin', 'zustaendigkeit'],
    ['Geht das auch online', 'online'],
    ['Auf welchem Gesetz beruht das', 'rechtsgrundlagen'],
  ];
  for (const [frage, erwartet] of faelle) {
    test(`"${frage}" → ${erwartet}`, () => {
      assert.equal(erkenneAspekt(frage), erwartet);
    });
  }

  test('erkennt keinen Aspekt in einer reinen Anliegensbeschreibung', () => {
    assert.equal(erkenneAspekt('Ich bin umgezogen'), null);
  });
});

/**
 * Klassifikationstabelle: gesprochene Alltagssätze und der Bereich, in dem
 * sie landen müssen. Geprüft wird der Bereich, nicht die Einzelleistung -
 * genau das ist die geforderte grobe Zuordnung vor der Ziffernwahl.
 */
const KLASSIFIKATION = [
  ['Ich bin letzte Woche umgezogen', 'melde-ausweis'],
  ['Mein Personalausweis läuft im März ab', 'melde-ausweis'],
  ['Ich brauche ein polizeiliches Führungszeugnis', 'melde-ausweis'],
  ['Mein Portemonnaie mit dem Ausweis wurde geklaut', 'melde-ausweis'],
  ['Ich brauche eine Meldebescheinigung fürs Gericht', 'melde-ausweis'],
  ['Wir fliegen im Sommer nach Thailand, brauchen wir Pässe', 'melde-ausweis'],

  ['Ich habe ein gebrauchtes Auto gekauft', 'kfz-verkehr'],
  ['Mein Motorrad soll stillgelegt werden', 'kfz-verkehr'],
  ['Ich möchte ein Wunschkennzeichen', 'kfz-verkehr'],
  ['Mein alter Papierführerschein muss getauscht werden', 'kfz-verkehr'],
  ['Ich brauche einen Anwohnerparkausweis', 'kfz-verkehr'],

  ['Wir haben ein Baby bekommen', 'familie-kinder'],
  ['Ich möchte Kindergeld beantragen', 'familie-kinder'],
  ['Wo bekomme ich einen Kitaplatz', 'familie-kinder'],
  ['Der Vater zahlt keinen Unterhalt', 'familie-kinder'],
  ['Ich will Elterngeld beantragen', 'familie-kinder'],

  ['Wir wollen im Sommer heiraten', 'ehe-tod'],
  ['Mein Vater ist gestorben', 'ehe-tod'],
  ['Ich möchte aus der Kirche austreten', 'ehe-tod'],
  ['Ich brauche eine Sterbeurkunde', 'ehe-tod'],

  ['Ich wurde gekündigt', 'arbeit-soziales'],
  ['Ich brauche einen Zuschuss zur Miete', 'arbeit-soziales'],
  ['Ich möchte Bürgergeld beantragen', 'arbeit-soziales'],
  ['Ich brauche einen Schwerbehindertenausweis', 'arbeit-soziales'],
  ['Meine Rente reicht nicht zum Leben', 'arbeit-soziales'],

  ['Ich will mich selbstständig machen', 'gewerbe-wirtschaft'],
  ['Ich möchte ein Gewerbe anmelden', 'gewerbe-wirtschaft'],
  ['Ich will eine Kneipe eröffnen', 'gewerbe-wirtschaft'],
  ['Mein Betrieb wird geschlossen, was muss ich abmelden', 'gewerbe-wirtschaft'],

  ['Ich möchte eine Garage bauen', 'bauen-wohnen'],
  ['Brauche ich für ein Gartenhaus eine Genehmigung', 'bauen-wohnen'],
  ['Mein Haus steht unter Denkmalschutz', 'bauen-wohnen'],

  ['Ich möchte deutscher Staatsbürger werden', 'auslaender-einbuergerung'],
  ['Meine Aufenthaltserlaubnis läuft ab', 'auslaender-einbuergerung'],
  ['Ich will Verwandte aus dem Ausland einladen', 'auslaender-einbuergerung'],
  ['Mein ausländischer Abschluss soll anerkannt werden', 'auslaender-einbuergerung'],

  ['Ich möchte Sperrmüll abholen lassen', 'umwelt-abfall-tiere'],
  ['Ich habe einen Hund bekommen', 'umwelt-abfall-tiere'],
  ['Darf ich den Baum im Garten fällen', 'umwelt-abfall-tiere'],
  ['Ich habe eine Geldbörse gefunden', 'umwelt-abfall-tiere'],

  ['Ich habe einen Bußgeldbescheid bekommen', 'ordnung-bussgeld'],
  ['Ich wurde geblitzt und will Einspruch einlegen', 'ordnung-bussgeld'],
  ['Ich brauche eine Halteverbotszone für meinen Umzug', 'ordnung-bussgeld'],
  ['Wir wollen ein Straßenfest veranstalten', 'ordnung-bussgeld'],

  ['Mein Grundsteuerbescheid ist zu hoch', 'steuern-abgaben'],
  ['Ich habe meine Steuer-Identifikationsnummer verloren', 'steuern-abgaben'],
  ['Muss ich Zweitwohnungsteuer zahlen', 'steuern-abgaben'],

  ['Ich möchte meine Rente beantragen', 'arbeit-soziales'],
  ['Wann muss ich meine Steuererklärung abgeben', 'steuern-abgaben'],
  ['Wir wollen die Steuerklasse wechseln', 'steuern-abgaben'],
  ['Ich brauche einen Angelschein', 'umwelt-abfall-tiere'],
  ['Ich will den Jagdschein machen', 'umwelt-abfall-tiere'],

  ['Mein Kind wird nächstes Jahr eingeschult', 'bildung-kultur'],
  ['Ich möchte BAföG beantragen', 'bildung-kultur'],
  ['Wer zahlt das Schülerticket', 'bildung-kultur'],
];

describe('Klassifikation realer Anliegen', () => {
  for (const [satz, erwartetesCluster] of KLASSIFIKATION) {
    test(`"${satz}" → ${erwartetesCluster}`, () => {
      const analyse = verstehe(satz);
      const ergebnis = entscheide(analyse);
      const gefunden = ergebnis.art === 'leistung'
        ? LEISTUNG_BY_ID[ergebnis.leistungId].cluster
        : ergebnis.clusterId ?? ergebnis.clusterIds?.[0];
      assert.equal(gefunden, erwartetesCluster,
        `erkannt: ${ergebnis.art} ${ergebnis.leistungId ?? ergebnis.clusterId ?? (ergebnis.clusterIds ?? []).join(', ')}`);
    });
  }

  test('Trefferquote der Klassifikationstabelle liegt bei 100 Prozent', () => {
    const treffer = KLASSIFIKATION.filter(([satz, erwartet]) => {
      const e = entscheide(verstehe(satz));
      const c = e.art === 'leistung' ? LEISTUNG_BY_ID[e.leistungId].cluster : e.clusterId ?? e.clusterIds?.[0];
      return c === erwartet;
    }).length;
    assert.equal(treffer, KLASSIFIKATION.length);
  });
});

describe('Umgang mit unklaren Eingaben', () => {
  for (const satz of ['Hallo', 'Guten Tag', 'Ähm', 'Ich hätte da mal eine Frage', '...']) {
    test(`"${satz}" wird nicht falsch zugeordnet`, () => {
      const ergebnis = entscheide(verstehe(satz));
      assert.equal(ergebnis.art, 'unklar');
    });
  }

  test('mehrdeutige Anliegen führen zur Bereichsauswahl, nicht zu einer Leistung', () => {
    const ergebnis = entscheide(verstehe('Ich brauche eine Bescheinigung'));
    assert.notEqual(ergebnis.art, 'leistung');
  });
});

describe('Synonyme führen zur richtigen Leistung', () => {
  test('jede Leistung wird über mindestens ein eigenes Synonym gefunden', () => {
    const nichtGefunden = [];
    for (const leistung of Object.values(LEISTUNG_BY_ID)) {
      const gefunden = (leistung.synonyme ?? []).some((synonym) => {
        const analyse = verstehe(synonym);
        return analyse.leistungTreffer[0]?.id === leistung.id;
      });
      if (!gefunden) nichtGefunden.push(leistung.id);
    }
    assert.deepEqual(nichtGefunden, [],
      `Diese Leistungen sind über keines ihrer Synonyme erreichbar: ${nichtGefunden.join(', ')}`);
  });

  test('jedes Cluster ist über seine Stichworte erreichbar', () => {
    for (const cluster of Object.values(CLUSTER_BY_ID)) {
      const treffer = cluster.stichworte.filter((s) => {
        const analyse = verstehe(s);
        return analyse.clusterTreffer[0]?.id === cluster.id;
      });
      assert.ok(treffer.length / cluster.stichworte.length > 0.6,
        `Cluster ${cluster.id}: nur ${treffer.length} von ${cluster.stichworte.length} Stichworten führen zum eigenen Bereich`);
    }
  });
});
