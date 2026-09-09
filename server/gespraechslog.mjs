/**
 * Gespraechsprotokoll: schreibt jede Frage-Antwort-Runde (Telefon und Browser)
 * in die Datenbank, samt der vom Modell genutzten Quellen. Zweck ist das
 * nachtraegliche Fact-Checking: Was wurde gefragt, was geantwortet, worauf
 * stuetzte sich die Antwort, wie lange hat sie gedauert.
 *
 * Grundsaetze:
 *  - OPTIONAL: Ohne DATABASE_URL/NEON_DATABASE_URL passiert gar nichts.
 *  - NIE STOEREND: Ein Datenbankfehler wird geschluckt und protokolliert, aber
 *    niemals nach aussen geworfen - ein Anruf darf daran nicht scheitern.
 *  - TREIBERUNABHAENGIG: laeuft ueber server/db.mjs gegen Neon ODER jeden
 *    normalen PostgreSQL-Server (STACKIT, lokal, self-hosted).
 */
import { query, datenbankKonfiguriert } from './db.mjs';

let schemaPromise = null; // Tabelle wird einmalig sichergestellt

/** True, wenn ein Connection String gesetzt ist - sonst ist das Log inaktiv. */
export function protokollAktiv() {
  return datenbankKonfiguriert();
}

// Legt die Tabelle bei Bedarf an, damit das Log auch ohne vorherigen
// `npm run db:import` funktioniert. Idempotent (CREATE TABLE IF NOT EXISTS).
async function schemaSicherstellen() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS gespraeche (
          id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          call_sid   text,
          kanal      text NOT NULL,
          zeit       timestamptz NOT NULL DEFAULT now(),
          land       text,
          frage      text NOT NULL,
          antwort    text NOT NULL,
          modus      text,
          modell     text,
          confidence real,
          quellen    jsonb NOT NULL DEFAULT '[]',
          werkzeuge  jsonb NOT NULL DEFAULT '[]',
          dauer_ms   integer,
          beendet    boolean NOT NULL DEFAULT false
        )`);
      await query('CREATE INDEX IF NOT EXISTS gespraeche_call_idx ON gespraeche (call_sid, zeit)');
      await query('CREATE INDEX IF NOT EXISTS gespraeche_zeit_idx ON gespraeche (zeit DESC)');
    })();
  }
  return schemaPromise;
}

/**
 * Schreibt eine Runde ins Log. Bewusst "fire and forget": Aufrufer muessen
 * nicht awaiten. Fehler landen als Warnung im Log, nicht beim Anrufer.
 *
 * @param {object} e
 * @param {string} [e.callSid]   Twilio-CallSid (Telefon)
 * @param {string} [e.kanal]     'telefon' | 'browser'
 * @param {string} [e.land]      erkanntes Bundesland
 * @param {string}  e.frage      Nutzeraeusserung
 * @param {string}  e.antwort    Antworttext
 * @param {string} [e.modus]     'llm' | 'mock'
 * @param {string} [e.modell]    Modellname
 * @param {number} [e.confidence] Twilio-Erkennungssicherheit 0..1
 * @param {Array}  [e.quellen]   genutzte Quellen/Chunks
 * @param {Array}  [e.werkzeuge] aufgerufene Tools
 * @param {number} [e.dauerMs]   Antwortlatenz in ms
 * @param {boolean}[e.beendet]   Runde beendete das Gespraech
 */
export async function protokolliere(e = {}) {
  if (!datenbankKonfiguriert()) return;
  try {
    await schemaSicherstellen();
    await query(
      `INSERT INTO gespraeche
         (call_sid, kanal, land, frage, antwort, modus, modell, confidence, quellen, werkzeuge, dauer_ms, beendet)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
      [
        e.callSid ?? null,
        e.kanal ?? 'telefon',
        e.land ?? null,
        String(e.frage ?? ''),
        String(e.antwort ?? ''),
        e.modus ?? null,
        e.modell ?? null,
        Number.isFinite(e.confidence) ? e.confidence : null,
        JSON.stringify(e.quellen ?? []),
        JSON.stringify(e.werkzeuge ?? []),
        Number.isInteger(e.dauerMs) ? e.dauerMs : null,
        Boolean(e.beendet),
      ],
    );
  } catch (fehler) {
    console.warn('  [protokoll] Gespraech nicht gespeichert:', fehler.message);
  }
}
