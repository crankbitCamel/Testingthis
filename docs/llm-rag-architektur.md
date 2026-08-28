# LLM + RAG für den Verwaltungsassistenten

Dieses Dokument beantwortet drei Fragen: Was braucht ein **belastbares RAG** im
Verwaltungskontext, wie funktioniert die **Rechtsebenen-Klärung** (Bund / Land /
Kommune) nach der Qualifizierung des Anliegens, und wie **steuert ein LLM** das
Gespräch, ohne die Verlässlichkeit des regelbasierten Systems aufzugeben.

Der Kern in einem Satz: **Das LLM führt das Gespräch, aber es weiß nichts aus
eigener Kraft** — jede Fachaussage kommt per Werkzeugaufruf aus der geprüften
Wissensbasis, und die sicherheitskritischen Entscheidungen (welche Rechtsebene,
wann nach dem Ort fragen, wann eskalieren) bleiben deterministischer Code.

```
Nutzer ──► LLM (Claude, Gesprächsführung)
              │  tool_use
              ▼
        ┌─────────────────────────────────────────────┐
        │ Werkzeuge (server/assistent.mjs)            │
        │  anliegen_klassifizieren  ← NLU (Code)      │
        │  rechtsebene_pruefen      ← ebenen.js (Code)│
        │  leistung_auskunft        ← KB + Regional   │
        │  wissen_suchen            ← RAG-Retrieval   │
        └─────────────────────────────────────────────┘
              │  tool_result (JSON, mit Stand+Quelle)
              ▼
        LLM formuliert ──► Antwort + Belege an den Nutzer
```

---

## 1. Was braucht ein richtiges RAG?

RAG ist eine Pipeline aus sechs Gliedern. Im Verwaltungskontext ist das
schwächste Glied fast nie das Embedding-Modell, sondern **Korpus und Metadaten**.

### 1.1 Korpus — die eigentliche Arbeit

| Quelle | Charakter | Aufbereitung |
| --- | --- | --- |
| FIM-/LeiKa-Leistungsbeschreibungen | strukturiert, bundesweit | direkt übernehmbar; Stammtexte Bund → Land → Kommune sind bereits geschichtet |
| Landesrecht (Gesetze, VOen) | Fließtext, versioniert | nach §§ chunken, Fassungsdatum als Pflichtmetadatum |
| Kommunale Satzungen | PDF, uneinheitlich | Extraktion (LLM-gestützt) → **menschliche Freigabe** → strukturierte Overlays |
| Zuständigkeitsfinder der Länder | API/strukturiert | periodischer Import |
| 115-Wissensmanagement | redaktionell gepflegt | die natürliche Bezugsquelle statt Parallelredaktion |

In diesem Projekt erzeugt `scripts/build-chunks.mjs` das Korpus direkt aus der
Wissensbasis: **736 Chunks** (12 Bereichswissen, 648 Detailauskünfte
Leistung × Aspekt, 40 Landesprofile, 36 Landes-Overlays) als
`dist/chunks.jsonl`.

### 1.2 Chunking — fachliche Einheiten, nicht 512 Token

Juristische und Verwaltungstexte haben natürliche Grenzen: ein Paragraph, eine
Gebührenposition, ein Verfahrensschritt, ein Aspekt einer Leistung. Wer
stattdessen blind nach Tokenzahl schneidet, trennt die Gebühr von ihrer
Ausnahme und die Frist von ihrem Fristbeginn. Unsere Chunks sind deshalb
genau die Wissensknoten des Dialogs (`leistung:hundesteuer:kosten`), nicht
Textfenster.

### 1.3 Metadaten — was Verwaltungs-RAG von Blog-RAG unterscheidet

Jeder Chunk trägt (siehe `build-chunks.mjs`):

```json
{ "ebene": "kommune", "land": "nw", "leistung": "hundesteuer",
  "aspekt": "kosten", "registerbereich": "kommunalsteuern-ordnung",
  "ortsabhaengig": true, "stand": "2026-08",
  "quelle": "Art. 105 Abs. 2a GG; Kommunalabgabengesetze" }
```

Das erlaubt **gefiltertes Retrieval**: „Was kostet die Hundesteuer?" mit
`land=rp` liefert das RP-Overlay *und* die Bundesspanne, aber nie den
NRW-Chunk. Ähnlichkeit allein würde alle drei mischen — und genau so
entstehen falsche Gebührenauskünfte. **Filterung schlägt Ranking.**

### 1.4 Retrieval — hybrid, Filter zuerst

Produktionsreif ist die Kombination:

1. **Metadatenfilter** (Land, ggf. AGS, Gültigkeitsdatum) — hart, vor allem anderen
2. **BM25** (lexikalisch) — implementiert in `server/retrieval.mjs`; stark bei
   Fachbegriffen und Paragraphen („§ 17 BMG", „eVB-Nummer")
