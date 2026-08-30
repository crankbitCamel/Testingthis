# Datenbankschicht (Neon PostgreSQL)

Git bleibt die Quelle der Wahrheit: Wissen wird im Repository recherchiert,
reviewt und freigegeben. Die Datenbank ist die **Auslieferungsschicht** -
abfragbar, volltextindiziert (deutscher `tsvector`), mit Embedding-Slot
(`vector(1024)`, passend zu voyage-3) fuer die semantische Suche des RAG
(Retrieval-Augmented Generation - das LLM antwortet nur aus nachgeschlagenen
Wissensbausteinen, nie aus dem eigenen Gedaechtnis).

## Einrichtung in zwei Schritten

**1. Neon-Projekt anlegen** - eine der beiden Varianten:

- Selbst in der [Neon-Konsole](https://console.neon.tech) ein Projekt anlegen
  (Region z. B. Frankfurt `aws-eu-central-1`) und den Connection String kopieren, **oder**
- automatisch per API-Schluessel (console.neon.tech -> Account -> API keys):

  ```bash
  NEON_API_KEY="neon_api_..." npm run db:provision
  ```

  Das Skript ist idempotent (Projektname `verwaltungsassistent`) und gibt den
  Connection String aus.

**2. Wissensbasis importieren:**

```bash
DATABASE_URL="postgres://...neon.tech/neondb?sslmode=require" npm run db:import
```

Der Import baut zuerst den RAG-Korpus (`dist/chunks.jsonl`), wendet
`db/schema.sql` an und synchronisiert dann per Upsert: Cluster, Leistungen,
Landesschicht (NW/RP), Kommunen-Overlays und Chunks. Er ist **idempotent** -
jederzeit wiederholbar; verschwundene Zeilen werden in den regenerierbaren
Tabellen aufgeraeumt, bereits berechnete Embeddings bleiben erhalten.

Ohne `DATABASE_URL` (oder mit `--dry-run` / `npm run db:dry-run`) zeigt der
Import nur den Umfang und schreibt nichts.

## Tabellen

| Tabelle | Inhalt | Schluessel |
| --- | --- | --- |
| `cluster` | 12 Bereiche mit Grundsatzwissen | `id` |
| `leistungen` | Leistungen der Basis (JSONB komplett, Filterspalten GENERATED) | `id` |
| `regional` | Landesschicht: Registerprofile + Leistungs-Overlays | `id` wie `nw:leistung:hundesteuer` |
| `kommunen` | Kommunen-Overlays komplett (Stellen, Adressen, Terminlinks) | `ags` (8-stelliger Amtlicher Gemeindeschluessel) |
| `kommune_leistungen` | Ortskonkrete Werte einzeln, mit Status + Pruefdatum | `(ags, leistung_id)` |
| `chunks` | RAG-Korpus mit `tsvector` (deutsch) und `embedding vector(1024)` | `id` |

Die Sicht `kommune_leistungen_gueltig` liefert nur gepruefte/freigegebene und
nicht verfallene Eintraege (`geprueft_am + pruefintervall_monate >= heute`) -
die Laufzeit fragt ausschliesslich diese Sicht ab.

## Beispielabfragen

```sql
-- Volltextsuche im RAG-Korpus, auf NRW (oder bundesweit) eingeschraenkt:
SELECT id, text FROM chunks
WHERE tsv @@ websearch_to_tsquery('german', 'hundesteuer anmelden')
  AND (land = 'nw' OR land IS NULL)
LIMIT 5;

-- Gueltige ortskonkrete Gebuehren fuer Duesseldorf:
SELECT leistung_id, daten->'gebuehren'
FROM kommune_leistungen_gueltig WHERE ags = '05111000';

-- Was laeuft demnaechst ab und braucht eine Neupruefung?
SELECT ags, leistung_id, geprueft_am
FROM kommune_leistungen
WHERE geprueft_am + (pruefintervall_monate || ' months')::interval < now() + interval '2 months'
ORDER BY geprueft_am;
```
