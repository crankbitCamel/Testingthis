-- PVOG-Leistungsbeschreibungen je Kommune (scripts/pvog-import.mjs).
--
-- Zwei Tabellen, weil sich Bundes- und Landestexte je Kommune wiederholen:
--   pvog_texte       ein Textblock (Unterlagen, Gebuehren, Fristen ...) einmal
--   pvog_leistungen  eine Zeile je Kommune und Leistung, verweist auf den Text
-- Die Sicht pvog_auskunft setzt beides zusammen - so fragt der Assistent ab.
--
-- Laufzeitdaten aus dem PVOG, nicht aus Git: der Import ersetzt den Bestand
-- vollstaendig (Upsert, danach nicht mehr gelieferte Zeilen loeschen).

CREATE TABLE IF NOT EXISTS pvog_texte (
  id     text PRIMARY KEY,                 -- Inhalts-Hash
  daten  jsonb NOT NULL                    -- kurzinfo, unterlagen, gebuehren, fristen, ...
);

CREATE TABLE IF NOT EXISTS pvog_leistungen (
  ars               text NOT NULL,         -- Regionalschluessel der Kommune
  leistung_id       text NOT NULL,         -- ID der Wissensbasis ('reisepass')
  leika             text NOT NULL,         -- 14-stelliger LeiKa-Schluessel
  kommune           text NOT NULL,
  bundesland        text,
  pvog_id           text NOT NULL,
  pvog_name         text,
  geltung           text,                  -- bundesweit | landesweit | kommunal
  text_id           text NOT NULL REFERENCES pvog_texte (id),
  gebuehr_betraege  numeric[] NOT NULL DEFAULT '{}',
  gebuehr_strukturiert boolean NOT NULL DEFAULT false,
  online_dienste    jsonb NOT NULL DEFAULT '[]',
  zustaendig        jsonb NOT NULL DEFAULT '[]',
  quellen           jsonb NOT NULL DEFAULT '[]',
  quelle_url        text,                  -- erste Quelle oder Online-Dienst der Stadt
  freigabe_stelle   text,
  freigabe_datum    date,
  pvog_stand        timestamptz,
  abgerufen         timestamptz NOT NULL,
  importiert        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ars, leistung_id)
);

CREATE INDEX IF NOT EXISTS pvog_leistungen_leistung_idx ON pvog_leistungen (leistung_id);
CREATE INDEX IF NOT EXISTS pvog_leistungen_kommune_idx ON pvog_leistungen (lower(kommune));

-- Abfrage fuer den Assistenten: alles zu einer Leistung in einer Kommune.
-- "belegt" ist die Regel "ohne Quelle keine Zahl": nur dann darf eine
-- Gebuehr genannt werden.
CREATE OR REPLACE VIEW pvog_auskunft AS
SELECT l.ars, l.kommune, l.bundesland, l.leistung_id, l.leika, l.pvog_name, l.geltung,
       t.daten->>'kurzinfo'          AS kurzinfo,
       t.daten->>'voraussetzungen'   AS voraussetzungen,
       t.daten->>'unterlagen'        AS unterlagen,
       t.daten->'gebuehren'->>'text' AS gebuehr_text,
       t.daten->'gebuehren'->'details' AS gebuehr_details,
       l.gebuehr_betraege,
       t.daten->>'fristen'           AS fristen,
       t.daten->>'bearbeitungsdauer' AS bearbeitungsdauer,
       t.daten->>'ablauf'            AS ablauf,
       t.daten->'rechtsgrundlagen'   AS rechtsgrundlagen,
       l.online_dienste, l.zustaendig, l.quelle_url,
       l.freigabe_stelle, l.freigabe_datum, l.pvog_stand, l.abgerufen,
       (l.quelle_url IS NOT NULL AND COALESCE(l.freigabe_datum::timestamptz, l.pvog_stand) IS NOT NULL) AS belegt
FROM pvog_leistungen l
JOIN pvog_texte t ON t.id = l.text_id;
