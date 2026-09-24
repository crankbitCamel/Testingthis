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
      // Spaeter ergaenzte Spalte - idempotent auch fuer bestehende Tabellen.
      await query('ALTER TABLE gespraeche ADD COLUMN IF NOT EXISTS sprache text');
      // Nachweis der Einwilligung (Art. 7 DSGVO): wann und mit welchem Wortlaut.
      await query('ALTER TABLE gespraeche ADD COLUMN IF NOT EXISTS einwilligung_zeit timestamptz');
      await query('ALTER TABLE gespraeche ADD COLUMN IF NOT EXISTS einwilligung_text text');
      await query('CREATE INDEX IF NOT EXISTS gespraeche_call_idx ON gespraeche (call_sid, zeit)');
      await query('CREATE INDEX IF NOT EXISTS gespraeche_zeit_idx ON gespraeche (zeit DESC)');
    })().catch((fehler) => {
      // Fehlschlag nicht dauerhaft merken: beim naechsten Eintrag erneut versuchen,
      // sonst bliebe das Protokoll nach einem fruehen DB-Ausfall bis zum Neustart tot.
      schemaPromise = null;
      throw fehler;
    });
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
         (call_sid, kanal, land, frage, antwort, modus, modell, confidence, quellen, werkzeuge, dauer_ms, beendet, sprache,
          einwilligung_zeit, einwilligung_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15)`,
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
        e.sprache ?? null,
        e.einwilligungZeit ? new Date(e.einwilligungZeit) : null,
        e.einwilligungText ?? null,
      ],
    );
  } catch (fehler) {
    console.warn('  [protokoll] Gespraech nicht gespeichert:', fehler.message);
  }
}

/** Gesundheitspruefung: Schema da und Datenbank antwortet (max. 2 s). */
export async function datenbankPruefen() {
  if (!datenbankKonfiguriert()) return { konfiguriert: false, ok: true };
  try {
    await Promise.race([
      schemaSicherstellen().then(() => query('SELECT 1')),
      new Promise((_, ablehnen) => setTimeout(() => ablehnen(new Error('Zeitueberschreitung')), 2000).unref()),
    ]);
    return { konfiguriert: true, ok: true };
  } catch (fehler) {
    return { konfiguriert: true, ok: false, fehler: fehler.message };
  }
}

/**
 * Widerruf: alle Zeilen eines Anrufs loeschen (Anrufer drueckt waehrend des
 * Gespraechs die Taste fuer den Widerruf). Liefert die Anzahl geloeschter
 * Zeilen; Fehler werden geloggt, nie geworfen.
 */
export async function protokollLoeschen(callSid) {
  if (!datenbankKonfiguriert() || !callSid) return 0;
  try {
    await schemaSicherstellen();
    const rows = await query('DELETE FROM gespraeche WHERE call_sid = $1 RETURNING id', [callSid]);
    return rows.length;
  } catch (fehler) {
    console.warn('  [protokoll] Widerruf nicht ausgefuehrt:', fehler.message);
    return -1;
  }
}

/** Loeschfrist: Eintraege aelter als `tage` Tage entfernen. */
export async function protokollAufraeumen(tage = Number(process.env.PROTOKOLL_TAGE ?? 90)) {
  if (!datenbankKonfiguriert() || !(tage > 0)) return 0;
  try {
    await schemaSicherstellen();
    const rows = await query("DELETE FROM gespraeche WHERE zeit < now() - ($1::int * interval '1 day') RETURNING id", [Math.floor(tage)]);
    if (rows.length) console.log(`  [protokoll] Loeschfrist: ${rows.length} Eintraege aelter als ${tage} Tage entfernt`);
    return rows.length;
  } catch (fehler) {
    console.warn('  [protokoll] Loeschlauf fehlgeschlagen:', fehler.message);
    return -1;
  }
}

/**
 * Taeglichen Loeschlauf im Prozess einplanen (kein Cron noetig). Laeuft kurz
 * nach dem Start und dann alle 24 Stunden; blockiert das Beenden nicht.
 */
export function aufraeumenPlanen() {
  if (!datenbankKonfiguriert()) return null;
  const tage = Number(process.env.PROTOKOLL_TAGE ?? 90);
  if (!(tage > 0)) return null;
  setTimeout(() => protokollAufraeumen(tage), 30_000).unref();
  const t = setInterval(() => protokollAufraeumen(tage), 24 * 60 * 60 * 1000);
  t.unref();
  return t;
}
