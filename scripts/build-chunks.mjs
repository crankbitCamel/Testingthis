#!/usr/bin/env node
/**
 * Exportiert die Wissensbasis als RAG-Korpus.
 *
 * Jeder Wissensknoten wird ein Chunk mit Text und Metadaten. Die Metadaten
 * sind der eigentliche Wert: Rechtsebene, Land, Registerbereich, Stand und
 * Quelle machen aus einer Aehnlichkeitssuche eine gefilterte Suche - und
 * erst Filterung macht Verwaltungs-RAG belastbar. Eine Kostenauskunft ohne
 * Ortsfilter ist keine Auskunft, sondern ein Zufallstreffer.
 *
 *   node scripts/build-chunks.mjs            -> dist/chunks.jsonl
 */
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { LEISTUNGEN, CLUSTER, CLUSTER_BY_ID } from '../src/kb/index.js';
import { ASPEKT_MENUE, ASPEKT_BY_ID } from '../src/kb/schema.js';
import { LAENDER_LISTE, registerbereichFuer } from '../src/kb/regional/index.js';
import { rechtsebene } from '../src/kb/ebenen.js';
import { aspektInhalt } from '../src/dialog.js';

const chunks = [];

function chunk({ id, typ, text, meta }) {
  chunks.push({
    id,
    typ,
    text: text.replace(/\s+/g, ' ').trim(),
    meta,
  });
}

// --- Stufe 1: Bereichswissen -------------------------------------------------
for (const c of CLUSTER) {
  const g = c.grundsatzwissen;
  chunk({
    id: `cluster:${c.id}`,
    typ: 'bereichswissen',
    text: [
      `Bereich: ${c.name}.`, g.kurz,
      `Zuständig: ${g.zustaendigkeit}`,
      `Faustregeln: ${g.faustregeln.join(' ')}`,
      `Typische Kosten: ${g.typischeKosten}`,
      `Typische Fristen: ${g.typischeFristen.join('; ')}`,
      `Häufige Irrtümer: ${g.haeufigeIrrtuemer.join(' ')}`,
    ].join(' '),
    meta: { ebene: 'gemischt', land: null, cluster: c.id, stand: '2026-08', quelle: g.rechtsrahmen.join('; ') },
  });
}

// --- Stufe 2/3: Leistung x Aspekt --------------------------------------------
for (const l of LEISTUNGEN) {
  const bereich = registerbereichFuer(l.id);
  for (const aspektId of [...ASPEKT_MENUE, 'rechtsgrundlagen', 'fehler', 'faq']) {
    const inhalt = aspektInhalt(l, aspektId);
    const listenText = inhalt.listen.map((li) => `${li.titel}: ${li.eintraege.join(' | ')}`).join(' ');
    const e = rechtsebene(l.id, aspektId);
    chunk({
      id: `leistung:${l.id}:${aspektId}`,
      typ: 'detailauskunft',
      text: `${l.name} — ${ASPEKT_BY_ID[aspektId].name}. ${inhalt.absaetze.join(' ')} ${listenText}`,
      meta: {
        leistung: l.id,
        leistungName: l.name,
        aspekt: aspektId,
        cluster: l.cluster,
        registerbereich: bereich?.id ?? null,
        ebene: e?.ebene.id ?? 'bund',
        ortsabhaengig: e?.ortsabhaengig ?? false,
        land: null,
        leika: l.leikaBezug,
        stand: l.stand,
        quelle: l.rechtsgrundlagen.slice(0, 2).join('; '),
        synonyme: l.synonyme,
      },
    });
  }
}

