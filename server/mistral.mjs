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
 *   MISTRAL_MODELL      optional - Standard 'ministral-14b-latest'
 *                       (mit Bezahltarif besser: 'mistral-medium-latest')
 *   ASSISTENT_MAX_TOKENS optional - Standard 512 (kurze, sprechbare Antworten)
 */
import { WERKZEUGE, werkzeugAusfuehren, SYSTEM, kontextFuer } from './assistent.mjs';

const ENDPUNKT = 'https://api.mistral.ai/v1/chat/completions';
// Standard 'ministral-14b-latest': Function Calling, im Gratis-Tarif nutzbar
// (30 Anfragen/Minute) und am Telefon schnell (3-5 s je Antwort inkl.
// Werkzeugen). Die Premium-Modelle (mistral-small/-medium/-large, magistral)
// haben ohne hinterlegte Zahlung ein Kontingent von 0 Anfragen und liefern
// nur 429. Mit Bezahltarif: MISTRAL_MODELL=mistral-medium-latest.
const MODELL = process.env.MISTRAL_MODELL || 'ministral-14b-latest';
const MAX_TOKENS = Number(process.env.ASSISTENT_MAX_TOKENS ?? 512);
// Nach so vielen Werkzeug-Runden wird eine Antwort ohne weitere Werkzeuge
// erzwungen (tool_choice 'none'). Kleine Modelle rufen sonst dasselbe
// Werkzeug mehrfach und laufen in die Rundengrenze statt zu antworten.
const MAX_RUNDEN = 6;

// Ratenlimit-Behandlung: Der kostenlose Tarif erlaubt nur etwa eine Anfrage
// pro Sekunde, und die Tool-Schleife stellt mehrere Anfragen nacheinander.
// Bei 429 (und voruebergehenden 5xx) kurz warten und wiederholen, statt den
// Anruf mit "technische Stoerung" abzubrechen.
const MAX_VERSUCHE = 4;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function mistralAnfrage(messages, { toolChoice = 'auto' } = {}) {
  const schluessel = process.env.MISTRAL_API_KEY;
  if (!schluessel) throw new Error('MISTRAL_API_KEY fehlt');

  const body = JSON.stringify({
    model: MODELL,
    max_tokens: MAX_TOKENS,
    temperature: 0.2, // fachliche Auskunft: eng am Werkzeugergebnis bleiben
    messages,
    tools: MISTRAL_WERKZEUGE,
    tool_choice: toolChoice,
  });

  let letzterFehler = null;
  for (let versuch = 1; versuch <= MAX_VERSUCHE; versuch += 1) {
    const antwort = await fetch(ENDPUNKT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${schluessel}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });

    const text = await antwort.text();
    if (antwort.ok) return JSON.parse(text);

    letzterFehler = new Error(`Mistral-API ${antwort.status}: ${text.slice(0, 400)}`);
    const wiederholbar = antwort.status === 429 || antwort.status >= 500;
    if (!wiederholbar || versuch === MAX_VERSUCHE) throw letzterFehler;

    // Retry-After (Sekunden) beachten, sonst 1 s, 2 s, 4 s.
    const ra = Number(antwort.headers.get('retry-after'));
    const warte = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** (versuch - 1);
    await pause(warte);
  }
  throw letzterFehler;
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
export async function mistralSchritt({ nachricht, verlauf = [], land = null, sprache = 'de' }) {
  const kontext = kontextFuer({ land, sprache });

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
  for (let runde = 0; runde < MAX_RUNDEN; runde += 1) {
    // Letzte Runde: keine weiteren Werkzeuge, jetzt muss geantwortet werden.
    const letzte = runde === MAX_RUNDEN - 1;
    const daten = await mistralAnfrage(messages, { toolChoice: letzte ? 'none' : 'auto' });
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
