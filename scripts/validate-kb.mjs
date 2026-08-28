#!/usr/bin/env node
/**
 * Konsistenzpruefung der Wissensbasis.
 *
 * Prueft Pflichtfelder, Referenzen zwischen Leistungen, die Zuordnung zu
 * Clustern, Dubletten in Synonymen und die Vollstaendigkeit der Angaben, die
 * der Dialog spaeter vorliest. Faellt hier etwas auf, kann der Bot an dieser
 * Stelle keine belastbare Auskunft geben.
 */
import { CLUSTER, LEISTUNGEN, LEISTUNG_BY_ID, kennzahlen, leistungenImCluster, topLeistungen } from '../src/kb/index.js';
import { ASPEKT_BY_ID, ASPEKT_MENUE } from '../src/kb/schema.js';

const fehler = [];
const warnungen = [];

const pflichtFelder = [
  'id', 'cluster', 'name', 'sprechName', 'kurzbeschreibung', 'zustaendigkeit',
  'voraussetzungen', 'unterlagen', 'gebuehren', 'fristen', 'bearbeitungsdauer',
  'ablauf', 'rechtsgrundlagen', 'online', 'haeufigeFehler', 'faq', 'verwandt',
  'eskalation', 'belastbarkeit', 'stand',
];

const gebuehrenArten = new Set(['bundeseinheitlich', 'landesrecht', 'kommunal', 'einkommensabhaengig', 'keine', 'sonstige']);
const quellen = new Set(['bundesrecht', 'landesrecht-variiert', 'kommunal-variiert']);
const ebenen = new Set(['kommunal', 'land', 'bund', 'sonstige']);

// --- Cluster ---------------------------------------------------------------
const clusterIds = new Set();
for (const c of CLUSTER) {
  if (clusterIds.has(c.id)) fehler.push(`Cluster-ID doppelt: ${c.id}`);
  clusterIds.add(c.id);
  for (const f of ['name', 'sprechName', 'stichworte', 'grundsatzwissen']) {
    if (!c[f]) fehler.push(`Cluster ${c.id}: Feld "${f}" fehlt`);
  }
  const g = c.grundsatzwissen ?? {};
  for (const f of ['kurz', 'zustaendigkeit', 'faustregeln', 'typischeUnterlagen', 'typischeFristen', 'typischeKosten', 'onlineWege', 'rechtsrahmen', 'haeufigeIrrtuemer']) {
    if (!g[f]) fehler.push(`Cluster ${c.id}: grundsatzwissen.${f} fehlt`);
  }
  if ((g.faustregeln ?? []).length < 3) fehler.push(`Cluster ${c.id}: braucht mindestens 3 Faustregeln`);
  if ((c.stichworte ?? []).length < 10) warnungen.push(`Cluster ${c.id}: nur ${c.stichworte.length} Stichworte - Erkennung womoeglich schwach`);
  if (leistungenImCluster(c.id).length < 3) fehler.push(`Cluster ${c.id}: weniger als 3 Leistungen - Ziffernmenue 1/2/3 nicht fuellbar`);
}

// --- Leistungen ------------------------------------------------------------
const ids = new Set();
const synonymBelegung = new Map();

