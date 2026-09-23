#!/usr/bin/env node
/**
 * Minimaler statischer Server ohne Abhaengigkeiten.
 * Die Anwendung braucht keinen Build-Schritt: Sie besteht aus ES-Modulen,
 * die der Browser direkt laedt. Der Server liefert nur Dateien aus.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gespraechsschritt, llmKonfiguriert, anbieter } from '../server/assistent.mjs';
import { sprachwahl, sprachSetzen, einwilligungSetzen, anrufEingabe, anrufWarten } from '../server/telefon.mjs';
import {
  jambonzAnruf, jambonzSprache, jambonzEinwilligung, jambonzEingabe, jambonzStatus, signaturPruefen,
} from '../server/jambonz.mjs';
import { protokolliere } from '../server/gespraechslog.mjs';

const WURZEL = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 4115);
const HOST = process.env.HOST ?? '127.0.0.1';

// Verzeichnisse, die der Browser-Dialog laden darf. Alles andere ist 404.
const STATISCH = ['/src/', '/styles/', '/dist/', '/vorlagen/', '/schema/', '/beispiele/'];

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

async function rohLesen(anfrage, maxBytes = 64 * 1024) {
  let groesse = 0;
  const teile = [];
  for await (const teil of anfrage) {
    groesse += teil.length;
    if (groesse > maxBytes) throw new Error('Anfrage zu groß');
    teile.push(teil);
  }
  return Buffer.concat(teile).toString('utf8');
}

async function koerperLesen(anfrage, maxBytes = 64 * 1024) {
  return JSON.parse((await rohLesen(anfrage, maxBytes)) || '{}');
}

/** Twilio sendet application/x-www-form-urlencoded, kein JSON. */
async function formularLesen(anfrage) {
  return Object.fromEntries(new URLSearchParams(await rohLesen(anfrage)));
}

function xml(antwort, inhalt) {
  antwort.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' }).end(inhalt);
}