3. **Dense Embeddings** — stark bei Umschreibungen („mein Chef zahlt nicht mehr"
   → Insolvenzgeld). Anthropic bietet kein eigenes Embedding-Modell; die von
   Anthropic dokumentierte Empfehlung ist **Voyage AI** (z. B. `voyage-3`,
   multilingual). Beide Trefferlisten per Reciprocal Rank Fusion mischen.
4. **Reranker** (optional, z. B. voyage-rerank) über die Top-20 — lohnt ab
   Korpusgrößen, wo BM25+Dense uneins sind.

Bei 736 kuratierten Chunks mit dichten Synonymlisten trägt BM25 allein bereits
sehr weit (Tests in `tests/assistent.test.mjs`); die Embedding-Stufe wird
wichtig, wenn echte Satzungs- und Gesetzestexte dazukommen.

### 1.5 Grounding und Zitierpflicht

Die Regel steht im System-Prompt (`server/assistent.mjs`) und ist nicht
verhandelbar: *Jede fachliche Aussage stammt aus einem Werkzeugergebnis dieses
Gesprächs; sonst offenlegen und eskalieren.* Antworten enden mit Stand und
Rechtsgrundlage. Die API-seitige Citations-Funktion (Zitate mit Fundstellen je
Dokumentblock) ist die Ausbaustufe, wenn ganze Gesetzestexte als Dokumente
mitgegeben werden.

### 1.6 Evaluation — ohne sie ist RAG Deko

- **Retrieval-Eval:** Fragensammlung → erwarteter Chunk; messen von Recall@5.
  Der Grundstock existiert: die Klassifikationstabelle (51 Sätze) und die
  Retrieval-Tests.
- **Antwort-Eval:** LLM-as-Judge gegen Referenzantworten; Pflichtkriterien
  „keine Zahl ohne Beleg", „Ebene korrekt benannt", „Ortsvorbehalt vorhanden".
- **Drift-Wächter:** `stand`-Felder älter als Prüfintervall → Chunk degradiert
  auf die nächsthöhere Ebene (Prinzip aus der Regionalschicht).

---

## 2. Rechtsebenen-Klärung: Der Nutzer muss die Ebene nicht kennen

Genau der vorgeschlagene Ablauf ist jetzt implementiert — regelbasiert in
`src/kb/ebenen.js` + Dialog, und als Werkzeug `rechtsebene_pruefen` für das LLM:

```
Anliegen ──► Qualifizierung (NLU) ──► Leistung + Aspekt
                                          │
                              rechtsebene(leistung, aspekt)
                              aus belastbarkeit + gebuehren[].art
                                          │
             ┌────────────────────────────┼────────────────────────────┐
             ▼                            ▼                            ▼
          BUND                          LAND                       KOMMUNE
   sofort antworten,          "In welchem Bundesland        "Für welche Stadt oder
   NIE nach Ort fragen         wohnen Sie?"                  Gemeinde fragen Sie?"
                                          │
                          Ort bekannt? ──► Landes-/Kommunaldaten
                          Ort unbekannt? ─► bundesweite Spanne
                                            + "verbindlich ist die
                                            örtliche Satzung"
```

Drei Eigenschaften machen das robust:

- **Die Ebene wird abgeleitet, nicht gepflegt.** Sie steckt schon in den Daten
  (`belastbarkeit.quelle`, `gebuehren[].art`) — Personalausweis/Kosten → Bund,
  Bestattung/Fristen → Land, Hundesteuer/Kosten → Kommune. Aspektscharf:
  dieselbe Leistung kann im Verfahren Bund und bei der Gebühr Kommune sein.
