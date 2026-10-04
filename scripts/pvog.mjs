#!/usr/bin/env node
/**
 * PVOG-Abruf: Leistungsbeschreibungen von Bund, Ländern und Kommunen aus dem
 * Portalverbund Online-Gateway (FITKO, Suchdienst-API), je Kommune und
 * LeiKa-Schlüssel, mit Quelle und Stand.
 *
 *   node scripts/pvog.mjs zuordnen [--ort Köln]
 *       Sucht für jede Leistung der Wissensbasis die passende PVOG-Leistung
 *       und deren 14-stellige LeiKa-Schlüssel. Ergebnis zur Durchsicht:
 *       data/pvog/leika-zuordnung.json (Feld "geprueft" von Hand setzen).
 *
 *   node scripts/pvog.mjs abrufen [--top 10 | --orte Köln,München] [--leistungen reisepass,hundesteuer]
 *       Holt je Kommune und Leistung die Beschreibung (eine Anfrage, die
 *       Schlüsselsuche liefert alle Module mit) und schreibt sie normalisiert
 *       nach data/pvog/ergebnisse/<ARS>.json, dazu eine Übersicht
 *       data/pvog/uebersicht.csv mit Spalten für fehlende Gebühr/Quelle.
 *
 * API: https://pvog.fitko.net/suchdienst/api, öffentlich, kein Login. Pflicht
 * ist der Header pvog-sud-api-client-id. Standard ist die ID des öffentlichen
 * PVOG-Frontends; für den Dauerbetrieb bei FITKO eine eigene ID beantragen und
 * per PVOG_CLIENT_ID setzen. Antworten werden in data/pvog/cache/ zwischen-
 * gespeichert (nicht im Repository), damit Wiederholungen nichts kosten.
 *
 * Harte Regel für die Weiterverwendung: Ohne Quelle keine Zahl. Jeder
 * Datensatz trägt Quell-URL (Ursprungsportal bzw. Online-Dienst der Stadt),
 * Freigabestelle, Freigabedatum und Abrufzeit.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATEN = join(WURZEL, 'data', 'pvog');
const CACHE = join(DATEN, 'cache');
const API = process.env.PVOG_API ?? 'https://pvog.fitko.net/suchdienst/api';
const CLIENT_ID = process.env.PVOG_CLIENT_ID ?? '99155224-c3f8-45f1-b1e6-fe8650ddc593';
const PARALLEL = Number(process.env.PVOG_PARALLEL ?? 4);
const ABSTAND_MS = Number(process.env.PVOG_ABSTAND_MS ?? 120);

// ------------------------------------------------------------------ HTTP --
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let letzterStart = 0;
let aktiv = 0;
const warte = [];
let anfragen = 0;
let ausCache = 0;

async function slot() {
  if (aktiv >= PARALLEL) await new Promise((r) => warte.push(r));
  aktiv += 1;
  const jetzt = Date.now();
  const naechster = Math.max(jetzt, letzterStart + ABSTAND_MS);
  letzterStart = naechster;
  if (naechster > jetzt) await pause(naechster - jetzt);
}
function frei() { aktiv -= 1; warte.shift()?.(); }

export async function pvogGet(pfad, query = {}, { cache = true } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    for (const w of [].concat(v)) if (w !== undefined && w !== null) qs.append(k, String(w));
  }
  const url = `${API}${pfad}?${qs}`;
  const datei = join(CACHE, `${createHash('sha1').update(url).digest('hex')}.json`);
  if (cache && existsSync(datei)) { ausCache += 1; return JSON.parse(readFileSync(datei, 'utf8')); }

  for (let versuch = 1; versuch <= 4; versuch += 1) {
    await slot();
    let antwort;
    try {
      antwort = await fetch(url, {
        headers: { 'pvog-sud-api-client-id': CLIENT_ID, 'accept-language': 'de', accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (fehler) {
      frei();
      if (versuch === 4) throw fehler;
      await pause(1000 * versuch);
      continue;
    }
    frei();
    anfragen += 1;
    if (antwort.ok) {
      const daten = await antwort.json();
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(datei, JSON.stringify(daten));
      return daten;
    }
    const text = await antwort.text();
    if ((antwort.status === 429 || antwort.status >= 500) && versuch < 4) {
      const ra = Number(antwort.headers.get('retry-after'));
      await pause(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * versuch);
      continue;
    }
    throw new Error(`PVOG ${antwort.status} ${pfad}: ${text.slice(0, 200)}`);
  }
  throw new Error(`PVOG ${pfad}: keine Antwort`);
}

async function parallel(liste, fn) {
  return Promise.all(liste.map((x, i) => fn(x, i)));
}

// ---------------------------------------------------------- Normalisieren --
const ohneHtml = (h) => String(h ?? '')
  .replace(/<\/(p|li|ul|ol|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
  .replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

const LEER = /^(nicht angegeben|keine angabe|-)?$/i;

/** Alle Euro-Beträge eines Textes: "70,00 EUR", "37,50 €", "70 Euro". */
export function betraegeAus(text) {
  const funde = [];
  const re = /(\d{1,4}(?:\.\d{3})*(?:,\d{1,2})?)\s*(?:€|EUR\b|Euro\b)/gi;
  for (const m of String(text ?? '').matchAll(re)) {
    const wert = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(wert)) funde.push(wert);
  }
  return [...new Set(funde)];
}

