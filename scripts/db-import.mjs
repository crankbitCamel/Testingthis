#!/usr/bin/env node
/**
 * Import der Wissensbasis in eine Neon-PostgreSQL-Datenbank.
 *
 * Prinzip: Git ist die Quelle der Wahrheit, die Datenbank die Auslieferungs-
 * schicht. Dieser Import ist deshalb idempotent - er darf jederzeit erneut
 * laufen und synchronisiert den Repository-Stand per Upsert drueber. Zeilen,
 * die im Repository nicht mehr existieren, werden in den regenerierbaren
 * Tabellen (chunks, regional, kommune_leistungen) aufgeraeumt; vorhandene
 * Embeddings in chunks bleiben beim Upsert unangetastet.
 *
 * Aufruf:
 *   DATABASE_URL="postgres://..." node scripts/db-import.mjs
 *   node scripts/db-import.mjs --dry-run     (zeigt nur, was importiert wuerde)
 *
 * Die Verbindungs-URL kommt aus DATABASE_URL oder NEON_DATABASE_URL
 * (der Connection String aus der Neon-Konsole bzw. scripts/neon-provision.mjs).
 * Der HTTP-Treiber (@neondatabase/serverless) laeuft auch hinter Proxys,
 * weil er ueber HTTPS statt ueber das PostgreSQL-Wire-Protokoll spricht.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEISTUNGEN, CLUSTER } from '../src/kb/index.js';
import { LAENDER_LISTE } from '../src/kb/regional/index.js';
import { rechtsebene } from '../src/kb/ebenen.js';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const trocken = process.argv.includes('--dry-run');
const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';

// ---------------------------------------------------------------- Sammeln --
// Erst alles aus dem Repository einsammeln, dann in einem Rutsch schreiben.

const clusterZeilen = CLUSTER.map((c) => ({ id: c.id, name: c.name, daten: c }));

const leistungZeilen = LEISTUNGEN.map((l) => ({
  id: l.id,
  cluster_id: l.cluster,
  name: l.name,
  rechtsebene: rechtsebene(l.id).ebene,
  daten: l,
}));

const regionalZeilen = [];
for (const land of LAENDER_LISTE) {
  for (const [bereichId, profil] of Object.entries(land.registerprofile)) {
    regionalZeilen.push({
      id: `${land.code}:bereich:${bereichId}`,
      land: land.code, typ: 'registerprofil',
      bereich_id: bereichId, leistung_id: null,
      daten: profil, stand: land.stand,
    });
  }
  for (const [leistungId, eintrag] of Object.entries(land.leistungen)) {
    regionalZeilen.push({
      id: `${land.code}:leistung:${leistungId}`,
      land: land.code, typ: 'leistungsoverlay',
      bereich_id: null, leistung_id: leistungId,
      daten: eintrag, stand: eintrag.stand ?? land.stand,
    });
  }
}

const kommuneZeilen = [];
const kommuneLeistungZeilen = [];
const kommunenVerzeichnis = join(WURZEL, 'beispiele', 'kommunen');
if (existsSync(kommunenVerzeichnis)) {
  for (const datei of readdirSync(kommunenVerzeichnis).filter((d) => d.endsWith('.json')).sort()) {
    const k = JSON.parse(readFileSync(join(kommunenVerzeichnis, datei), 'utf8'));
    kommuneZeilen.push({ ags: k.ags, name: k.name, land: k.land, stand: k.stand, daten: k });
    for (const [leistungId, eintrag] of Object.entries(k.leistungen ?? {})) {
      kommuneLeistungZeilen.push({
        ags: k.ags,
        leistung_id: leistungId,
        status: eintrag.status ?? 'entwurf',
        geprueft_am: eintrag.quelle?.geprueftAm ?? null,
        pruefintervall_monate: eintrag.quelle?.pruefintervallMonate ?? 12,
        daten: eintrag,
      });
    }
  }
}

const chunkPfad = join(WURZEL, 'dist', 'chunks.jsonl');
let chunkZeilen = [];
if (existsSync(chunkPfad)) {
  chunkZeilen = readFileSync(chunkPfad, 'utf8')
    .split('\n').filter(Boolean)
    .map((zeile) => JSON.parse(zeile))
    .map((c) => ({ id: c.id, typ: c.typ, text: c.text, meta: c.meta ?? {} }));
}

const zusammenfassung = [
  ['cluster', clusterZeilen.length],
  ['leistungen', leistungZeilen.length],
  ['regional (Landesschicht)', regionalZeilen.length],
  ['kommunen', kommuneZeilen.length],
  ['kommune_leistungen', kommuneLeistungZeilen.length],
  ['chunks (RAG-Korpus)', chunkZeilen.length],
];

console.log('Import-Umfang aus dem Repository:');
for (const [name, anzahl] of zusammenfassung) console.log(`  ${String(anzahl).padStart(4)}  ${name}`);
if (!chunkZeilen.length) {
  console.log('  Hinweis: dist/chunks.jsonl fehlt oder ist leer - vorher "npm run build:chunks" ausfuehren.');
}

if (trocken || !url) {
  if (!trocken && !url) {
    console.log('\nKeine Datenbank-URL gesetzt (DATABASE_URL oder NEON_DATABASE_URL) - Probelauf.');
    console.log('Connection String aus der Neon-Konsole kopieren oder scripts/neon-provision.mjs nutzen.');
  } else {
    console.log('\nProbelauf (--dry-run): es wurde nichts geschrieben.');
  }
  process.exit(0);
}

// -------------------------------------------------------------- Schreiben --
const { neon } = await import('@neondatabase/serverless');
const sql = neon(url);
const j = (wert) => JSON.stringify(wert);

// Schema anwenden: Statement fuer Statement, damit ein Fehlschlag der
// pgvector-Extension den Rest nicht mitreisst (dann ohne Embedding-Spalte).
let vektorVerfuegbar = true;
const schemaText = readFileSync(join(WURZEL, 'db', 'schema.sql'), 'utf8');
const statements = schemaText.split(';').map((s) => s.trim()).filter((s) => s.replace(/^--.*$/gm, '').trim());
for (let statement of statements) {
  if (!vektorVerfuegbar) statement = statement.replace(/^\s*embedding\s+vector\(\d+\),\s*$/m, '');
  try {
    await sql.query(statement);
  } catch (fehler) {
    if (/CREATE EXTENSION/i.test(statement) && /vector/i.test(statement)) {
      vektorVerfuegbar = false;
      console.log('  Hinweis: pgvector nicht verfuegbar - chunks werden ohne Embedding-Spalte angelegt.');
      continue;
    }
    throw new Error(`Schema-Statement fehlgeschlagen:\n${statement}\n-> ${fehler.message}`);
  }
}
console.log(`\nSchema angewendet (${statements.length} Statements).`);

// Zeitmarke der Datenbank VOR den Upserts: alles, was danach nicht
// aktualisiert wurde, existiert im Repository nicht mehr und wird geraeumt.
const [{ now: beginn }] = await sql.query('SELECT now()');

for (const z of clusterZeilen) {
  await sql.query(
    `INSERT INTO cluster (id, name, daten) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, daten = EXCLUDED.daten, aktualisiert = now()`,
    [z.id, z.name, j(z.daten)],
  );
}
for (const z of leistungZeilen) {
  await sql.query(
    `INSERT INTO leistungen (id, cluster_id, name, rechtsebene, daten) VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET cluster_id = EXCLUDED.cluster_id, name = EXCLUDED.name,
       rechtsebene = EXCLUDED.rechtsebene, daten = EXCLUDED.daten, aktualisiert = now()`,
    [z.id, z.cluster_id, z.name, z.rechtsebene, j(z.daten)],
  );
}
for (const z of regionalZeilen) {
  await sql.query(
    `INSERT INTO regional (id, land, typ, bereich_id, leistung_id, daten, stand)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (id) DO UPDATE SET land = EXCLUDED.land, typ = EXCLUDED.typ,
       bereich_id = EXCLUDED.bereich_id, leistung_id = EXCLUDED.leistung_id,
       daten = EXCLUDED.daten, stand = EXCLUDED.stand, aktualisiert = now()`,
    [z.id, z.land, z.typ, z.bereich_id, z.leistung_id, j(z.daten), z.stand],
  );
}
for (const z of kommuneZeilen) {
  await sql.query(
    `INSERT INTO kommunen (ags, name, land, stand, daten) VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (ags) DO UPDATE SET name = EXCLUDED.name, land = EXCLUDED.land,
       stand = EXCLUDED.stand, daten = EXCLUDED.daten, aktualisiert = now()`,
    [z.ags, z.name, z.land, z.stand, j(z.daten)],
  );
}
for (const z of kommuneLeistungZeilen) {
  await sql.query(
    `INSERT INTO kommune_leistungen (ags, leistung_id, status, geprueft_am, pruefintervall_monate, daten)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (ags, leistung_id) DO UPDATE SET status = EXCLUDED.status,
       geprueft_am = EXCLUDED.geprueft_am, pruefintervall_monate = EXCLUDED.pruefintervall_monate,
       daten = EXCLUDED.daten, aktualisiert = now()`,
    [z.ags, z.leistung_id, z.status, z.geprueft_am, z.pruefintervall_monate, j(z.daten)],
  );
}

// Chunks gebuendelt (je 100), sonst dauern 800 einzelne HTTP-Roundtrips lange.
// Das Embedding wird beim Upsert bewusst NICHT ueberschrieben - einmal
// berechnete Vektoren ueberleben so jeden Re-Import unveraenderter Texte.
const PAKET = 100;
for (let i = 0; i < chunkZeilen.length; i += PAKET) {
  const paket = chunkZeilen.slice(i, i + PAKET);
  const platzhalter = paket.map((_, n) => `($${n * 4 + 1}, $${n * 4 + 2}, $${n * 4 + 3}, $${n * 4 + 4}::jsonb)`);
  const werte = paket.flatMap((c) => [c.id, c.typ, c.text, j(c.meta)]);
  await sql.query(
    `INSERT INTO chunks (id, typ, text, meta) VALUES ${platzhalter.join(', ')}
     ON CONFLICT (id) DO UPDATE SET typ = EXCLUDED.typ, text = EXCLUDED.text,
       meta = EXCLUDED.meta, aktualisiert = now()`,
    werte,
  );
}

// Aufraeumen: nur die regenerierbaren Tabellen. Stammtabellen (cluster,
// leistungen, kommunen) werden nie automatisch geleert - eine im Repository
// entfernte Leistung soll bewusst per Hand aus der Datenbank verschwinden.
const geraeumt = {};
for (const tabelle of ['chunks', 'kommune_leistungen', 'regional']) {
  const ergebnis = await sql.query(`DELETE FROM ${tabelle} WHERE aktualisiert < $1 RETURNING 1`, [beginn]);
  geraeumt[tabelle] = ergebnis.length;
}

const [{ gueltig }] = await sql.query('SELECT count(*)::int AS gueltig FROM kommune_leistungen_gueltig');
console.log('Import abgeschlossen:');
for (const [name, anzahl] of zusammenfassung) console.log(`  ${String(anzahl).padStart(4)}  ${name}`);
console.log(`  Aufgeraeumt (nicht mehr im Repository): chunks ${geraeumt.chunks}, kommune_leistungen ${geraeumt.kommune_leistungen}, regional ${geraeumt.regional}`);
console.log(`  Sicht kommune_leistungen_gueltig liefert aktuell ${gueltig} ortskonkrete Eintraege.`);
