#!/usr/bin/env node
/**
 * Extrahiert aus einer kommunalen Satzung (PDF) einen Kommunen-Overlay-Entwurf.
 *
 * Das ist die Offline-Rolle des Sprachmodells: Es liest die Satzung und
 * fuellt das feste Schema - mit Fundstelle fuer jeden Wert, damit ein Mensch
 * jede Zahl in Sekunden gegenpruefen kann. Die Ausgabe landet als Entwurf in
 * extern/eingang/ und ist erst nach Pruefung und status "freigegeben" fuer
 * das Laufzeitsystem bestimmt. Der Validator laeuft automatisch mit.
 *
 *   ANTHROPIC_API_KEY=sk-... node scripts/extrahiere-satzung.mjs \
 *       satzung.pdf hundesteuer 05315000 "Köln" nw
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { LEISTUNG_BY_ID } from '../src/kb/index.js';
import { pruefeKommune } from './validate-kommune.mjs';

const [pdfPfad, leistungId, ags, kommunenName, land] = process.argv.slice(2);

if (!pdfPfad || !leistungId || !ags) {
  console.log('Aufruf: node scripts/extrahiere-satzung.mjs <satzung.pdf> <leistung-id> <ags> [name] [land]');
  console.log('Beispiel: node scripts/extrahiere-satzung.mjs hundesteuersatzung.pdf hundesteuer 05315000 "Köln" nw');
  process.exit(1);
}
if (!LEISTUNG_BY_ID[leistungId]) {
  console.error(`Unbekannte Leistungs-ID "${leistungId}". Gültige IDs stehen in src/kb/leistungen/.`);
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error('Kein API-Zugang: ANTHROPIC_API_KEY (oder ANTHROPIC_AUTH_TOKEN) setzen.');
  console.error('Die Extraktion ist ein Offline-Werkzeug der Redaktion, kein Laufzeitbestandteil.');
  process.exit(1);
}

const { default: Anthropic } = await import('@anthropic-ai/sdk');
const client = new Anthropic();

const basis = LEISTUNG_BY_ID[leistungId];
const pdf = (await readFile(pdfPfad)).toString('base64');

/**
 * Ein einziges Werkzeug mit striktem Schema erzwingt die Zielstruktur -
 * das Modell KANN nur schemakonform antworten (strict: true).
 */
const erfassung = {
  name: 'satzung_erfassen',
  description: 'Erfasst die für die Leistung relevanten Werte aus der vorliegenden Satzung. Nur Werte eintragen, die wörtlich in der Satzung stehen; nichts schätzen, nichts ergänzen. Jede Zahl braucht ihre Fundstelle (Paragraph oder Seite).',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['gebuehren', 'fristen', 'besonderheiten', 'rechtsgrundlage', 'gueltigAb', 'unsicherheiten'],
    properties: {
      gebuehren: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['position', 'betrag', 'betragCent', 'fundstelle'],
          properties: {
            position: { type: 'string' },
            betrag: { type: 'string', description: 'Wörtlich normalisiert, z. B. "126,00 Euro/Jahr"' },
            betragCent: { type: 'integer' },
            fundstelle: { type: 'string', description: 'z. B. "§ 4 Abs. 1"' },
          },
        },
      },
      fristen: { type: 'array', items: { type: 'string' } },
      besonderheiten: { type: 'array', items: { type: 'string', description: 'Befreiungen, Ermäßigungen, örtliche Sonderregeln - mit Fundstelle im Text' } },
      rechtsgrundlage: { type: 'string', description: 'Amtlicher Titel der Satzung mit Fassungsdatum' },
      gueltigAb: { type: 'string', description: 'Inkrafttreten JJJJ-MM-TT, leer wenn nicht ermittelbar' },
      unsicherheiten: { type: 'array', items: { type: 'string' }, description: 'Alles, was das Modell NICHT sicher lesen konnte - Pflichtfeld für die menschliche Prüfung' },
    },
  },
};

console.log(`Lese ${pdfPfad} und extrahiere für "${basis.name}" …`);
const antwort = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 16000,
  tools: [erfassung],
  tool_choice: { type: 'tool', name: 'satzung_erfassen' },
  messages: [{
    role: 'user',
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
      { type: 'text', text: `Dies ist eine kommunale Satzung. Erfasse daraus die Werte für die Verwaltungsleistung "${basis.name}" (${leistungId}). Zum Abgleich die bundesweiten Gebührenpositionen dieser Leistung: ${basis.gebuehren.map((g) => g.position).join('; ')}. Trage ausschließlich ein, was wörtlich in der Satzung steht. Was du nicht sicher lesen kannst, gehört in "unsicherheiten", nicht in die Daten.` },
    ],
  }],
});

const werkzeugAufruf = antwort.content.find((b) => b.type === 'tool_use');
if (!werkzeugAufruf) {
  console.error(`Keine Extraktion erhalten (stop_reason: ${antwort.stop_reason}).`);
  process.exit(1);
}
const e = werkzeugAufruf.input;

const heute = new Date().toISOString().slice(0, 10);
const overlay = {
  ags,
  name: kommunenName ?? 'UNBEKANNT - eintragen',
  land: land ?? 'xx',
  stand: heute.slice(0, 7),
  stellen: [{ id: 'zustaendige-stelle', name: 'ZUSTÄNDIGE STELLE EINTRAGEN', adresse: { strasse: 'EINTRAGEN', plz: '00000', ort: kommunenName ?? 'EINTRAGEN' } }],
  leistungen: {
    [leistungId]: {
      stelleRef: 'zustaendige-stelle',
      gebuehren: e.gebuehren,
      ...(e.fristen.length ? { fristen: e.fristen } : {}),
      ...(e.besonderheiten.length ? { besonderheiten: e.besonderheiten } : {}),
      quelle: {
        rechtsgrundlage: e.rechtsgrundlage,
        ...(e.gueltigAb ? { gueltigAb: e.gueltigAb } : {}),
        geprueftAm: heute,
        pruefintervallMonate: 12,
      },
      status: 'entwurf',
    },
  },
};

await mkdir('extern/eingang', { recursive: true });
const ziel = `extern/eingang/${ags}-${leistungId}.json`;
await writeFile(ziel, JSON.stringify(overlay, null, 2), 'utf8');

console.log(`\nEntwurf geschrieben: ${ziel}`);
if (e.unsicherheiten?.length) {
  console.log('\nVom Modell gemeldete Unsicherheiten - unbedingt prüfen:');
  for (const u of e.unsicherheiten) console.log(`  ! ${u}`);
}
const { fehler, warnungen } = pruefeKommune(overlay);
console.log('\nValidierung:');
for (const m of fehler) console.log(`  x ${m}`);
for (const m of warnungen) console.log(`  ! ${m}`);
if (!fehler.length) console.log('  Struktur ok - jetzt: Werte gegen die Satzung prüfen, Adresse/PLZ eintragen, status auf "geprueft" bzw. "freigegeben" setzen.');
console.log(`\nTokenverbrauch: ${antwort.usage.input_tokens} ein / ${antwort.usage.output_tokens} aus`);
