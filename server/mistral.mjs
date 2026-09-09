/**
 * Mistral-Anbieter (EU-Variante).
 *
 * Spiegelt die Gespraechsschleife aus assistent.mjs auf die Chat-Completions-
 * API von Mistral (api.mistral.ai, Frankreich/EU). Es ist bewusst KEIN
 * Anthropic-/Claude-Code: Mistral ist ein eigener Anbieter mit eigenem
 * Nachrichten- und Function-Calling-Format. Wissensbasis, Werkzeuge und
 * System-Prompt sind dieselben wie im Claude-Pfad - nur das Modell wechselt.
 *
 * Datenlage: Mistral verarbeitet in der EU. Fuer den produktiven Einsatz mit
 * echten Anruferdaten gehoert ein Auftragsverarbeitungsvertrag (AVV) dazu.
 *
 * Konfiguration (Umgebungsvariablen):
 *   MISTRAL_API_KEY     Pflicht - Schluessel aus console.mistral.ai
 *   MISTRAL_MODELL      optional - Standard 'mistral-large-latest'
 *                       (fuer weniger Latenz: 'mistral-small-latest')
 *   ASSISTENT_MAX_TOKENS optional - Standard 512 (kurze, sprechbare Antworten)
 */
import { WERKZEUGE, werkzeugAusfuehren, SYSTEM } from './assistent.mjs';
import { LAENDER } from '../src/kb/regional/index.js';

const ENDPUNKT = 'https://api.mistral.ai/v1/chat/completions';
const MODELL = process.env.MISTRAL_MODELL || 'mistral-large-latest';
const MAX_TOKENS = Number(process.env.ASSISTENT_MAX_TOKENS ?? 512);

/**
 * Uebersetzt die Werkzeug-Schemata (Anthropic-Form: name/description/
 * input_schema) in Mistrals OpenAI-kompatible Function-Form.
 */
export function alsMistralWerkzeuge(werkzeuge = WERKZEUGE) {
  return werkzeuge.map((w) => ({
    type: 'function',
    function: {
      name: w.name,
      description: w.description,
      parameters: w.input_schema,
    },
  }));
}

const MISTRAL_WERKZEUGE = alsMistralWerkzeuge();

async function mistralAnfrage(messages) {
  const schluessel = process.env.MISTRAL_API_KEY;
  if (!schluessel) throw new Error('MISTRAL_API_KEY fehlt');

  const antwort = await fetch(ENDPUNKT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${schluessel}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: MODELL,
      max_tokens: MAX_TOKENS,
      temperature: 0.2, // fachliche Auskunft: eng am Werkzeugergebnis bleiben
      messages,
      tools: MISTRAL_WERKZEUGE,
      tool_choice: 'auto',
    }),
  });

  const text = await antwort.text();
  if (!antwort.ok) {
    throw new Error(`Mistral-API ${antwort.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

// Quellen aus einem Werkzeugergebnis einsammeln - identisch zum Claude-Pfad.
function quellenAusErgebnis(ergebnis, eingabe, quellen) {
  if (Array.isArray(ergebnis)) {
    for (const t of ergebnis) {
      if (t.meta?.quelle) quellen.add(`${t.id} — ${t.meta.quelle} (Stand ${t.meta.stand})`);
    }
  } else if (ergebnis?.stand) {
    quellen.add(`${eingabe.leistung ?? ''} — Stand ${ergebnis.stand}`);
  }
}

/**
 * Ein Gespraechsschritt mit Mistral. Gleiche Rueckgabeform wie der Claude-Pfad:
 * { text, quellen, werkzeuge, modus, modell, beendet?, grund? }.
 */
export async function mistralSchritt({ nachricht, verlauf = [], land = null }) {
  const kontext = land
    ? `[Kontext: Bundesland des Anrufers ist ${LAENDER[land].name} (${land}).]`
    : '[Kontext: Bundesland des Anrufers ist nicht bekannt.]';

  const messages = [
    { role: 'system', content: SYSTEM },
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

  // Manuelle Tool-Schleife mit harter Rundenbegrenzung (wie im Claude-Pfad).
  for (let runde = 0; runde < 6; runde += 1) {
    const daten = await mistralAnfrage(messages);
    const wahl = daten.choices?.[0]?.message;
    const aufrufe = wahl?.tool_calls ?? [];

    // Keine Werkzeugaufrufe -> finale, gesprochene Antwort.
    if (!aufrufe.length) {
      return {
        text: (wahl?.content ?? '').trim(),
        quellen: [...quellen],
        werkzeuge: benutzteWerkzeuge,
        modus: 'llm',
        modell: daten.model ?? MODELL,
      };
    }

    // Assistent-Nachricht mit den Werkzeugaufrufen unveraendert zuruecklegen.
    messages.push({ role: 'assistant', content: wahl.content ?? '', tool_calls: aufrufe });

    // Auflegen ist eine Entscheidung, kein Wissensabruf: sofort beenden.
    const auflegen = aufrufe.find((tc) => tc.function?.name === 'gespraech_beenden');
    if (auflegen) {
      const eingabe = sicherParsen(auflegen.function.arguments);
      benutzteWerkzeuge.push({ name: 'gespraech_beenden', eingabe });
      return {
        text: eingabe.abschied ?? 'Auf Wiederhören.',
        beendet: true,
        grund: eingabe.grund,
        quellen: [...quellen],
        werkzeuge: benutzteWerkzeuge,
        modus: 'llm',
        modell: daten.model ?? MODELL,
      };
    }

    // Alle Werkzeuge ausfuehren und je Aufruf ein tool-Ergebnis zurueckgeben.
    for (const tc of aufrufe) {
      const name = tc.function?.name;
      const eingabe = sicherParsen(tc.function?.arguments);
      const ergebnis = await werkzeugAusfuehren(name, eingabe);
      benutzteWerkzeuge.push({ name, eingabe });
      quellenAusErgebnis(ergebnis, eingabe, quellen);
      messages.push({
        role: 'tool',
        name,
        tool_call_id: tc.id,
        content: JSON.stringify(ergebnis),
      });
    }
  }

  return {
    text: 'Die Anfrage war zu verschachtelt für eine direkte Auskunft. Ich verbinde Sie am besten mit einer Mitarbeiterin oder einem Mitarbeiter.',
    quellen: [...quellen],
    werkzeuge: benutzteWerkzeuge,
    modus: 'llm-abbruch',
    modell: MODELL,
  };
}

// Mistral liefert die Werkzeug-Argumente als JSON-String; robust parsen.
function sicherParsen(roh) {
  if (roh && typeof roh === 'object') return roh;
  try {
    return JSON.parse(roh || '{}');
  } catch {
    return {};
  }
}