for (const l of LEISTUNGEN) {
  const pfad = `Leistung ${l.id ?? '(ohne id)'}`;
  for (const f of pflichtFelder) {
    if (l[f] === undefined || l[f] === null || (Array.isArray(l[f]) && l[f].length === 0)) {
      fehler.push(`${pfad}: Pflichtfeld "${f}" fehlt oder ist leer`);
    }
  }
  if (ids.has(l.id)) fehler.push(`${pfad}: ID doppelt vergeben`);
  ids.add(l.id);

  if (!clusterIds.has(l.cluster)) fehler.push(`${pfad}: unbekanntes Cluster "${l.cluster}"`);
  if (!ebenen.has(l.zustaendigkeit?.ebene)) fehler.push(`${pfad}: unbekannte Verwaltungsebene "${l.zustaendigkeit?.ebene}"`);
  if (!quellen.has(l.belastbarkeit?.quelle)) fehler.push(`${pfad}: unbekannte Belastbarkeitsquelle "${l.belastbarkeit?.quelle}"`);

  // Ablauf: durchnummeriert und beschrieben
  l.ablauf?.forEach((s, i) => {
    if (s.nr !== i + 1) fehler.push(`${pfad}: Ablaufschritt an Position ${i + 1} traegt nr=${s.nr}`);
    if (!s.titel || !s.detail) fehler.push(`${pfad}: Ablaufschritt ${s.nr} ohne Titel oder Detail`);
    const erlaubt = new Set(['nr', 'titel', 'detail', 'akteur']);
    for (const k of Object.keys(s)) if (!erlaubt.has(k)) fehler.push(`${pfad}: Ablaufschritt ${s.nr} hat unbekanntes Feld "${k}"`);
  });
  if ((l.ablauf?.length ?? 0) < 3) fehler.push(`${pfad}: Ablauf mit weniger als 3 Schritten ist nicht "im Detail beschrieben"`);

  // Unterlagen und Gebuehren
  l.unterlagen?.forEach((u) => {
    if (!u.was) fehler.push(`${pfad}: Unterlage ohne Bezeichnung`);
    if (typeof u.pflicht !== 'boolean') fehler.push(`${pfad}: Unterlage "${u.was}" ohne Pflicht-Kennzeichen`);
  });
  if (!l.unterlagen?.some((u) => u.pflicht)) warnungen.push(`${pfad}: keine einzige Pflichtunterlage - beabsichtigt?`);
  l.gebuehren?.forEach((g) => {
    if (!g.position || !g.betrag) fehler.push(`${pfad}: Gebuehrenposition unvollstaendig`);
    if (!gebuehrenArten.has(g.art)) fehler.push(`${pfad}: Gebuehrenart "${g.art}" bei "${g.position}" unbekannt`);
  });

  // FAQ
  l.faq?.forEach((f) => {
    if (!f.frage || !f.antwort) fehler.push(`${pfad}: FAQ-Eintrag unvollstaendig`);
  });
  if ((l.faq?.length ?? 0) < 2) warnungen.push(`${pfad}: weniger als 2 FAQ-Eintraege`);

  // Online
  if (typeof l.online?.moeglich !== 'boolean') fehler.push(`${pfad}: online.moeglich fehlt`);
  if (!l.online?.hinweis) fehler.push(`${pfad}: online.hinweis fehlt`);

  // Synonyme
  for (const s of l.synonyme ?? []) {
    const key = s.toLowerCase().trim();
    if (synonymBelegung.has(key) && synonymBelegung.get(key) !== l.id) {
      warnungen.push(`Synonym "${s}" wird von ${synonymBelegung.get(key)} und ${l.id} beansprucht`);
    }
    synonymBelegung.set(key, l.id);
  }
  if ((l.synonyme?.length ?? 0) < 4) warnungen.push(`${pfad}: nur ${l.synonyme?.length ?? 0} Synonyme - Spracherkennung braucht Varianten`);
}

// --- Querverweise ----------------------------------------------------------
for (const l of LEISTUNGEN) {
  for (const v of l.verwandt ?? []) {
    if (!LEISTUNG_BY_ID[v]) fehler.push(`Leistung ${l.id}: verwandt verweist auf unbekannte ID "${v}"`);
    if (v === l.id) fehler.push(`Leistung ${l.id}: verweist auf sich selbst`);
  }
}

// --- Aspektmenue -----------------------------------------------------------
for (const a of ASPEKT_MENUE) {
  if (!ASPEKT_BY_ID[a]) fehler.push(`Aspektmenue verweist auf unbekannten Aspekt "${a}"`);
}

// --- Ziffernmenue: jedes Cluster muss 3 Vorschlaege liefern koennen ---------
for (const c of CLUSTER) {
  if (topLeistungen(c.id, 3).length < 3) fehler.push(`Cluster ${c.id}: kann kein vollstaendiges 1/2/3-Menue bilden`);
}

// --- Ausgabe ---------------------------------------------------------------
const k = kennzahlen();
console.log('Wissensbasis Verwaltungs-Voice-Agent');
console.log('------------------------------------');
console.log(`Cluster (Stufe 1):        ${k.cluster}`);
console.log(`Leistungen (Stufe 2):     ${k.leistungen}`);
console.log(`Detailaspekte (Stufe 3):  ${k.aspekte}`);
console.log(`Prozessschritte:          ${k.prozessschritte}`);
console.log(`Unterlagen-Eintraege:     ${k.unterlagen}`);
console.log(`Gebuehrenpositionen:      ${k.gebuehren}`);
console.log(`Rechtsgrundlagen:         ${k.rechtsgrundlagen}`);
console.log(`FAQ-Eintraege:            ${k.faq}`);
console.log(`Synonyme:                 ${k.synonyme}`);
console.log('');
console.log(`Adressierbare Wissensknoten (Cluster + Leistung x Aspekt): ${k.cluster + k.leistungen * k.aspekte}`);
console.log('');

if (warnungen.length) {
  console.log(`Warnungen (${warnungen.length}):`);
  for (const w of warnungen) console.log(`  ! ${w}`);
  console.log('');
}
if (fehler.length) {
  console.log(`FEHLER (${fehler.length}):`);
  for (const f of fehler) console.log(`  x ${f}`);
  process.exit(1);
}
console.log('Alle Konsistenzpruefungen bestanden.');
