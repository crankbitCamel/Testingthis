/**
 * LLM-Orchestrierung des Verwaltungsassistenten.
 *
 * Architekturprinzip: Das LLM formuliert und fuehrt das Gespraech - aber es
 * WEISS nichts aus eigener Kraft. Jede fachliche Aussage muss aus einem
 * Tool-Ergebnis stammen: strukturierte Abfragen der Wissensbasis plus
 * RAG-Suche ueber das Chunk-Korpus. Der deterministische Kern (Rechtsebenen-
 * Ableitung, Regionalaufloesung, Eskalationsregeln) bleibt Code, nicht
 * Prompt - das LLM ruft ihn auf, statt ihn zu erraten.
 *
 * Ohne API-Zugang laeuft der Mock-Modus: Er beantwortet Anfragen direkt aus
 * dem Retrieval, damit Oberflaeche und Tests ohne Schluessel funktionieren.
 */
import { ladeIndex } from './retrieval.mjs';
import { LEISTUNG_BY_ID, CLUSTER_BY_ID } from '../src/kb/index.js';
import { rechtsebene } from '../src/kb/ebenen.js';
import { regional, LAENDER } from '../src/kb/regional/index.js';
import { aspektInhalt } from '../src/dialog.js';
import { verstehe, entscheide, erkenneLand } from '../src/nlu.js';

const MODELL = process.env.ASSISTENT_MODELL ?? 'claude-opus-5';
// Kurze Antworten halten die Latenz telefontauglich (Twilio bricht Webhooks
// nach ~15 s ab). Fuer den Browser laesst sich der Wert per Env erhoehen.
const MAX_TOKENS = Number(process.env.ASSISTENT_MAX_TOKENS ?? 512);

export function llmKonfiguriert() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// ---------------------------------------------------------------------------
// Werkzeuge: die Brücke vom Modell in die Wissensbasis
// ---------------------------------------------------------------------------

const WERKZEUGE = [
  {
    name: 'wissen_suchen',
    description: 'Durchsucht die Wissensbasis (rund 800 kuratierte Chunks: Bereichswissen, Detailauskünfte je Leistung und Aspekt, Landesprofile NRW/RP, Kommunen). Nutze dies zuerst, um passende Wissensknoten zu finden. Das Filterfeld land liefert landesspezifische UND landesneutrale Treffer.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        frage: { type: 'string', description: 'Suchanfrage in Alltagssprache' },
        land: { type: 'string', enum: ['nw', 'rp'], description: 'Bundesland des Anrufers, falls bekannt' },
        leistung: { type: 'string', description: 'Leistungs-ID, wenn schon bekannt (z. B. "hundesteuer")' },
        topK: { type: 'integer', minimum: 1, maximum: 8 },
      },
      required: ['frage'],
    },
  },
  {
    name: 'leistung_auskunft',
    description: 'Liefert die vollständige strukturierte Auskunft zu einer Leistung und einem Aspekt (unterlagen, kosten, ablauf, voraussetzungen, fristen, zustaendigkeit, online, rechtsgrundlagen, fehler, faq) - inklusive Regionaldaten, wenn ein Land gesetzt ist. Zitierfähige Primärquelle für alle Detailangaben.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        leistung: { type: 'string' },
        aspekt: { type: 'string' },
        land: { type: 'string', enum: ['nw', 'rp'] },
      },
      required: ['leistung', 'aspekt'],
    },
  },
  {
    name: 'rechtsebene_pruefen',
    description: 'Bestimmt deterministisch, ob eine Leistung (ggf. je Aspekt) Bundes-, Landes- oder Kommunalrecht ist und ob eine präzise Antwort vom Wohnort abhängt. IMMER aufrufen, bevor du nach dem Wohnort fragst - Bundesrecht wird nie mit einer Ortsfrage belastet.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        leistung: { type: 'string' },
        aspekt: { type: 'string' },
      },
      required: ['leistung'],
    },
  },
  {
    name: 'gespraech_beenden',
    description: 'Beendet das Gespräch endgültig ("auflegen"). Nur in zwei Fällen aufrufen: (a) grund "missbrauch" - der Anrufer beleidigt, provoziert oder führt einen erkennbaren Scherzanruf fort, OBWOHL du in diesem Gespräch bereits einmal sachlich darauf hingewiesen hast; (b) grund "erledigt" - der Anrufer verabschiedet sich ausdrücklich. Ungewöhnliche, aber ernst gemeinte Fragen sind NIEMALS Missbrauch. Beim ersten Missbrauchsverdacht keinesfalls dieses Werkzeug nutzen, sondern als normale Antwort einen sachlichen Hinweis geben.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        grund: { type: 'string', enum: ['missbrauch', 'erledigt'] },
        abschied: { type: 'string', description: 'Der letzte gesprochene Satz vor dem Auflegen - kurz und auch bei Missbrauch höflich.' },
      },
      required: ['grund', 'abschied'],
    },
  },
  {
    name: 'anliegen_klassifizieren',
    description: 'Klassifiziert eine freie Äußerung gegen die Wissensbasis (Cluster- und Leistungstreffer mit Scores). Nützlich als Zweitmeinung zur eigenen Einschätzung und um die korrekte Leistungs-ID zu finden.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
];

