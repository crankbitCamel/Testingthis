#!/usr/bin/env node
/**
 * PVOG-Daten in die Datenbank uebernehmen.
 *
 *   npm run pvog:import              # aus data/pvog/pvog-paket.json.gz (im Repository)
 *   npm run pvog:import -- --dry-run # nur zaehlen, nichts schreiben
 *
 * Verbindung wie ueberall per DATABASE_URL (lokales Docker-Postgres, STACKIT
 * oder Neon - server/db.mjs waehlt den Treiber). Legt die Tabellen aus
 * db/pvog.sql an (idempotent), schreibt per Upsert in Bloecken und loescht
 * danach Zeilen, die im Paket nicht mehr vorkommen. Darf jederzeit erneut
 * laufen, z. B. nach einem neuen Abruf:
 *
 *   node scripts/pvog.mjs abrufen --top 200 && node scripts/pvog.mjs paket && npm run pvog:import
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paketLesen, PAKET } from './pvog.mjs';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const trocken = process.argv.includes('--dry-run');
const BLOCK = 200;

if (!existsSync(PAKET)) {
  console.error(`Paket fehlt: ${PAKET}\nErzeugen mit: node scripts/pvog.mjs abrufen --top 200 && node scripts/pvog.mjs paket`);
  process.exit(1);
}

const paket = await paketLesen();
const texte = Object.entries(paket.texte);
const zeilen = paket.saetze; // Zeilen mit wieder eingesetzten Textfeldern (u. a. gebuehren)
console.log(`Paket vom ${paket.erstellt}: ${zeilen.length} Leistungen in ${new Set(zeilen.map((z) => z.kommune.ars)).size} Kommunen, ${texte.length} Textbloecke`);

if (trocken) {
  const belegt = zeilen.filter((z) => (z.quellen?.[0]?.uri || z.onlineDienste?.[0]?.uri) && (z.freigabe?.datum || z.pvogStand)).length;
  console.log(`Probelauf: ${belegt} Zeilen waeren "belegt" (Quelle und Datum). Nichts geschrieben.`);
  process.exit(0);
}

const { query, datenbankKonfiguriert } = await import('../server/db.mjs');
if (!datenbankKonfiguriert()) {
  console.error('DATABASE_URL fehlt. Beispiel lokal (PowerShell):\n  $env:DATABASE_URL="postgres://verwaltung:verwaltung@localhost:5432/verwaltung?sslmode=disable"');
  process.exit(1);
}

// Schema anwenden (Kommentare entfernen, an ";" trennen).
const schema = readFileSync(join(WURZEL, 'db', 'pvog.sql'), 'utf8').replace(/--[^\n]*/g, '');
for (const statement of schema.split(';').map((s) => s.trim()).filter(Boolean)) await query(statement);

const beginn = (await query('SELECT now() AS t'))[0].t;

/** Mehrzeiliger Upsert: baut "($1,$2,...),($n,...)" fuer einen Block. */
async function upsert(tabelle, spalten, zeilenWerte, konflikt, typen = {}) {
  for (let i = 0; i < zeilenWerte.length; i += BLOCK) {
    const block = zeilenWerte.slice(i, i + BLOCK);
    const params = [];
    const tupel = block.map((werte) => `(${werte.map((w, j) => {
      params.push(w);
      return `$${params.length}${typen[spalten[j]] ?? ''}`;
    }).join(',')})`);
    const update = spalten.filter((s) => !konflikt.includes(s)).map((s) => `${s} = EXCLUDED.${s}`).join(', ');
    await query(
      `INSERT INTO ${tabelle} (${spalten.join(',')}) VALUES ${tupel.join(',')}
       ON CONFLICT (${konflikt.join(',')}) DO UPDATE SET ${update}`,
      params,
    );
    process.stdout.write(`\r  ${tabelle}: ${Math.min(i + BLOCK, zeilenWerte.length)}/${zeilenWerte.length}`);
  }
  process.stdout.write('\n');
}

await upsert('pvog_texte', ['id', 'daten'], texte.map(([id, d]) => [id, JSON.stringify(d)]), ['id'], { daten: '::jsonb' });

const spalten = ['ars', 'leistung_id', 'leika', 'kommune', 'bundesland', 'pvog_id', 'pvog_name', 'geltung', 'text_id',
  'gebuehr_betraege', 'gebuehr_strukturiert', 'online_dienste', 'zustaendig', 'quellen', 'quelle_url',
  'freigabe_stelle', 'freigabe_datum', 'pvog_stand', 'abgerufen', 'importiert'];
const typen = { gebuehr_betraege: '::numeric[]', online_dienste: '::jsonb', zustaendig: '::jsonb', quellen: '::jsonb', freigabe_datum: '::date', pvog_stand: '::timestamptz', abgerufen: '::timestamptz', importiert: '::timestamptz' };
await upsert('pvog_leistungen', spalten, zeilen.map((z) => [
  z.kommune.ars, z.leistungId, z.leika, z.kommune.name, z.kommune.bundesland ?? null, z.pvogId, z.pvogName ?? null,
  z.ebene ?? null, z.textId,
  (z.gebuehren?.betraegeEuro ?? []).map(Number), Boolean(z.gebuehren?.strukturiert),
  JSON.stringify(z.onlineDienste ?? []), JSON.stringify(z.zustaendig ?? []), JSON.stringify(z.quellen ?? []),
  z.quellen?.[0]?.uri ?? z.onlineDienste?.[0]?.uri ?? null,
  z.freigabe?.stelle ?? null, z.freigabe?.datum ?? null, z.pvogStand ?? null, z.abgerufen, beginn,
]), ['ars', 'leistung_id'], typen);

// Was im neuen Paket fehlt, ist veraltet: entfernen.
const alt = await query('DELETE FROM pvog_leistungen WHERE importiert < $1 RETURNING ars', [beginn]);
const verwaist = await query('DELETE FROM pvog_texte t WHERE NOT EXISTS (SELECT 1 FROM pvog_leistungen l WHERE l.text_id = t.id) RETURNING id');

const [stat] = await query(`SELECT count(*)::int AS zeilen, count(DISTINCT ars)::int AS kommunen,
  count(*) FILTER (WHERE belegt)::int AS belegt FROM pvog_auskunft`);
console.log(`Fertig: ${stat.zeilen} Zeilen, ${stat.kommunen} Kommunen, davon ${stat.belegt} mit Quelle und Datum.`);
console.log(`Entfernt: ${alt.length} veraltete Zeilen, ${verwaist.length} ungenutzte Textbloecke.`);
console.log('Probe: SELECT kommune, gebuehr_betraege, quelle_url, freigabe_datum FROM pvog_auskunft WHERE leistung_id = \'reisepass\' LIMIT 5;');
process.exit(0);
