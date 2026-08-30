#!/usr/bin/env node
/**
 * Gleicht eine externe Leistungsliste gegen die Wissensbasis ab.
 *
 * Genau der Schritt VOR jeder Extraktion: Erst wissen, was schon da ist,
 * was nur ortskonkrete Werte braucht und was komplett fehlt - dann erst
 * Arbeit investieren. Der Abgleich nutzt dieselbe Erkennung wie der Dialog;
 * was hier zugeordnet wird, versteht spaeter auch der Bot.
 *
 *   node scripts/leistungen-abgleich.mjs meine-liste.txt
 *   node scripts/leistungen-abgleich.mjs meine-liste.csv --json ergebnis.json
 *
 * Listenformat: eine Leistung je Zeile (Text oder CSV - dort zaehlt die
 * erste Spalte). Leerzeilen und mit # beginnende Zeilen werden ignoriert.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { verstehe, SCHWELLEN } from '../src/nlu.js';
import { LEISTUNG_BY_ID } from '../src/kb/index.js';
import { rechtsebene } from '../src/kb/ebenen.js';
import { registerbereichFuer, regional } from '../src/kb/regional/index.js';

const argumente = process.argv.slice(2);
const jsonIndex = argumente.indexOf('--json');
const jsonZiel = jsonIndex >= 0 ? argumente[jsonIndex + 1] : null;
const dateien = argumente.filter((a, i) => a !== '--json' && (jsonIndex < 0 || i !== jsonIndex + 1));

if (!dateien.length) {
  console.log('Aufruf: node scripts/leistungen-abgleich.mjs <liste.txt|liste.csv> [--json ergebnis.json]');
  process.exit(1);
}

/** Zerlegt die Eingabedatei in Leistungsbezeichnungen. */
function zeilenLesen(inhalt, dateiname) {
  return inhalt
    .split(/\r?\n/)
    .map((z) => (dateiname.endsWith('.csv') ? z.split(/[;,\t]/)[0] : z))
    .map((z) => z.replace(/^"|"$/g, '').trim())
    .filter((z) => z && !z.startsWith('#'));
}

/** Ordnet eine Bezeichnung der Wissensbasis zu. */
export function zuordnen(bezeichnung) {
  const analyse = verstehe(bezeichnung);
  const [t1, t2] = analyse.leistungTreffer;

  if (t1 && t1.score >= SCHWELLEN.leistungDirekt && (!t2 || t1.score >= t2.score * SCHWELLEN.vorsprung)) {
    return { status: 'vorhanden', id: t1.id, score: t1.score };
  }
  if (t1 && t1.score > 4) {
    return {
      status: 'unsicher',
      kandidaten: analyse.leistungTreffer.slice(0, 3).map((t) => ({ id: t.id, name: LEISTUNG_BY_ID[t.id].name, score: Number(t.score.toFixed(1)) })),
    };
  }
  return { status: 'fehlt' };
}

/** Was fuer eine vorhandene Leistung noch zu erfassen waere. */
function erfassungsbedarf(id) {
  const e = rechtsebene(id);
  const bedarf = [];
  if (e.ebene.id === 'bund') bedarf.push('Bundeswissen vollständig - nur Adresse/Terminlink je Kommune ergänzbar');
  if (e.ebene.id === 'land') {
    const laender = ['nw', 'rp'].filter((c) => regional(id, c)?.eintrag);
    bedarf.push(`Landeswerte nötig${laender.length ? ` (vorhanden: ${laender.map((c) => c.toUpperCase()).join(', ')})` : ' (noch keine hinterlegt)'}`);
  }
  if (e.ebene.id === 'kommune') bedarf.push('Ortskonkrete Werte je Kommune nötig (Kommunen-Overlay)');
  return bedarf.join('; ');
}

const bericht = { vorhanden: [], unsicher: [], fehlt: [], dubletten: [] };
const gesehen = new Map();

for (const datei of dateien) {
  const inhalt = await readFile(datei, 'utf8');
  for (const eintrag of zeilenLesen(inhalt, datei)) {
    const ergebnis = zuordnen(eintrag);
    if (ergebnis.status === 'vorhanden') {
      if (gesehen.has(ergebnis.id)) {
        bericht.dubletten.push({ eingabe: eintrag, gleicheLeistungWie: gesehen.get(ergebnis.id), id: ergebnis.id });
        continue;
      }
      gesehen.set(ergebnis.id, eintrag);
      const l = LEISTUNG_BY_ID[ergebnis.id];
      bericht.vorhanden.push({
        eingabe: eintrag,
        id: ergebnis.id,
        name: l.name,
        registerbereich: registerbereichFuer(ergebnis.id)?.name ?? null,
        rechtsebene: rechtsebene(ergebnis.id).ebene.id,
        erfassungsbedarf: erfassungsbedarf(ergebnis.id),
      });
    } else if (ergebnis.status === 'unsicher') {
      bericht.unsicher.push({ eingabe: eintrag, kandidaten: ergebnis.kandidaten });
    } else {
      bericht.fehlt.push({ eingabe: eintrag });
    }
  }
}

// --- Ausgabe -----------------------------------------------------------------
const b = bericht;
console.log(`Abgleich gegen ${Object.keys(LEISTUNG_BY_ID).length} Leistungen der Wissensbasis`);
console.log('='.repeat(70));

if (b.vorhanden.length) {
  console.log(`\nVORHANDEN (${b.vorhanden.length}) - keine Neuerfassung nötig:`);
  for (const e of b.vorhanden) {
    console.log(`  ✓ ${e.eingabe}`);
    console.log(`      → ${e.id} (${e.rechtsebene}) · ${e.erfassungsbedarf}`);
  }
}
if (b.unsicher.length) {
  console.log(`\nUNSICHER (${b.unsicher.length}) - bitte Kandidaten prüfen:`);
  for (const e of b.unsicher) {
    console.log(`  ? ${e.eingabe}`);
    for (const k of e.kandidaten) console.log(`      vielleicht: ${k.id} "${k.name}" (${k.score})`);
  }
}
if (b.fehlt.length) {
  console.log(`\nFEHLT (${b.fehlt.length}) - Neuerfassung nach schema/leistung.schema.json:`);
  for (const e of b.fehlt) console.log(`  ✗ ${e.eingabe}`);
}
if (b.dubletten.length) {
  console.log(`\nDUBLETTEN in Ihrer Liste (${b.dubletten.length}):`);
  for (const e of b.dubletten) console.log(`  = "${e.eingabe}" meint dasselbe wie "${e.gleicheLeistungWie}" (${e.id})`);
}

console.log(`\nBilanz: ${b.vorhanden.length} vorhanden · ${b.unsicher.length} unsicher · ${b.fehlt.length} fehlen · ${b.dubletten.length} Dubletten`);

if (jsonZiel) {
  await writeFile(jsonZiel, JSON.stringify(bericht, null, 2), 'utf8');
  console.log(`JSON-Bericht: ${jsonZiel}`);
}
