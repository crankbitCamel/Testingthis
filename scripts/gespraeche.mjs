#!/usr/bin/env node
/**
 * Zeigt die zuletzt protokollierten Gespraeche aus der Neon-Datenbank -
 * fuer schnelles Fact-Checking ohne SQL-Konsole.
 *
 * Aufruf:
 *   DATABASE_URL="postgres://..." node scripts/gespraeche.mjs [--limit 20] [--call CAxxxx] [--json]
 *
 * Ohne --call werden die neuesten Runden ueber alle Anrufe gezeigt; mit
 * --call nur die eines Anrufs (in zeitlicher Reihenfolge). --json gibt die
 * Rohdaten aus, sonst eine lesbare Zusammenfassung samt Quellen.
 */

const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
if (!url) {
  console.error('DATABASE_URL (oder NEON_DATABASE_URL) fehlt. Connection String aus der Neon-Konsole setzen:');
  console.error('  DATABASE_URL="postgres://..." node scripts/gespraeche.mjs');
  process.exit(1);
}

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};
const limit = Math.max(1, Math.min(500, Number(arg('limit', '20')) || 20));
const callSid = arg('call', null);
const alsJson = process.argv.includes('--json');

const { neon } = await import('@neondatabase/serverless');
const sql = neon(url);

// Existiert die Tabelle noch nicht, ist einfach nichts protokolliert worden.
const [{ da }] = await sql.query("SELECT to_regclass('public.gespraeche') IS NOT NULL AS da");
if (!da) {
  console.log('Noch keine Gespraeche protokolliert (Tabelle "gespraeche" existiert nicht).');
  process.exit(0);
}

const zeilen = callSid
  ? await sql.query('SELECT * FROM gespraeche WHERE call_sid = $1 ORDER BY zeit ASC LIMIT $2', [callSid, limit])
  : await sql.query('SELECT * FROM gespraeche ORDER BY zeit DESC LIMIT $1', [limit]);

if (alsJson) {
  console.log(JSON.stringify(zeilen, null, 2));
  process.exit(0);
}

if (!zeilen.length) {
  console.log('Keine Eintraege gefunden.');
  process.exit(0);
}

const quellenText = (q) => {
  if (!Array.isArray(q) || !q.length) return '-';
  return q.map((x) => (typeof x === 'string' ? x : (x?.id || x?.leistung || x?.titel || JSON.stringify(x)))).join(', ');
};

console.log(`\n${zeilen.length} Gespraechsrunde(n)${callSid ? ` fuer ${callSid}` : ''}:\n`);
for (const z of zeilen) {
  const zeit = new Date(z.zeit).toLocaleString('de-DE');
  const meta = [z.kanal, z.land || '—', z.modus || '—', z.modell || '', z.dauer_ms != null ? `${z.dauer_ms} ms` : '',
    z.confidence != null ? `conf ${Number(z.confidence).toFixed(2)}` : '']
    .filter(Boolean).join(' · ');
  console.log('─'.repeat(72));
  console.log(`${zeit}  [${meta}]${z.call_sid ? `  ${z.call_sid}` : ''}`);
  console.log(`  Frage:   ${z.frage}`);
  console.log(`  Antwort: ${z.antwort}`);
  console.log(`  Quellen: ${quellenText(z.quellen)}`);
  if (z.beendet) console.log('  (Gespraech beendet)');
}
console.log('─'.repeat(72));
