/**
 * Datenbank-Zugriff mit austauschbarem Treiber.
 *
 * Ziel: dieselbe Anwendung laeuft gegen Neon (US-Firma, HTTP-Treiber) ODER
 * gegen jeden normalen PostgreSQL-Server (STACKIT, lokal, self-hosted) ueber
 * das uebliche Wire-Protokoll (node-postgres, `pg`). Der Treiber wird anhand
 * der Verbindungs-URL automatisch gewaehlt; erzwingen laesst er sich mit
 * DB_TREIBER=neon|pg.
 *
 * Einheitliche Schnittstelle: `query(text, params)` liefert IMMER ein Array
 * von Zeilen zurueck - egal welcher Treiber. So bleibt der aufrufende Code
 * (Gespraechslog, Import, Lese-Skript) treiberunabhaengig.
 *
 * TLS: Managed-Postgres (STACKIT u. a.) verlangt in der Regel TLS. Standard
 * hier ist TLS mit Zertifikatspruefung; abschaltbar per DB_SSL=disable oder
 * (Test) DB_SSL_NO_VERIFY=1, wenn die CA noch nicht hinterlegt ist.
 */

export function dbUrl() {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
}

export function datenbankKonfiguriert() {
  return Boolean(dbUrl());
}

function istNeon(url) {
  const erzwungen = (process.env.DB_TREIBER || '').toLowerCase();
  if (erzwungen === 'neon') return true;
  if (erzwungen === 'pg') return false;
  return /\.neon\.tech(?:[:/]|$)/i.test(url);
}

function sslOption(url) {
  if (process.env.DB_SSL === 'disable' || /[?&]sslmode=disable/i.test(url)) return false;
  return { rejectUnauthorized: !process.env.DB_SSL_NO_VERIFY };
}

let treiberPromise = null;

async function baueTreiber() {
  const url = dbUrl();
  if (!url) throw new Error('DATABASE_URL (oder NEON_DATABASE_URL) fehlt');

  if (istNeon(url)) {
    // Neon-HTTP-Treiber: laeuft auch hinter Proxys (HTTPS statt Wire-Protokoll).
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    return {
      art: 'neon',
      // neon.query() gibt bereits ein Zeilen-Array zurueck.
      query: (text, params = []) => sql.query(text, params),
    };
  }

  // Standard-PostgreSQL ueber node-postgres (Wire-Protokoll, Port 5432).
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, ssl: sslOption(url), max: 4 });
  return {
    art: 'pg',
    query: async (text, params = []) => (await pool.query(text, params)).rows,
  };
}

async function treiber() {
  if (!treiberPromise) treiberPromise = baueTreiber();
  return treiberPromise;
}

/** Fuehrt eine Abfrage aus und liefert die Zeilen als Array. */
export async function query(text, params = []) {
  const t = await treiber();
  return t.query(text, params);
}

/** Name des tatsaechlich verwendeten Treibers ('neon' | 'pg'). */
export async function treiberArt() {
  return (await treiber()).art;
}