async function werkzeugAusfuehren(name, eingabe) {
  switch (name) {
    case 'wissen_suchen': {
      const index = await ladeIndex();
      const treffer = index.suche(eingabe.frage, {
        filter: { land: eingabe.land, leistung: eingabe.leistung },
        topK: eingabe.topK ?? 5,
      });
      return treffer.map((t) => ({
        id: t.chunk.id,
        score: Number(t.score.toFixed(2)),
        text: t.chunk.text.slice(0, 700),
        meta: { ebene: t.chunk.meta.ebene, land: t.chunk.meta.land, stand: t.chunk.meta.stand, quelle: t.chunk.meta.quelle },
      }));
    }
    case 'leistung_auskunft': {
      const l = LEISTUNG_BY_ID[eingabe.leistung];
      if (!l) return { fehler: `Unbekannte Leistung "${eingabe.leistung}"` };
      const inhalt = aspektInhalt(l, eingabe.aspekt);
      const reg = eingabe.land ? regional(l.id, eingabe.land) : null;
      return {
        leistung: l.name,
        cluster: CLUSTER_BY_ID[l.cluster]?.name,
        aspekt: eingabe.aspekt,
        inhalt: { absaetze: inhalt.absaetze, listen: inhalt.listen },
        regional: reg?.eintrag ?? null,
        landesprofil: reg?.profil?.kurz ?? null,
        belastbarkeit: l.belastbarkeit,
        eskalation: l.eskalation,
        stand: l.stand,
      };
    }
    case 'rechtsebene_pruefen': {
      const e = rechtsebene(eingabe.leistung, eingabe.aspekt ?? null);
      if (!e) return { fehler: `Unbekannte Leistung "${eingabe.leistung}"` };
      return {
        ebene: e.ebene.id,
        ebeneName: e.ebene.name,
        ortsabhaengig: e.ortsabhaengig,
        aufloesung: e.aufloesung,
        hinterlegteLaender: ['nw', 'rp'].filter((code) => regional(eingabe.leistung, code)),
      };
    }
    case 'anliegen_klassifizieren': {
      const analyse = verstehe(eingabe.text);
      const ergebnis = entscheide(analyse);
      return {
        entscheidung: ergebnis,
        clusterTreffer: analyse.clusterTreffer.slice(0, 3).map((t) => ({ id: t.id, score: Number(t.score.toFixed(1)) })),
        leistungTreffer: analyse.leistungTreffer.slice(0, 3).map((t) => ({ id: t.id, score: Number(t.score.toFixed(1)) })),
        aspekt: analyse.aspekt,
        landImText: erkenneLand(eingabe.text)?.code ?? null,
      };
    }
    default:
      return { fehler: `Unbekanntes Werkzeug "${name}"` };
  }
}

