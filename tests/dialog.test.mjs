/**
 * Tests der traegerunabhaengigen Gespraechslogik und der Hilfen, die aus
 * dem Review kamen: Stille-/Wiederholungszaehler, Widerruf, Weiterleitung
 * mit Servicezeiten, Paragrafenpruefung, Landeserkennung mit Wortgrenzen,
 * Normalisierung von Nummern und Bereichen, englische Sprechfassung.
 * Laeuft im Mock-Modus, ohne Netz und ohne Datenbank.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  aeusserungVerarbeiten, einwilligungWaehlen, zustandFuer, servicezeitenParsen, weiterleitungStatus,
  antwortAbholen, sprechfassung, SPRACHEN, MAX_UNVERSTANDEN, MAX_POLLS, _anrufZustand, _anrufeLeeren, _jobs,
} from '../server/dialog.mjs';
import { paragrafenBereinigen, kontextFuer } from '../server/assistent.mjs';
import { erkenneLand } from '../src/nlu.js';
import { normalisiereFuerSprache, normalisiereEnglisch } from '../server/sprechnormalisierung.mjs';

describe('Stille und Unverstaendliches', () => {
  beforeEach(() => _anrufeLeeren());

  test('zwei Mal Stille -> freundlich auflegen, Zustand weg', async () => {
    const a = await aeusserungVerarbeiten({ anrufId: 'D1', text: '' });
    assert.equal(a.art, 'sagen');
    assert.match(a.text, /nichts gehört/);
    const b = await aeusserungVerarbeiten({ anrufId: 'D1', text: '' });
    assert.equal(b.art, 'auflegen');
    assert.equal(_anrufZustand('D1'), null);
  });

  test('Sprache dazwischen setzt den Stille-Zaehler zurueck', async () => {
    await aeusserungVerarbeiten({ anrufId: 'D2', text: '' });
    await aeusserungVerarbeiten({ anrufId: 'D2', text: 'Was kostet ein Reisepass?' });
    const c = await aeusserungVerarbeiten({ anrufId: 'D2', text: '' });
    assert.equal(c.art, 'sagen', 'noch kein Auflegen');
  });

  test('dreimal zu leise -> Ende mit eigenem Text', async () => {
    let s;
    for (let i = 0; i < MAX_UNVERSTANDEN; i += 1) s = await aeusserungVerarbeiten({ anrufId: 'D3', text: 'hm', konfidenz: 0.1 });
    assert.equal(s.art, 'auflegen');
    assert.match(s.text, /mehrfach nicht verstehen/);
  });
});

describe('Hintergrund-Antwort abholen (Poll-Pfad)', () => {
  beforeEach(() => { _anrufeLeeren(); _jobs().clear(); });

  test('kein Job -> weiter zuhoeren; laufend -> warten; fertig -> sagen', () => {
    zustandFuer('P1');
    assert.equal(antwortAbholen('P1').art, 'sagen');
    _jobs().set('P1', { status: 'pending', polls: 0, erstellt: Date.now() });
    assert.equal(antwortAbholen('P1').art, 'warten');
    _jobs().set('P1', { status: 'done', ergebnis: { text: 'Antwort', quellen: [] }, polls: 0, erstellt: Date.now() });
    const s = antwortAbholen('P1');
    assert.equal(s.art, 'sagen');
    assert.equal(s.text, 'Antwort');
    assert.equal(_jobs().has('P1'), false);
  });

  test('zu viele Nachfragen -> "zu lange" und auflegen; Budgetfehler ebenso, Stoerung sonst', () => {
    zustandFuer('P2');
    _jobs().set('P2', { status: 'pending', polls: MAX_POLLS, erstellt: Date.now() });
    const z = antwortAbholen('P2');
    assert.equal(z.art, 'auflegen');
    assert.match(z.text, /zu lange/);
    zustandFuer('P3');
    _jobs().set('P3', { status: 'error', fehler: { name: 'BudgetFehler' }, polls: 0, erstellt: Date.now() });
    assert.match(antwortAbholen('P3').text, /zu lange/);
    zustandFuer('P4');
    _jobs().set('P4', { status: 'error', fehler: new Error('x'), polls: 0, erstellt: Date.now() });
    assert.match(antwortAbholen('P4').text, /technische Störung/);
  });

  test('fertiger Job mit beendet -> auflegen und Zustand weg', () => {
    zustandFuer('P5');
    _jobs().set('P5', { status: 'done', ergebnis: { text: 'Tschüss', beendet: true }, polls: 0, erstellt: Date.now() });
    assert.equal(antwortAbholen('P5').art, 'auflegen');
    assert.equal(_anrufZustand('P5'), null);
  });
});

describe('Weiterleitung', () => {
  test('Servicezeiten werden geparst', () => {
    assert.deepEqual(servicezeitenParsen('Mo-Fr 08:00-16:00'), { tage: [1, 2, 3, 4, 5], von: 480, bis: 960 });
    assert.deepEqual(servicezeitenParsen('Sa 09:00-12:00'), { tage: [6], von: 540, bis: 720 });
    assert.equal(servicezeitenParsen('immer'), null);
  });

  test('Status: keine Nummer -> nicht verfuegbar; Nummer ohne Zeiten -> immer; mit Zeiten -> nur innerhalb', () => {
    assert.equal(weiterleitungStatus(new Date(), {}).verfuegbar, false);
    assert.equal(weiterleitungStatus(new Date(), { TELEFON_WEITERLEITUNG_NUMMER: '+4930123456' }).verfuegbar, true);
    const env = { TELEFON_WEITERLEITUNG_NUMMER: '+4930123456', TELEFON_WEITERLEITUNG_ZEITEN: 'Mo-Fr 08:00-16:00' };
    // Mittwoch, 23. Sept. 2026, 10:00 Berlin (08:00 UTC) und 20:00 Berlin (18:00 UTC), Sonntag 10:00.
    assert.equal(weiterleitungStatus(new Date('2026-09-23T08:00:00Z'), env).verfuegbar, true);
    assert.equal(weiterleitungStatus(new Date('2026-09-23T18:00:00Z'), env).verfuegbar, false);
    assert.equal(weiterleitungStatus(new Date('2026-09-27T08:00:00Z'), env).verfuegbar, false);
    assert.equal(weiterleitungStatus(new Date(), { TELEFON_WEITERLEITUNG_NUMMER: 'abc' }).verfuegbar, false);
  });

  test('Kontext sagt dem Modell, ob Weiterleitung geht', () => {
    assert.match(kontextFuer({ weiterleitung: { verfuegbar: true } }), /JETZT verfügbar/);
    assert.match(kontextFuer({ weiterleitung: { verfuegbar: false, hinweis: 'Rufen Sie 115 an.' } }), /NICHT verfügbar.*Rufen Sie 115 an/);
  });
});

describe('Einwilligung', () => {
  beforeEach(() => _anrufeLeeren());

  test('Zeitpunkt wird bei Taste 1 gesetzt, bei Widerruf geloescht', async () => {
    einwilligungWaehlen('E1', '1');
    assert.ok(_anrufZustand('E1').einwilligungZeit > 0);
    const w = await aeusserungVerarbeiten({ anrufId: 'E1', taste: '2' });
    assert.match(w.text, /Protokollierung ist beendet/);
    assert.equal(_anrufZustand('E1').einwilligung, false);
    assert.equal(_anrufZustand('E1').einwilligungZeit, null);
  });

  test('Einwilligungstext nennt den Widerruf', () => {
    assert.match(SPRACHEN.de.texte.einwilligung, /jederzeit mit der Zwei widerrufen/);
    assert.match(SPRACHEN.en.texte.einwilligung, /withdraw/);
  });
});

describe('Paragrafen nur aus Belegen', () => {
  test('unbelegte Nummer wird entfernt, belegte bleibt', () => {
    const belege = JSON.stringify({ rechtsgrundlagen: ['§ 1 Passgesetz', '§ 4, 5 Passgesetz'] });
    assert.equal(paragrafenBereinigen('Stand August, Paragraf 24 Passgesetz.', belege), 'Stand August, Passgesetz.');
    assert.equal(paragrafenBereinigen('Siehe Paragraf 4 und 5 Passgesetz.', belege), 'Siehe Paragraf 4 und 5 Passgesetz.');
    assert.equal(paragrafenBereinigen('Nach § 1 Passgesetz.', belege), 'Nach § 1 Passgesetz.');
    assert.equal(paragrafenBereinigen('Kein Paragraf hier.', belege), 'Kein Paragraf hier.');
  });
});

describe('Landeserkennung mit Wortgrenzen', () => {
  test('Teilwoerter treffen nicht mehr', () => {
    assert.equal(erkenneLand('Ich habe zwei Adressen'), null);
    assert.equal(erkenneLand('Ich habe es vergessen'), null);
    assert.equal(erkenneLand('Ich wohne in Essen')?.code, 'nw');
    assert.equal(erkenneLand('Ich bin nach Mainz gezogen, vorher wohnte ich in Köln')?.code, 'rp');
    assert.equal(erkenneLand('Was kostet ein Reisepass?'), null);
  });
});

describe('Normalisierung: Nummern, Bereiche, Englisch', () => {
  test('Telefonnummern und Aktenzeichen bleiben Ziffern, Jahreszahlen im Kontext werden Worte', () => {
    assert.equal(normalisiereFuerSprache('Telefon 0221 2010 0'), 'Telefon 0221 2010 0');
    assert.equal(normalisiereFuerSprache('Az. 12/2024'), 'Az. 12/2024');
    assert.equal(normalisiereFuerSprache('seit 2025 gilt'), 'seit zweitausendfünfundzwanzig gilt');
    assert.equal(normalisiereFuerSprache('Stand 2026-08.'), 'Stand August zweitausendsechsundzwanzig.');
  });

  test('Bereiche mit Strich werden "bis"', () => {
    assert.equal(normalisiereFuerSprache('Frist 10–14 Tage'), 'Frist 10 bis 14 Tage');
    assert.equal(normalisiereFuerSprache('5-15 Euro'), '5 bis 15 Euro');
  });

  test('englische Sprechfassung: Paragraf, Datum, Markdown', () => {
    assert.equal(normalisiereEnglisch('**Fee**: 70 €, § 4 Passgesetz, Stand 2026-08'), 'Fee: 70 euros, section 4 Passgesetz, as of August 2026');
    assert.equal(sprechfassung('§ 17 BMG', SPRACHEN.en), 'section 17 BMG');
  });
});
