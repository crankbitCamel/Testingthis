-- Datenbankschema des Verwaltungsassistenten (PostgreSQL / Neon)
--
-- Architekturentscheidung: Git bleibt die Quelle der Wahrheit - dort wird
-- reviewt, versioniert und freigegeben. Die Datenbank ist die AUSLIEFERUNGS-
-- schicht: abfragbar, filterbar, volltextindiziert, embeddingfaehig. Der
-- Import (scripts/db-import.mjs) ist deshalb idempotent und darf jederzeit
-- den Stand aus dem Repository druebersynchronisieren.
--
-- Speicherprinzip: Die JSONs wandern unveraendert in JSONB-Spalten; die
-- Felder, nach denen gefiltert wird (Ebene, Land, Status, Stand), liegen
-- daneben als echte Spalten - teils GENERATED aus dem JSONB, damit sie nie
-- auseinanderlaufen koennen.

-- pgvector fuer spaetere Embeddings (auf Neon verfuegbar); schlaegt die
-- Extension fehl, laeuft der Rest ohne Vektorspalte weiter.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS cluster (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  daten         jsonb NOT NULL,
  aktualisiert  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leistungen (
  id            text PRIMARY KEY,
  cluster_id    text NOT NULL REFERENCES cluster(id),
  name          text NOT NULL,
  rechtsebene   text NOT NULL CHECK (rechtsebene IN ('bund','land','kommune')),
  belastbarkeit text GENERATED ALWAYS AS (daten->'belastbarkeit'->>'quelle') STORED,
  stand         text GENERATED ALWAYS AS (daten->>'stand') STORED,
  daten         jsonb NOT NULL,
  aktualisiert  timestamptz NOT NULL DEFAULT now()
);

-- Landesschicht: Registerprofile und Leistungs-Overlays in einer Tabelle,
-- unterschieden ueber typ; die id ist sprechend ('nw:leistung:hundesteuer').
CREATE TABLE IF NOT EXISTS regional (
  id            text PRIMARY KEY,
  land          text NOT NULL CHECK (land ~ '^[a-z]{2}$'),
  typ           text NOT NULL CHECK (typ IN ('registerprofil','leistungsoverlay')),
  bereich_id    text,
  leistung_id   text REFERENCES leistungen(id),
  daten         jsonb NOT NULL,
  stand         text,
  aktualisiert  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kommunen (
  ags           text PRIMARY KEY CHECK (ags ~ '^[0-9]{8}$'),
  name          text NOT NULL,
  land          text NOT NULL,
  stand         text NOT NULL,
  daten         jsonb NOT NULL,          -- vollstaendiges Overlay inkl. Stellen
  aktualisiert  timestamptz NOT NULL DEFAULT now()
);

-- Ortskonkrete Leistungswerte einzeln adressierbar, inkl. Verfallslogik.
CREATE TABLE IF NOT EXISTS kommune_leistungen (
  ags           text NOT NULL REFERENCES kommunen(ags) ON DELETE CASCADE,
  leistung_id   text NOT NULL REFERENCES leistungen(id),
  status        text NOT NULL CHECK (status IN ('entwurf','geprueft','freigegeben')),
  geprueft_am   date,
  pruefintervall_monate integer DEFAULT 12,
  daten         jsonb NOT NULL,
  aktualisiert  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ags, leistung_id)
);

-- RAG-Korpus mit deutschem Volltextindex und Embedding-Slot (voyage-3: 1024).
CREATE TABLE IF NOT EXISTS chunks (
  id            text PRIMARY KEY,
  typ           text NOT NULL,
  text          text NOT NULL,
  meta          jsonb NOT NULL,
  ebene         text GENERATED ALWAYS AS (meta->>'ebene') STORED,
  land          text GENERATED ALWAYS AS (meta->>'land') STORED,
  leistung_id   text GENERATED ALWAYS AS (meta->>'leistung') STORED,
  ags           text GENERATED ALWAYS AS (meta->>'ags') STORED,
  stand         text GENERATED ALWAYS AS (meta->>'stand') STORED,
  tsv           tsvector GENERATED ALWAYS AS (to_tsvector('german', text)) STORED,
  embedding     vector(1024),
  aktualisiert  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_tsv_idx      ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_land_idx     ON chunks (land);
CREATE INDEX IF NOT EXISTS chunks_leistung_idx ON chunks (leistung_id);
CREATE INDEX IF NOT EXISTS chunks_ags_idx      ON chunks (ags);
CREATE INDEX IF NOT EXISTS kommune_leistungen_status_idx ON kommune_leistungen (status);

-- Sichten fuer die Auslieferung: nur freigabefaehiges, nicht verfallenes
-- Ortswissen erreicht Abfragen der Laufzeit.
CREATE OR REPLACE VIEW kommune_leistungen_gueltig AS
SELECT *
FROM kommune_leistungen
WHERE status IN ('geprueft','freigegeben')
  AND (geprueft_am IS NULL
       OR geprueft_am + (COALESCE(pruefintervall_monate,12) || ' months')::interval >= now());