// --- Regionalschicht ---------------------------------------------------------
for (const land of LAENDER_LISTE) {
  for (const [bereichId, profil] of Object.entries(land.registerprofile)) {
    chunk({
      id: `regional:${land.code}:${bereichId}`,
      typ: 'landesprofil',
      text: `${land.name} — ${bereichId}. ${profil.kurz} ${(profil.fakten ?? []).join(' ')}`,
      meta: { land: land.code, registerbereich: bereichId, ebene: 'land', stand: land.stand, quelle: profil.quelleHinweis ?? null },
    });
  }
  for (const [leistungId, eintrag] of Object.entries(land.leistungen)) {
    const teile = [];
    if (eintrag.zustaendigkeit) teile.push(`Zuständig: ${eintrag.zustaendigkeit.stelle}. ${eintrag.zustaendigkeit.hinweis ?? ''}`);
    for (const g of eintrag.gebuehren ?? []) teile.push(`${g.position}: ${g.betrag}.`);
    for (const f of eintrag.fristen ?? []) teile.push(f);
    for (const b of eintrag.besonderheiten ?? []) teile.push(b);
    chunk({
      id: `regional:${land.code}:leistung:${leistungId}`,
      typ: 'landesoverlay',
      text: `${land.name} — ${leistungId}. ${teile.join(' ')}`,
      meta: {
        land: land.code, leistung: leistungId, ebene: 'land',
        stand: eintrag.stand, quelle: (eintrag.rechtsgrundlagen ?? []).join('; ') || null,
      },
    });
  }
}

// --- Kommunen-Overlays -------------------------------------------------------
// Nur redaktionell geprueftes Ortswissen erreicht das Korpus; Entwuerfe bleiben
// in extern/eingang/ und werden hier bewusst nicht eingelesen.
try {
  const ordner = new URL('../beispiele/kommunen/', import.meta.url);
  for (const datei of await readdir(ordner)) {
    if (!datei.endsWith('.json')) continue;
    const k = JSON.parse(await readFile(new URL(datei, ordner), 'utf8'));
    const stellen = Object.fromEntries((k.stellen ?? []).map((st) => [st.id, st]));
    for (const [leistungId, l] of Object.entries(k.leistungen ?? {})) {
      if (!['geprueft', 'freigegeben'].includes(l.status)) continue;
      const teile = [];
      const stelle = l.stelleRef ? stellen[l.stelleRef] : null;
      if (stelle) teile.push(`Anlaufstelle: ${stelle.name}, ${stelle.adresse.strasse}, ${stelle.adresse.plz} ${stelle.adresse.ort}.${stelle.telefon ? ` Telefon ${stelle.telefon}.` : ''}${stelle.oeffnungszeiten ? ` ${stelle.oeffnungszeiten}.` : ''}`);
      const terminLink = l.terminLink ?? stelle?.terminLink;
      if (terminLink) teile.push(`Termin: ${terminLink}.`);
      for (const g of l.gebuehren ?? []) teile.push(`${g.position}: ${g.betrag}${g.fundstelle ? ` (${g.fundstelle})` : ''}.`);
      for (const fr of l.fristen ?? []) teile.push(fr);
      for (const b of l.besonderheiten ?? []) teile.push(b);
      if (l.online) teile.push(`Online: ${l.online}`);
      chunk({
        id: `kommune:${k.ags}:${leistungId}`,
        typ: 'kommunaloverlay',
        text: `${k.name} — ${leistungId}. ${teile.join(' ')}`,
        meta: {
          ags: k.ags, land: k.land, leistung: leistungId, ebene: 'kommune',
          stand: k.stand, quelle: l.quelle?.rechtsgrundlage ?? null,
          geprueftAm: l.quelle?.geprueftAm ?? null,
        },
      });
    }
  }
} catch { /* Ordner darf fehlen */ }

await mkdir('dist', { recursive: true });
const jsonl = chunks.map((c) => JSON.stringify(c)).join('\n');
await writeFile('dist/chunks.jsonl', jsonl, 'utf8');

const proTyp = {};
for (const c of chunks) proTyp[c.typ] = (proTyp[c.typ] ?? 0) + 1;
console.log(`RAG-Korpus: ${chunks.length} Chunks -> dist/chunks.jsonl`);
for (const [t, n] of Object.entries(proTyp)) console.log(`  ${t}: ${n}`);
console.log(`Gesamtgröße: ${(Buffer.byteLength(jsonl) / 1024).toFixed(0)} kB`);
