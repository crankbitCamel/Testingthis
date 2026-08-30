#!/usr/bin/env node
/**
 * Validiert Kommunen-Overlay-Dateien gegen das Schema und die Basis.
 *
 * Geprueft wird mehr, als ein generischer JSON-Schema-Validator koennte:
 * Leistungs-IDs muessen in der Basis existieren, stelleRef muss aufloesen,
 * das AGS-Praefix muss zum Bundesland passen, Betrag und betragCent muessen
 * zusammenpassen, und ueberfaellige Pruefdaten werden gemeldet - denn ein
 * veralteter Konkretwert ist gefaehrlicher als eine ehrliche Spanne.
 *
 *   node scripts/validate-kommune.mjs beispiele/kommunen/*.json
 */
import { readFile } from 'node:fs/promises';
import { LEISTUNG_BY_ID } from '../src/kb/index.js';

const AGS_LAND = { '01': 'sh', '02': 'hh', '03': 'ni', '04': 'hb', '05': 'nw', '06': 'he', '07': 'rp', '08': 'bw', '09': 'by', 10: 'sl', 11: 'be', 12: 'bb', 13: 'mv', 14: 'sn', 15: 'st', 16: 'th', 99: null };

/** Prueft ein geparstes Overlay; liefert { fehler[], warnungen[] }. */
export function pruefeKommune(k, { heute = new Date() } = {}) {
  const fehler = [];
  const warnungen = [];
  const f = (m) => fehler.push(m);
  const w = (m) => warnungen.push(m);

  // Kopf
  if (!/^[0-9]{8}$/.test(k.ags ?? '')) f('ags: muss der 8-stellige Amtliche Gemeindeschlüssel sein');
  if (!k.name) f('name fehlt');
  if (!/^[0-9]{4}-[0-9]{2}$/.test(k.stand ?? '')) f('stand: Format JJJJ-MM');
  const praefix = (k.ags ?? '').slice(0, 2);
  if (praefix in AGS_LAND && AGS_LAND[praefix] && k.land !== AGS_LAND[praefix]) {
    f(`land "${k.land}" passt nicht zum AGS-Präfix ${praefix} (erwartet "${AGS_LAND[praefix]}")`);
  }

  // Stellen
  const stellenIds = new Set();
  for (const s of k.stellen ?? []) {
    if (!s.id || !/^[a-z0-9-]+$/.test(s.id)) f(`Stelle ohne gültige id: ${JSON.stringify(s.name ?? s)}`);
    if (stellenIds.has(s.id)) f(`Stellen-ID doppelt: ${s.id}`);
    stellenIds.add(s.id);
    if (!s.adresse?.strasse || !s.adresse?.ort) f(`Stelle ${s.id}: Adresse unvollständig`);
    if (s.adresse?.plz && !/^[0-9]{5}$/.test(s.adresse.plz)) f(`Stelle ${s.id}: PLZ ungültig`);
    if (s.terminLink && !/^https?:\/\//.test(s.terminLink)) f(`Stelle ${s.id}: terminLink ist keine URL`);
  }
  if (!stellenIds.size) f('mindestens eine Stelle ist erforderlich');

  // Leistungen
  const eintraege = Object.entries(k.leistungen ?? {});
  if (!eintraege.length) f('mindestens eine Leistung ist erforderlich');
  for (const [id, l] of eintraege) {
    const pfad = `leistungen.${id}`;
    if (!LEISTUNG_BY_ID[id]) f(`${pfad}: unbekannte Leistungs-ID - existiert nicht in der Basis`);
    if (l.stelleRef && !stellenIds.has(l.stelleRef)) f(`${pfad}: stelleRef "${l.stelleRef}" löst auf keine Stelle auf`);

    for (const g of l.gebuehren ?? []) {
      if (!g.position || !g.betrag) f(`${pfad}: Gebührenposition unvollständig`);
      if (g.betragCent !== undefined) {
        const m = String(g.betrag).match(/([0-9][0-9.]*),([0-9]{2})/);
        if (m) {
          const cent = Number(m[1].replace(/\./g, '')) * 100 + Number(m[2]);
          if (cent !== g.betragCent) f(`${pfad}: betrag "${g.betrag}" und betragCent ${g.betragCent} widersprechen sich (erwartet ${cent})`);
        }
      } else {
        w(`${pfad}: "${g.position}" ohne betragCent - Plausibilitätsprüfungen entfallen`);
      }
      if (!g.fundstelle) w(`${pfad}: "${g.position}" ohne Fundstelle in der Satzung`);
    }

    const q = l.quelle;
    if (!q?.rechtsgrundlage) f(`${pfad}: quelle.rechtsgrundlage fehlt - ohne Herkunft keine Auskunft`);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(q?.geprueftAm ?? '')) {
      f(`${pfad}: quelle.geprueftAm fehlt oder Format falsch (JJJJ-MM-TT)`);
    } else {
      const geprueft = new Date(q.geprueftAm);
      const intervall = q.pruefintervallMonate ?? 12;
      const faellig = new Date(geprueft);
      faellig.setMonth(faellig.getMonth() + intervall);
      if (faellig < heute) w(`${pfad}: Prüfung überfällig seit ${faellig.toISOString().slice(0, 10)} - Eintrag würde zur Laufzeit auf die Landes-/Bundesebene degradiert`);
    }

    if (l.status && !['entwurf', 'geprueft', 'freigegeben'].includes(l.status)) f(`${pfad}: unbekannter status "${l.status}"`);
    if (!l.status) w(`${pfad}: status fehlt - wird als "entwurf" behandelt`);
  }

  return { fehler, warnungen };
}

// --- Aufruf von der Kommandozeile -------------------------------------------
const dateien = process.argv.slice(2);
if (dateien.length && import.meta.url === `file://${process.argv[1]}`) {
  let gesamtFehler = 0;
  for (const datei of dateien) {
    let daten;
    try {
      daten = JSON.parse(await readFile(datei, 'utf8'));
    } catch (e) {
      console.log(`${datei}\n  x Kein gültiges JSON: ${e.message}`);
      gesamtFehler += 1;
      continue;
    }
    const { fehler, warnungen } = pruefeKommune(daten);
    console.log(`${datei}  (${daten.name ?? '?'}, AGS ${daten.ags ?? '?'})`);
    for (const m of fehler) console.log(`  x ${m}`);
    for (const m of warnungen) console.log(`  ! ${m}`);
    if (!fehler.length && !warnungen.length) console.log('  ok');
    gesamtFehler += fehler.length;
  }
  process.exit(gesamtFehler ? 1 : 0);
}