// ---------------------------------------------------------------------------
// System-Prompt: Verhalten, nicht Wissen
// ---------------------------------------------------------------------------

const SYSTEM = `Du bist der Verwaltungsassistent einer deutschen Kommune, angelehnt an die Behördennummer 115. Du führst kurze, freundliche Gespräche in einfacher Verwaltungssprache und beantwortest Fragen zu Verwaltungsleistungen.

Eiserne Regeln:
1. GROUNDING: Jede fachliche Aussage (Gebühr, Frist, Unterlage, Zuständigkeit, Rechtsgrundlage) stammt aus einem Werkzeugergebnis dieses Gesprächs. Findest du dort nichts, sage das offen und biete die Weiterleitung an eine Mitarbeiterin oder einen Mitarbeiter an. Rate niemals Beträge oder Paragraphen.
2. RECHTSEBENE: Bevor du Kosten, Fristen oder Zuständigkeit konkret nennst, prüfe mit rechtsebene_pruefen, auf welcher Ebene das Recht sitzt. Bei Bundesrecht antworte direkt, ohne Ortsfrage. Bei Landes- oder Kommunalrecht: Ist kein Ort bekannt, stelle GENAU EINE kurze Rückfrage nach Bundesland oder Kommune - und biete an, stattdessen die bundesweite Spanne zu nennen. Für Nordrhein-Westfalen (nw) und Rheinland-Pfalz (rp) sind Landesdaten hinterlegt; für andere Orte nenne die bundesweite Spanne und sage dazu, dass die örtliche Satzung verbindlich ist.
3. QUELLEN: Nenne am Ende fachlicher Antworten Stand und Rechtsgrundlage aus den Werkzeugergebnissen, in gesprochener Form ("Stand August zweitausendsechsundzwanzig, Paragraf siebzehn Bundesmeldegesetz").
4. SPRECHBARKEIT: Antworten werden vorgelesen. Maximal fünf Sätze Kernantwort, keine Aufzählungen mit mehr als drei Punkten im Fließtext. Details gehören in die strukturierte Auskunft, die das Werkzeug ohnehin liefert. Schreibe alles so, wie es gesprochen wird: Jahreszahlen und Daten ausgeschrieben ("August zweitausendsechsundzwanzig" statt "2026-08", "zweitausendfünfundzwanzig" statt "2025"), keine Abkürzungen ("zum Beispiel" statt "z. B.", "beziehungsweise" statt "bzw.", "Paragraf" statt "§"), Beträge als "70 Euro". Keine Zeichen, die man nicht sprechen kann.
5. GRENZEN: Keine Rechtsberatung im Einzelfall, keine Zusagen. Bei Gefährdungslagen (Gewaltschutz, drohende Wohnungslosigkeit, Fristablauf heute) sofort auf die zuständige Stelle und die Weiterleitung hinweisen. Verbindlich entscheidet immer die Behörde.
6. KONTEXT: Der Nutzerkontext (gesetztes Bundesland) steht in der ersten Nutzernachricht. Frage nicht erneut nach Dingen, die dort stehen.
7. GESPRÄCHSSCHLEIFE: Bewerte jede Äußerung, bevor du antwortest, und wähle genau einen der vier Wege:
   a) BEANTWORTBAR - das Anliegen ist klar und die Werkzeuge liefern Wissen: antworte direkt.
   b) UNKLAR - das Anliegen oder ein nötiges Detail (z. B. der Ort) fehlt: stelle GENAU EINE gezielte Rückfrage. Höchstens zwei Rückfragen je Anliegen; hilft auch die zweite Antwort nicht weiter, nenne das Passendste aus der Wissensbasis (etwa die bundesweite Spanne) und biete die Weiterleitung an.
   c) KEIN WISSEN - das Anliegen ist klar, aber die Werkzeuge liefern nichts Belastbares: sage das offen und biete die Weiterleitung an. Niemals raten.
   d) MISSBRAUCH - Beleidigung, Provokation oder erkennbarer Scherzanruf: Weise beim ersten Mal in einem Satz sachlich darauf hin, dass du für Fragen zu Verwaltungsleistungen da bist und das Gespräch sonst beendest. Macht der Anrufer danach weiter, rufe gespraech_beenden auf (grund "missbrauch"). Ernst gemeinte, auch ungewöhnliche oder emotionale Anliegen sind KEIN Missbrauch - Frust über eine Behörde ist legitim.
   Verabschiedet sich der Anrufer ausdrücklich, rufe gespraech_beenden auf (grund "erledigt").`;