const server = createServer(async (anfrage, antwort) => {
  try {
    const url = new URL(anfrage.url, `http://${anfrage.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      console.log(new Date().toISOString(), anfrage.method, url.pathname,
        `(Host ${anfrage.headers['x-forwarded-host'] || anfrage.headers.host || '?'})`);
    }

    // --- API: LLM-Assistenzmodus ------------------------------------------
    if (url.pathname === '/api/status') {
      const prov = anbieter();
      const modell = prov === 'mistral'
        ? (process.env.MISTRAL_MODELL || 'ministral-14b-latest')
        : (process.env.ASSISTENT_MODELL || 'claude-opus-5');
      json(antwort, 200, {
        llm: llmKonfiguriert() ? 'bereit' : 'mock',
        anbieter: prov,
        modell,
      });
      return;
    }
    if (url.pathname === '/api/assistent' && anfrage.method === 'POST') {
      try {
        const koerper = await koerperLesen(anfrage);
        const { nachricht, verlauf, land } = (koerper && typeof koerper === 'object') ? koerper : {};
        if (!nachricht || typeof nachricht !== 'string' || nachricht.length > 2000) {
          json(antwort, 400, { fehler: 'Feld "nachricht" fehlt oder ist zu lang (max. 2000 Zeichen)' });
          return;
        }
        // Verlauf kommt vom Client: nur bekannte Rollen, nur Strings, begrenzt -
        // sonst liessen sich dem Modell fremde "Assistentenaussagen" unterschieben.
        const verlaufSicher = (Array.isArray(verlauf) ? verlauf : [])
          .filter((r) => r && (r.rolle === 'nutzer' || r.rolle === 'bot') && typeof r.text === 'string')
          .slice(-24)
          .map((r) => ({ rolle: r.rolle, text: r.text.slice(0, 2000) }));
        const landSicher = land === 'nw' || land === 'rp' ? land : null;
        const beginn = Date.now();
        const ergebnis = await gespraechsschritt({ nachricht, verlauf: verlaufSicher, land: landSicher });
        json(antwort, 200, ergebnis);
        protokolliere({
          kanal: 'browser', land: land || null, frage: nachricht,
          antwort: ergebnis.text, modus: ergebnis.modus, modell: ergebnis.modell,
          quellen: ergebnis.quellen, werkzeuge: ergebnis.werkzeuge,
          dauerMs: Date.now() - beginn, beendet: Boolean(ergebnis.beendet),
        });
      } catch (fehler) {
        // Details nur ins Server-Log, nicht zum Client (keine Pfade, keine
        // Upstream-Fehlertexte nach aussen).
        console.error('  assistent:', fehler.message);
        json(antwort, fehler instanceof SyntaxError ? 400 : 500, { fehler: 'Anfrage konnte nicht verarbeitet werden' });
      }
      return;
    }

    // --- API: Telefonie (Twilio-Voice-Webhooks) ---------------------------
    // Oeffentliche Basis (Protokoll + Host), damit das TwiML VOLLSTAENDIGE
    // action-Adressen liefern kann. Hinter dem Tunnel traegt der Host-Header
    // (bzw. X-Forwarded-Host) den oeffentlichen Namen; lokal ist es
    // 127.0.0.1 - dann bleibt die Adresse relativ.
    const oeffHost = anfrage.headers['x-forwarded-host'] || anfrage.headers.host || '';
    const oeffProto = anfrage.headers['x-forwarded-proto'] || 'https';
    const istLokal = /^(127\.0\.0\.1|localhost|\[?::1\]?)(:\d+)?$/i.test(oeffHost);
    const basis = (!istLokal && oeffHost) ? `${oeffProto}://${oeffHost}` : '';

    // Anrufbeginn in drei Schritten: Sprachmenue (1 Deutsch, 2 Englisch) ->
    // Einwilligung zur Protokollierung (1 ja, sonst nein) -> Begruessung.
    if (url.pathname === '/api/telefon' && anfrage.method === 'POST') {
      xml(antwort, sprachwahl(await formularLesen(anfrage), basis));
      return;
    }
    if (url.pathname === '/api/telefon/sprache' && anfrage.method === 'POST') {
      xml(antwort, sprachSetzen(await formularLesen(anfrage), basis));
      return;
    }
    if (url.pathname === '/api/telefon/einwilligung' && anfrage.method === 'POST') {
      xml(antwort, einwilligungSetzen(await formularLesen(anfrage), basis));
      return;
    }
    if (url.pathname === '/api/telefon/eingabe' && anfrage.method === 'POST') {
      xml(antwort, await anrufEingabe(await formularLesen(anfrage), basis));
      return;
    }
    if (url.pathname === '/api/telefon/warten' && anfrage.method === 'POST') {
      xml(antwort, await anrufWarten(await formularLesen(anfrage), basis));
      return;
    }

    // --- API: Telefonie (Jambonz-Webhooks, JSON) ---------------------------
    // Gleicher Ablauf wie bei Twilio, aber JSON herein und ein Array von
    // Verben hinaus. Mit JAMBONZ_WEBHOOK_SECRET wird die Signatur geprueft.
    if (url.pathname.startsWith('/api/jambonz') && anfrage.method === 'POST') {
      const roh = await rohLesen(anfrage);
      if (!signaturPruefen(anfrage.headers['jambonz-signature'], roh)) {
        json(antwort, 403, { fehler: 'Ungültige Signatur' });
        return;
      }
      let k;
      try {
        k = JSON.parse(roh || '{}');
      } catch {
        k = null;
      }
      if (!k || typeof k !== 'object' || Array.isArray(k)) {
        json(antwort, 400, { fehler: 'Ungültiger JSON-Körper' });
        return;
      }
      const JAMBONZ = {
        '/api/jambonz': jambonzAnruf,
        '/api/jambonz/sprache': jambonzSprache,
        '/api/jambonz/einwilligung': jambonzEinwilligung,
        '/api/jambonz/eingabe': jambonzEingabe,
        '/api/jambonz/status': jambonzStatus,
      };
      const handler = JAMBONZ[url.pathname];
      if (!handler) {
        json(antwort, 404, { fehler: 'Unbekannter Jambonz-Pfad' });
        return;
      }
      json(antwort, 200, await handler(k, basis));
      return;
    }

    // --- Statische Dateien -------------------------------------------------
    // Ausgeliefert wird NUR, was der Browser-Dialog braucht (Positivliste).
    // Das Repository enthaelt daneben .env, .git, Server-Code und Doku -
    // nichts davon darf ueber HTTP erreichbar sein.
    let pfad;
    try {
      pfad = decodeURIComponent(url.pathname);
    } catch {
      antwort.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Ungültiger Pfad');
      return;
    }
    if (pfad === '/') pfad = '/index.html';
    const erlaubt = pfad === '/index.html' || pfad === '/favicon.ico'
      || STATISCH.some((prefix) => pfad.startsWith(prefix));
    // Kein Segment darf mit "." beginnen (.env, .git, .well-known ...).
    const versteckt = pfad.split('/').some((teil) => teil.startsWith('.'));
    if (!erlaubt || versteckt) {
      antwort.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
      return;
    }

    // Pfadausbruch verhindern
    const ziel = join(WURZEL, normalize(pfad).replace(/^(\.\.[/\\])+/, ''));
    if (!ziel.startsWith(WURZEL + sep)) {
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
    console.error('  serverfehler:', fehler.message);
    antwort.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Serverfehler');
  }
});

// Grenzen gegen haengende Verbindungen (Slowloris): Kopfzeilen binnen 15 s,
// ganze Anfrage binnen 30 s.
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

server.listen(PORT, HOST, () => {
  console.log(`Verwaltungsassistent laeuft auf http://${HOST}:${PORT}`);
  console.log('Beenden mit Strg+C');
});