- **Genau eine Rückfrage, nie vorab.** Gefragt wird erst, wenn der konkrete
  Aspekt ortsabhängig ist — und mit Ausweichoption („3 für die bundesweite
  Auskunft"). Wer verzichtet, wird nicht erneut gefragt.
- **Ehrlicher Fallback.** Unbekannter Ort („München") → bundesweite Spanne mit
  explizitem Satzungsvorbehalt, kein Raten.

Ausbaustufe Kommune: Städtename → AGS-Mapping (Gemeindeverzeichnis destatis),
AGS-Overlays wie in der Regionalschicht — die Auflösungskette
`AGS → Land → Bund` ist bereits angelegt.

---

## 3. Steuerung per LLM: Orchestrierung statt Ersatz

### 3.1 Rollenverteilung

| Aufgabe | Wer | Warum |
| --- | --- | --- |
| Verstehen & Formulieren | **LLM** | Paraphrasen, Dialekt, Rückbezüge („und für meine Frau?") — hier ist das Modell dem Regelwerk klar überlegen |
| Fachdaten | **Wissensbasis via Tools** | prüfbar, versioniert, mit Stand und Quelle |
| Rechtsebene & Ortsfrage | **Code** (`rechtsebene_pruefen`) | sicherheitskritisch → deterministisch |
| Klassifikations-Zweitmeinung | **Code** (`anliegen_klassifizieren`) | die NLU liefert Scores, das LLM entscheidet informiert |
| Eskalation, Grenzen | **System-Prompt + Code** | Gefährdungslagen, keine Rechtsberatung |

### 3.2 Implementierung (lauffähig in diesem Repo)

`server/assistent.mjs` — Claude über das offizielle SDK, manuelle
Tool-Schleife (bewusst statt Tool-Runner: jeder Aufruf wird protokolliert,
Rundenzahl hart begrenzt):

```js
const antwort = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 2048,
  output_config: { effort: 'low' },      // Dialoglatenz; Fachlichkeit liefern die Tools
  system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
  tools: WERKZEUGE,                       // 4 Werkzeuge, strikte Schemata
  messages,
});
// stop_reason === 'tool_use'  → Werkzeuge ausführen,
// alle tool_results in EINER user-Nachricht zurück, weiter bis end_turn
```

Entscheidungen darin, jede mit Grund:

- **`claude-opus-5`**, adaptives Thinking (Standard) mit **`effort: 'low'`** —
  Dialogantworten sind kurz und werkzeuggetrieben; niedriger Aufwand hält die
  Latenz telefontauglich. Für die Offline-Extraktion von Satzungen (Abschnitt
  3.4) gilt das Gegenteil: hoher Effort, Batch-API (50 % Kosten).
- **Prompt-Caching** auf dem System-Prompt: der stabile Präfix (System +
  Werkzeugdefinitionen) wird gecacht, nur der Gesprächsverlauf variiert.
- **Kontext-Injektion statt Nachfrage-Schleifen:** Das gesetzte Bundesland wird
  als erste Nachricht injiziert — das Modell fragt nicht erneut.
- **Harte Rundengrenze (6)** mit definiertem Eskalationstext.
- **Mock-Modus** ohne `ANTHROPIC_API_KEY`: antwortet direkt aus dem Retrieval,
  damit UI und Tests ohne Schlüssel laufen.

### 3.3 UI-Integration

Der Schalter **„KI-Modus"** (Fußleiste) erscheint nur, wenn die Anwendung über
ihren Node-Server läuft (`/api/status`). Jede KI-Antwort zeigt in der
Auskunftsspalte die **Belege** (Chunk-IDs, Rechtsgrundlagen, Stand) und die
**aufgerufenen Werkzeuge** — die Nachvollziehbarkeit des regelbasierten Modus
bleibt erhalten. Regelbasiert bleibt der Standard: offline, deterministisch,
kostenfrei; Zifferntasten steuern immer das Menü.

Betrieb: `ANTHROPIC_API_KEY=sk-... npm start` — Status zeigt dann
„Claude (claude-opus-5)".

### 3.4 Das LLM an der zweiten Stelle: Ingestion

Die mindestens ebenso wertvolle LLM-Rolle liegt **offline**: kommunale
Gebührensatzungen (PDF) → strukturierte Overlays. Extraktion mit hohem Effort
über die Batch-API, Ausgabe gegen das Overlay-Schema validiert (Validator
existiert), **Vier-Augen-Freigabe** durch die Redaktion, erst dann ins Korpus.
Extraktion ist prüfbar — freie Generierung ist es nicht. Das ist der Weg von
2 auf 11.000 Kommunen, ohne 800.000 Werte von Hand zu pflegen.

### 3.5 Kostenrahmen (Größenordnung)

Ein Dialogschritt: ~2.500 Token Input (System+Tools weitgehend aus dem Cache,
~90 % günstiger) + 2–3 Tool-Runden + ~300 Token Output. Mit Opus 5
($5/$25 je 1M) grob **1–3 Cent pro Gesprächsschritt**; Haiku 4.5 als
Routing-Vorstufe kann das weiter drücken, lohnt aber erst bei echtem Volumen —
vorher gilt: ein Modell, ein Cache.

---

## Dateien

| Pfad | Inhalt |
| --- | --- |
| `scripts/build-chunks.mjs` | Korpus-Export: 736 Chunks mit Metadaten |
| `server/retrieval.mjs` | BM25 + Metadatenfilter (Slot für Embedding-Stufe) |
| `server/assistent.mjs` | Claude-Orchestrator: 4 Werkzeuge, System-Prompt, Tool-Schleife, Mock |
| `src/kb/ebenen.js` | Rechtsebenen-Ableitung (auch als Werkzeug exponiert) |
| `scripts/server.mjs` | `/api/status`, `/api/assistent` |
| `tests/assistent.test.mjs` | Retrieval-, Werkzeug- und Mock-Tests |