// ---------------------------------------------------------------------------
// Gespraechsfuehrung
// ---------------------------------------------------------------------------

/**
 * Fuehrt einen Gespraechsschritt mit Claude aus.
 * @param {object} p
 * @param {string} p.nachricht      aktuelle Nutzeraeusserung
 * @param {Array}  p.verlauf        bisherige Runden [{rolle:'nutzer'|'bot', text}]
 * @param {string|null} p.land      gesetztes Bundesland ('nw'|'rp'|null)
 */
export async function gespraechsschritt({ nachricht, verlauf = [], land = null }) {
  if (!llmKonfiguriert()) return mockSchritt({ nachricht, verlauf, land });

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const kontext = land
    ? `[Kontext: Bundesland des Anrufers ist ${LAENDER[land].name} (${land}).]`
    : '[Kontext: Bundesland des Anrufers ist nicht bekannt.]';

  /** @type {import('@anthropic-ai/sdk').Anthropic.MessageParam[]} */
  const messages = [
    { role: 'user', content: kontext },
    { role: 'assistant', content: 'Verstanden.' },
    ...verlauf.slice(-12).map((r) => ({
      role: r.rolle === 'nutzer' ? 'user' : 'assistant',
      content: r.text,
    })),
    { role: 'user', content: nachricht },
  ];

  const benutzteWerkzeuge = [];
  const quellen = new Set();

  // Manuelle Tool-Schleife: bewusst statt des Beta-Tool-Runners, damit jeder
  // Werkzeugaufruf protokolliert und die Rundenzahl hart begrenzt ist.
  for (let runde = 0; runde < 6; runde += 1) {
    const antwort = await client.messages.create({
      model: MODELL,
      max_tokens: MAX_TOKENS,
      // Dialogantworten sind kurz und werkzeuggetrieben - niedriger Aufwand
      // haelt die Latenz telefontauglich; die Fachlichkeit liefern die Tools.
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: WERKZEUGE,
      messages,
    });

    if (antwort.stop_reason !== 'tool_use') {
      const text = antwort.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { text, quellen: [...quellen], werkzeuge: benutzteWerkzeuge, modus: 'llm', modell: antwort.model };
    }

    messages.push({ role: 'assistant', content: antwort.content });

    // Auflegen ist eine Entscheidung, kein Wissensabruf: Das Werkzeug beendet
    // die Schleife sofort, der Abschiedssatz kommt aus dem Werkzeugaufruf.
    const auflegen = antwort.content.find((b) => b.type === 'tool_use' && b.name === 'gespraech_beenden');
    if (auflegen) {
      benutzteWerkzeuge.push({ name: auflegen.name, eingabe: auflegen.input });
      return {
        text: auflegen.input.abschied,
        beendet: true,
        grund: auflegen.input.grund,
        quellen: [...quellen],
        werkzeuge: benutzteWerkzeuge,
        modus: 'llm',
        modell: antwort.model,
      };
    }

    const ergebnisse = [];
    for (const block of antwort.content) {
      if (block.type !== 'tool_use') continue;
      const eingabe = block.input;
      const ergebnis = await werkzeugAusfuehren(block.name, eingabe);
      benutzteWerkzeuge.push({ name: block.name, eingabe });
      if (Array.isArray(ergebnis)) {
        for (const t of ergebnis) if (t.meta?.quelle) quellen.add(`${t.id} — ${t.meta.quelle} (Stand ${t.meta.stand})`);
      } else if (ergebnis?.stand) {
        quellen.add(`${eingabe.leistung ?? ''} — Stand ${ergebnis.stand}`);
      }
      ergebnisse.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(ergebnis),
      });
    }
    // Alle Ergebnisse einer Runde in EINER user-Nachricht zurueckgeben.
    messages.push({ role: 'user', content: ergebnisse });
  }

  return {
    text: 'Die Anfrage war zu verschachtelt für eine direkte Auskunft. Ich verbinde Sie am besten mit einer Mitarbeiterin oder einem Mitarbeiter.',
    quellen: [...quellen],
    werkzeuge: benutzteWerkzeuge,
    modus: 'llm-abbruch',
  };
}

