#!/usr/bin/env node
/**
 * Minimaler statischer Server ohne Abhaengigkeiten.
 * Die Anwendung braucht keinen Build-Schritt: Sie besteht aus ES-Modulen,
 * die der Browser direkt laedt. Der Server liefert nur Dateien aus.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gespraechsschritt, llmKonfiguriert } from '../server/assistent.mjs';

const WURZEL = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 4115);
const HOST = process.env.HOST ?? '127.0.0.1';

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function json(antwort, status, daten) {
  antwort.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    .end(JSON.stringify(daten));
}

async function koerperLesen(anfrage, maxBytes = 64 * 1024) {
  let groesse = 0;
  const teile = [];
  for await (const teil of anfrage) {
    groesse += teil.length;
    if (groesse > maxBytes) throw new Error('Anfrage zu groß');
    teile.push(teil);
  }
  return JSON.parse(Buffer.concat(teile).toString('utf8') || '{}');
}

const server = createServer(async (anfrage, antwort) => {
  try {
    const url = new URL(anfrage.url, `http://${anfrage.headers.host}`);

    // --- API: LLM-Assistenzmodus ------------------------------------------
    if (url.pathname === '/api/status') {
      json(antwort, 200, { llm: llmKonfiguriert() ? 'bereit' : 'mock', modell: process.env.ASSISTENT_MODELL ?? 'claude-opus-5' });
      return;
    }
    if (url.pathname === '/api/assistent' && anfrage.method === 'POST') {
      try {
        const { nachricht, verlauf, land } = await koerperLesen(anfrage);
        if (!nachricht || typeof nachricht !== 'string') {
          json(antwort, 400, { fehler: 'Feld "nachricht" fehlt' });
          return;
        }
        const ergebnis = await gespraechsschritt({ nachricht, verlauf: Array.isArray(verlauf) ? verlauf : [], land: land || null });
        json(antwort, 200, ergebnis);
      } catch (fehler) {
        json(antwort, 500, { fehler: fehler.message });
      }
      return;
    }

    // --- Statische Dateien -------------------------------------------------
    let pfad = decodeURIComponent(url.pathname);
    if (pfad === '/') pfad = '/index.html';

    // Pfadausbruch verhindern
    const ziel = join(WURZEL, normalize(pfad).replace(/^(\.\.[/\\])+/, ''));
    if (!ziel.startsWith(WURZEL)) {
      antwort.writeHead(403).end('Zugriff verweigert');
      return;
    }

    const info = await stat(ziel).catch(() => null);
    if (!info?.isFile()) {
      antwort.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('Nicht gefunden');
      return;
    }

    const inhalt = await readFile(ziel);
    antwort.writeHead(200, {
      'Content-Type': TYPEN[extname(ziel)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(inhalt);
  } catch (fehler) {
    antwort.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end(`Serverfehler: ${fehler.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Verwaltungsassistent laeuft auf http://${HOST}:${PORT}`);
  console.log('Beenden mit Strg+C');
});
