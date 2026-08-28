#!/usr/bin/env node
/**
 * Baut die Anwendung zu einer einzelnen HTML-Datei zusammen.
 *
 * Fuer den normalen Betrieb ist das nicht noetig - `npm start` liefert die
 * ES-Module direkt aus. Die Einzeldatei ist fuer Faelle gedacht, in denen kein
 * Server zur Verfuegung steht: Weitergabe per Mail, Ablage in einem Intranet,
 * Veroeffentlichung als statische Seite.
 *
 * Gebuendelt wird mit esbuild, das ueber npx geladen wird - das Projekt selbst
 * bleibt dadurch ohne Abhaengigkeiten.
 *
 *   node scripts/build-single-file.mjs [zieldatei]
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ZIEL = resolve(process.argv[2] ?? `${WURZEL}/dist/verwaltungsassistent.html`);
const TEMP = `${WURZEL}/dist/.bundle.js`;

await mkdir(dirname(ZIEL), { recursive: true });
await mkdir(dirname(TEMP), { recursive: true });

const esbuild = process.env.ESBUILD ?? 'npx';
const argumente = process.env.ESBUILD
  ? [`${WURZEL}/src/main.js`, '--bundle', '--format=iife', '--target=es2022', `--outfile=${TEMP}`]
  : ['--yes', 'esbuild', `${WURZEL}/src/main.js`, '--bundle', '--format=iife', '--target=es2022', `--outfile=${TEMP}`];

console.log('Bündele JavaScript …');
execFileSync(esbuild, argumente, { stdio: 'inherit' });

const [html, css, js] = await Promise.all([
  readFile(`${WURZEL}/index.html`, 'utf8'),
  readFile(`${WURZEL}/styles/app.css`, 'utf8'),
  readFile(TEMP, 'utf8'),
]);

let einzeldatei = html
  .replace('<link rel="stylesheet" href="styles/app.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="src/main.js"></script>', `<script>\n${js}\n</script>`);

// Fuer Umgebungen, die die Seite in ein vorhandenes Dokumentgeruest einbetten
// (etwa eine Artefakt-Veroeffentlichung), wird das eigene Geruest entfernt und
// nur Titel, Stil und Inhalt ausgegeben.
if (process.argv.includes('--eingebettet')) {
  const titel = einzeldatei.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '';
  const stil = einzeldatei.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? '';
  const koerper = einzeldatei.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '';
  einzeldatei = `${titel}\n${stil}\n${koerper.trim()}\n`;
}

await writeFile(ZIEL, einzeldatei, 'utf8');
await rm(TEMP, { force: true });

const groesse = (Buffer.byteLength(einzeldatei) / 1024).toFixed(0);
console.log(`Fertig: ${ZIEL} (${groesse} kB, ohne externe Abhängigkeiten)`);