const MISSBRAUCH_MUSTER = /\b(idiot|arschloch|blödmann|bloedmann|verarschen|verarsche|halts?\s*maul|halt die klappe|scheiß\s*amt|scheiss\s*amt|verpiss)\b/i;
export const MOCK_VERWARNUNG = 'Ich bin für Fragen zu Verwaltungsleistungen da. Bitte bleiben wir sachlich - sonst muss ich das Gespräch beenden.';
export const MOCK_ABSCHIED = 'Ich beende das Gespräch jetzt. Wenn Sie eine Frage zu einer Verwaltungsleistung haben, melden Sie sich gern erneut. Auf Wiederhören.';

/**
 * Mock-Modus ohne API-Zugang: klassifiziert lokal und antwortet direkt aus
 * dem Retrieval. Bewusst schlicht - er existiert, damit Entwicklung und
 * Tests ohne Schluessel laufen, nicht als zweite Dialogengine.
 */
async function mockSchritt({ nachricht, verlauf = [], land }) {
  // Interaktionsschleife auch im Mock: Missbrauch -> ein Hinweis -> auflegen.
  // Die Wortliste ist bewusst eng, damit ernst gemeinter Frust nie trifft.
  if (MISSBRAUCH_MUSTER.test(nachricht)) {
    const schonVerwarnt = verlauf.some((r) => r.rolle === 'bot' && r.text === MOCK_VERWARNUNG);
    if (schonVerwarnt) {
      return { text: MOCK_ABSCHIED, beendet: true, grund: 'missbrauch', quellen: [], werkzeuge: [], modus: 'mock' };
    }
    return { text: MOCK_VERWARNUNG, quellen: [], werkzeuge: [], modus: 'mock' };
  }

  const index = await ladeIndex();
  const treffer = index.suche(nachricht, { filter: { land: land ?? undefined }, topK: 3 });
  if (!treffer.length) {
    return { text: 'Dazu habe ich nichts Belastbares gefunden. Beschreiben Sie das Anliegen bitte mit anderen Worten.', quellen: [], werkzeuge: [], modus: 'mock' };
  }
  const bester = treffer[0].chunk;
  return {
    text: `${bester.text.slice(0, 420)} (Auskunft im Testmodus ohne Sprachmodell; Stand ${bester.meta.stand ?? 'unbekannt'}.)`,
    quellen: treffer.map((t) => `${t.chunk.id}${t.chunk.meta.quelle ? ` — ${t.chunk.meta.quelle}` : ''}`),
    werkzeuge: [{ name: 'wissen_suchen', eingabe: { frage: nachricht, land } }],
    modus: 'mock',
  };
}

export { WERKZEUGE, werkzeugAusfuehren, SYSTEM };