/** Eine PVOG-Leistungsbeschreibung in feste Felder überführen. */
export function normalisiere(roh, { kommune, leistungId, leika, abgerufen = new Date().toISOString() }) {
  const module = new Map();
  for (const m of roh.details ?? []) module.set(String(m.code), m);
  const text = (code) => {
    const m = module.get(code);
    const t = ohneHtml(m?.text);
    return m && !m.placeholder && !LEER.test(t) ? t : null;
  };
  const links = (code) => (module.get(code)?.links ?? []).map((l) => ({ titel: l.title ?? null, uri: l.uri })).filter((l) => l.uri);
  const unterDetails = (code) => (module.get(code)?.details ?? []).map((d) => ({ titel: d.title ?? null, text: ohneHtml(d.text) || null }));

  const kostenText = text('98');
  const kostenDetails = unterDetails('98');
  const betraege = betraegeAus([kostenText, ...kostenDetails.map((d) => `${d.titel ?? ''} ${d.text ?? ''}`)].join('\n'));
  const freigabe = module.get('93');
  const quellen = [
    ...(roh.sourcePortals ?? []).map((p) => ({ art: 'ursprungsportal', titel: p.title ?? null, uri: p.uri })),
    ...links('94').map((l) => ({ art: 'ursprungsportal', ...l })),
  ].filter((q) => q.uri && !/^http:\/\/portal\//.test(q.uri));

  return {
    leistungId,
    leika,
    pvogId: roh.id,
    pvogName: roh.name,
    leikakeys: roh.leikakeys ?? [],
    kommune: { ars: kommune.ars, name: kommune.name, bundesland: kommune.bundesland },
    gueltigFuerArs: roh.ars ?? [],
    // Geltungsbereich der Beschreibung (nicht die Rechtsebene): bundesweit,
    // landesweit oder fuer die Kommune bzw. den Kreis geschrieben.
    ebene: (roh.ars ?? []).some((a) => /^00/.test(a)) ? 'bundesweit' : (roh.ars ?? []).some((a) => /^\d{2}0{10}$/.test(a)) ? 'landesweit' : 'kommunal',
    kurzinfo: text('24'),
    beschreibung: text('06'),
    voraussetzungen: text('09'),
    unterlagen: text('08'),
    gebuehren: {
      text: kostenText,
      details: kostenDetails,
      betraegeEuro: betraege,
      strukturiert: kostenDetails.length > 0,
    },
    fristen: text('97'),
    fristenDetails: unterDetails('97'),
    bearbeitungsdauer: text('95') ?? (unterDetails('95')[0]?.text ?? null),
    ablauf: text('11'),
    hinweise: text('16'),
    rechtsgrundlagen: links('07'),
    weiterfuehrend: links('15'),
    onlineDienste: (roh.onlineServiceLinks ?? []).map((o) => ({ titel: o.title ?? null, uri: o.uri })).filter((o) => o.uri),
    zustaendig: roh.organisationIds ?? [],
    freigabe: freigabe ? { stelle: ohneHtml(freigabe.text) || null, datum: freigabe.date ?? null } : null,
    quellen,
    pvogStand: roh.externalLastUpdate ?? roh.lastUpdate ?? null,
    abgerufen,
  };
}

// --------------------------------------------------------------- Zuordnen --
async function kbLeistungen() {
  const { LEISTUNGEN } = await import('../src/kb/index.js');
  return LEISTUNGEN;
}

async function arsFuer(name) {
  const treffer = await pvogGet('/v3/locations', { q: name, limit: 5, filterBy: 'ORT' });
  const exakt = treffer.find((t) => t.gemeinde === name || t.name === name) ?? treffer[0];
  if (!exakt) throw new Error(`Ort nicht gefunden: ${name}`);
  return { ars: exakt.ars, name: exakt.gemeinde ?? exakt.name };
}

const woerter = (s) => new Set(String(s).toLowerCase().replace(/[^a-zäöüß0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
function aehnlich(a, b) {
  const A = woerter(a); const B = woerter(b);
  if (!A.size || !B.size) return 0;
  let gemeinsam = 0;
  for (const w of A) if ([...B].some((x) => x.startsWith(w.slice(0, 6)) || w.startsWith(x.slice(0, 6)))) gemeinsam += 1;
  return gemeinsam / Math.max(A.size, B.size);
}

async function zuordnen({ ort = 'Köln' } = {}) {
  const leistungen = await kbLeistungen();
  const o = await arsFuer(ort);
  console.log(`Zuordnung über Suche in ${o.name} (${o.ars}), ${leistungen.length} Leistungen ...`);
  const datei = join(DATEN, 'leika-zuordnung.json');
  const alt = existsSync(datei) ? JSON.parse(readFileSync(datei, 'utf8')).leistungen ?? {} : {};
  const ergebnis = {};

  await parallel(leistungen, async (l) => {
    // Geprüfte Zuordnungen nie überschreiben.
    if (alt[l.id]?.geprueft) { ergebnis[l.id] = alt[l.id]; return; }
    const suchen = [l.name, ...(l.synonyme ?? []).slice(0, 1)];
    const kandidaten = new Map();
    for (const q of suchen) {
      const r = await pvogGet('/v8beta1/servicedescriptions', { ars: o.ars, q, page: 0, size: 5, useArsHierarchy: true });
      for (const sd of r.serviceDescriptions?.content ?? []) {
        if (kandidaten.has(sd.id)) continue;
        kandidaten.set(sd.id, { pvogId: sd.id, pvogName: sd.name, score: aehnlich(l.name, sd.name) });
      }
    }
    const liste = [...kandidaten.values()].sort((a, b) => b.score - a.score).slice(0, 4);
    // LeiKa-Schlüssel stehen nur in der Detailansicht.
    for (const k of liste) {
      try {
        const d = await pvogGet(`/v6/servicedescriptions/${encodeURIComponent(k.pvogId)}/detail`, { ars: o.ars, applyDynamicParams: true });
        k.leikakeys = d.leikakeys ?? [];
      } catch { k.leikakeys = []; }
    }
    const bester = liste.find((k) => k.leikakeys.length) ?? null;
    ergebnis[l.id] = {
      name: l.name,
      leikaAlt: l.leikaBezug ?? null,
      leika: bester ? bester.leikakeys[0] : null,
      pvogName: bester?.pvogName ?? null,
      score: bester ? Number(bester.score.toFixed(2)) : 0,
      geprueft: false,
      kandidaten: liste,
    };
  });

  const sortiert = Object.fromEntries(leistungen.map((l) => [l.id, ergebnis[l.id]]));
  mkdirSync(DATEN, { recursive: true });
  writeFileSync(datei, JSON.stringify({
    hinweis: 'Automatisch über die PVOG-Suche zugeordnet. Bitte je Leistung prüfen, ggf. "leika" aus den Kandidaten wählen und "geprueft": true setzen.',
    referenzort: o, erstellt: new Date().toISOString(), leistungen: sortiert,
  }, null, 1));
  const ohne = Object.values(sortiert).filter((x) => !x.leika).length;
  const unsicher = Object.values(sortiert).filter((x) => x.leika && x.score < 0.5).length;
  console.log(`Fertig: ${leistungen.length - ohne} zugeordnet, davon ${unsicher} unsicher (Score < 0,5), ${ohne} ohne Treffer -> ${datei}`);
}

// ---------------------------------------------------------------- Abrufen --
function argWert(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function abrufen() {
  const zDatei = join(DATEN, 'leika-zuordnung.json');
  if (!existsSync(zDatei)) throw new Error('Zuerst: node scripts/pvog.mjs zuordnen');
  const zuordnung = JSON.parse(readFileSync(zDatei, 'utf8')).leistungen;
  const alleKommunen = JSON.parse(readFileSync(join(DATEN, 'kommunen-top200.json'), 'utf8')).kommunen;

  let kommunen;
  if (argWert('orte')) {
    const namen = argWert('orte').split(',').map((s) => s.trim());
    kommunen = namen.map((n) => alleKommunen.find((k) => k.name === n) ?? (() => { throw new Error(`Nicht in Top 200: ${n}`); })());
  } else {
    kommunen = alleKommunen.slice(0, Number(argWert('top') ?? 10));
  }
  const nur = argWert('leistungen')?.split(',');
  const paare = Object.entries(zuordnung).filter(([id, z]) => z?.leika && (!nur || nur.includes(id)));
  console.log(`Abruf: ${kommunen.length} Kommunen x ${paare.length} Leistungen = ${kommunen.length * paare.length} Anfragen (Cache zählt nicht)`);

  const zeilen = [];
  mkdirSync(join(DATEN, 'ergebnisse'), { recursive: true });
  const beginn = Date.now();
  for (const [ki, kommune] of kommunen.entries()) {
    const saetze = [];
    await parallel(paare, async ([leistungId, z]) => {
      let satz = null;
      let fehler = null;
      try {
        const r = await pvogGet('/v2/servicedescriptions/leikahierarchy', { ars: kommune.ars, leikaIds: z.leika, page: 0, size: 5 });
        const treffer = (r.content ?? []);
        // Genauester Treffer: der mit dem gesuchten Schlüssel, bevorzugt kommunal.
        const passend = treffer.filter((t) => (t.leikakeys ?? []).includes(z.leika));
        const tief = (t) => Math.max(...(t.ars ?? ['0']).map((a) => a.replace(/0+$/, '').length));
        const roh = (passend.length ? passend : treffer).sort((a, b) => tief(b) - tief(a))[0];
        if (roh) {
          // Die Detailansicht ergaenzt, was die Schluesselsuche nicht liefert:
          // fachliche Freigabe (Stelle + Datum), Ursprungsportal und die
          // zustaendigen Stellen mit Namen. Module der Detailansicht haben Vorrang.
          let detail = null;
          try {
            detail = await pvogGet(`/v6/servicedescriptions/${encodeURIComponent(roh.id)}/detail`, { ars: kommune.ars, applyDynamicParams: true });
          } catch { /* ohne Detail weiter, Satz bleibt gueltig */ }
          const zusammen = detail ? { ...roh, ...detail, sourcePortals: roh.sourcePortals ?? detail.sourcePortals } : roh;
          satz = normalisiere(zusammen, { kommune, leistungId, leika: z.leika });
          if (detail?.organisations?.length) {
            satz.zustaendig = detail.organisations
              .filter((o) => /zuständig/i.test(o.role?.name ?? ''))
              .map((o) => o.title).filter(Boolean).slice(0, 10);
          }
        }
      } catch (f) { fehler = f.message; }
      if (satz) saetze.push(satz);
      zeilen.push({
        ars: kommune.ars, kommune: kommune.name, bundesland: kommune.bundesland, leistung: leistungId, leika: z.leika,
        gefunden: Boolean(satz), ebene: satz?.ebene ?? '', pvogName: satz?.pvogName ?? '',
        gebuehrStrukturiert: satz?.gebuehren.strukturiert ?? false,
        gebuehrBetraege: satz?.gebuehren.betraegeEuro.join(' / ') ?? '',
        gebuehrFehlt: satz ? !satz.gebuehren.text && !satz.gebuehren.strukturiert : true,
        onlineDienst: satz?.onlineDienste[0]?.uri ?? '',
        quelle: satz?.quellen[0]?.uri ?? satz?.onlineDienste[0]?.uri ?? '',
        quelleFehlt: satz ? !(satz.quellen.length || satz.onlineDienste.length) : true,
        freigabeStelle: satz?.freigabe?.stelle ?? '', freigabeDatum: satz?.freigabe?.datum ?? '',
        pvogStand: satz?.pvogStand ?? '', fehler: fehler ?? '',
      });
    });
    saetze.sort((a, b) => a.leistungId.localeCompare(b.leistungId));
    writeFileSync(join(DATEN, 'ergebnisse', `${kommune.ars}.json`), JSON.stringify({ kommune, abgerufen: new Date().toISOString(), leistungen: saetze }, null, 1));
    const sek = Math.round((Date.now() - beginn) / 1000);
    console.log(`  [${ki + 1}/${kommunen.length}] ${kommune.name}: ${saetze.length}/${paare.length} gefunden (${sek} s, ${anfragen} Anfragen, ${ausCache} aus Cache)`);
  }

  // Übersicht als CSV (Excel-tauglich: Semikolon, UTF-8 mit BOM).
  const spalten = Object.keys(zeilen[0] ?? {});
  const esc = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  zeilen.sort((a, b) => a.ars.localeCompare(b.ars) || a.leistung.localeCompare(b.leistung));
  writeFileSync(join(DATEN, 'uebersicht.csv'), `﻿${[spalten.join(';'), ...zeilen.map((z) => spalten.map((s) => esc(z[s])).join(';'))].join('\n')}\n`);

  const n = zeilen.length;
  const zaehl = (f) => zeilen.filter(f).length;
  console.log(`\nAbdeckung über ${n} Kombinationen:`);
  console.log(`  gefunden            ${zaehl((z) => z.gefunden)}`);
  console.log(`  Gebühr vorhanden    ${zaehl((z) => z.gefunden && !z.gebuehrFehlt)} (davon strukturiert ${zaehl((z) => z.gebuehrStrukturiert)})`);
  console.log(`  Betrag erkannt      ${zaehl((z) => z.gebuehrBetraege)}`);
  console.log(`  Quelle vorhanden    ${zaehl((z) => !z.quelleFehlt)}`);
  console.log(`  Freigabedatum       ${zaehl((z) => z.freigabeDatum)}`);
  console.log(`  Fehler              ${zaehl((z) => z.fehler)}`);
  console.log(`-> data/pvog/ergebnisse/*.json, data/pvog/uebersicht.csv`);
}

// ------------------------------------------------------------------ Paket --
// Alle Ergebnisse als ein komprimiertes Paket fuers Repository: identische
// Textbloecke (Landes- und Bundestexte wiederholen sich je Kommune) stehen
// nur einmal drin. ~10.000 Saetze -> ~8 MB statt ~80 MB.
export const PAKET = join(DATEN, 'pvog-paket.json.gz');
const TEXTFELDER = ['kurzinfo', 'beschreibung', 'voraussetzungen', 'unterlagen', 'gebuehren', 'fristen',
  'fristenDetails', 'bearbeitungsdauer', 'ablauf', 'hinweise', 'rechtsgrundlagen', 'weiterfuehrend'];

async function paketBauen() {
  const { readdirSync } = await import('node:fs');
  const { gzipSync } = await import('node:zlib');
  const verzeichnis = join(DATEN, 'ergebnisse');
  const texte = {};
  const zeilen = [];
  for (const datei of readdirSync(verzeichnis).filter((f) => f.endsWith('.json')).sort()) {
    for (const s of JSON.parse(readFileSync(join(verzeichnis, datei), 'utf8')).leistungen) {
      const t = Object.fromEntries(TEXTFELDER.map((k) => [k, s[k] ?? null]));
      const id = createHash('sha1').update(JSON.stringify(t)).digest('hex').slice(0, 16);
      texte[id] = t;
      const rest = Object.fromEntries(Object.entries(s).filter(([k]) => !TEXTFELDER.includes(k)));
      zeilen.push({ ...rest, textId: id });
    }
  }
  const paket = { erstellt: new Date().toISOString(), quelle: API, anzahl: zeilen.length, texte, zeilen };
  writeFileSync(PAKET, gzipSync(JSON.stringify(paket), { level: 9 }));
  console.log(`Paket: ${zeilen.length} Saetze, ${Object.keys(texte).length} Textbloecke -> ${PAKET}`);
}

/** Paket lesen und Saetze wieder vollstaendig zusammensetzen. */
export async function paketLesen(datei = PAKET) {
  const { gunzipSync } = await import('node:zlib');
  const p = JSON.parse(gunzipSync(readFileSync(datei)).toString('utf8'));
  return { ...p, saetze: p.zeilen.map((z) => ({ ...z, ...p.texte[z.textId] })) };
}

// ----------------------------------------------------------------- Start --
const befehl = process.argv[2];
if (befehl === 'zuordnen') await zuordnen({ ort: argWert('ort') ?? 'Köln' });
else if (befehl === 'abrufen') await abrufen();
else if (befehl === 'paket') await paketBauen();
else if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Aufruf: node scripts/pvog.mjs zuordnen [--ort Köln] | abrufen [--top 10 | --orte Köln,München] [--leistungen a,b]');
}
