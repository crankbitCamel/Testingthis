/**
 * Whisper-Bruecke: eigener Spracherkenner fuer Jambonz.
 *
 * Jambonz kann fremde Erkenner ueber seine "Custom Speech API" anbinden:
 * Es oeffnet pro Aeusserung einen WebSocket zu diesem Dienst, schickt ein
 * Start-JSON, dann rohe Audioframes (LINEAR16, 8 kHz, mono), und erwartet
 * Transkripte als JSON zurueck. Dieser Dienst leitet das Audio an unser
 * selbst gehostetes Whisper (docker-compose: whisper, HTTP /asr) weiter.
 * Damit verlaesst das Anrufer-Audio den eigenen Server nicht.
 *
 * Ablauf je Verbindung:
 *   Jambonz  -> { type:'start', language, sampleRateHz, interimResults, ... }
 *   Jambonz  -> Binaerframes (PCM)            ... fortlaufend
 *   Bruecke  -> { type:'transcription', is_final:false, alternatives:[...] }  (Zwischenstand, optional)
 *   Bruecke  -> { type:'transcription', is_final:true,  alternatives:[{transcript, confidence}], language }
 *   Jambonz  -> { type:'stop' }  -> Bruecke liefert ggf. letztes Transkript und schliesst
 *
 * Whisper erkennt keine Satzgrenzen im laufenden Strom; deshalb macht die
 * Bruecke die Pausenerkennung selbst (Lautstaerke je 20-ms-Fenster): Sprech-
 * beginn nach 60 ms ueber der Schwelle, Ende nach 700 ms darunter. Der
 * Abschnitt geht als WAV an Whisper. Die Konfidenz leitet sich aus Whispers
 * avg_logprob und no_speech_prob ab, damit die Konfidenz-Sperre in dialog.mjs
 * auch hier greift.
 *
 * Konfiguration (Umgebungsvariablen):
 *   WHISPER_URL            Basis des Whisper-Dienstes, Standard http://localhost:9000
 *   WHISPER_BRUECKE_PORT   Port dieses Dienstes, Standard 4116
 *   WHISPER_BRUECKE_TOKEN  Pflicht im Betrieb: Jambonz schickt ihn als Bearer-Token
 *   WHISPER_SCHWELLE       Lautstaerkeschwelle (RMS, 16-bit), Standard 500
 */
import { createServer } from 'node:http';
import { websocketAnnehmen } from './ws.mjs';

const WHISPER_URL = (process.env.WHISPER_URL ?? 'http://localhost:9000').replace(/\/$/, '');
const SCHWELLE = Number(process.env.WHISPER_SCHWELLE ?? 500);

// Pausenerkennung in 20-ms-Fenstern.
const FENSTER_MS = 20;
const START_FENSTER = 3;      // 60 ms Sprache -> Sprechbeginn
const ENDE_FENSTER = 35;      // 700 ms Stille -> Aeusserung zu Ende
const VORLAUF_FENSTER = 15;   // 300 ms vor dem Sprechbeginn mitnehmen
const MAX_AEUSSERUNG_MS = 15000;
const ZWISCHEN_MS = 1500;     // Zwischenstand hoechstens alle 1,5 s

// ------------------------------------------------------------ Audio ---

/** Lautstaerke (RMS) eines PCM-16-Blocks. */
export function pegel(pcm) {
  const n = Math.floor(pcm.length / 2);
  if (!n) return 0;
  let summe = 0;
  for (let i = 0; i < n; i += 1) {
    const s = pcm.readInt16LE(i * 2);
    summe += s * s;
  }
  return Math.sqrt(summe / n);
}

/** PCM-16 mono in einen WAV-Container packen (Whisper/ffmpeg lesen das direkt). */
export function wavVerpacken(pcm, rate = 8000) {
  const kopf = Buffer.alloc(44);
  kopf.write('RIFF', 0);
  kopf.writeUInt32LE(36 + pcm.length, 4);
  kopf.write('WAVE', 8);
  kopf.write('fmt ', 12);
  kopf.writeUInt32LE(16, 16);
  kopf.writeUInt16LE(1, 20);      // PCM
  kopf.writeUInt16LE(1, 22);      // mono
  kopf.writeUInt32LE(rate, 24);
  kopf.writeUInt32LE(rate * 2, 28);
  kopf.writeUInt16LE(2, 32);
  kopf.writeUInt16LE(16, 34);
  kopf.write('data', 36);
  kopf.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([kopf, pcm]);
}

/** Aus Whispers Antwort eine Konfidenz 0..1 ableiten. */
export function konfidenzAus(antwort) {
  const segmente = Array.isArray(antwort?.segments) ? antwort.segments : [];
  if (!segmente.length) return 0;
  const logprob = segmente.reduce((a, s) => a + (Number(s.avg_logprob) || -1), 0) / segmente.length;
  const keineSprache = Math.max(...segmente.map((s) => Number(s.no_speech_prob) || 0));
  const k = Math.exp(logprob) * (1 - keineSprache);
  return Math.max(0, Math.min(1, Number(k.toFixed(3))));
}

/** Whisper per HTTP aufrufen. Liefert { text, confidence, language }. */
export async function whisperTranskribieren(wav, sprache = 'de', basis = WHISPER_URL) {
  const form = new FormData();
  form.append('audio_file', new Blob([wav], { type: 'audio/wav' }), 'aeusserung.wav');
  const url = `${basis}/asr?task=transcribe&output=json${sprache ? `&language=${encodeURIComponent(sprache)}` : ''}`;
  const antwort = await fetch(url, { method: 'POST', body: form });
  if (!antwort.ok) throw new Error(`Whisper ${antwort.status}: ${(await antwort.text()).slice(0, 200)}`);
  const daten = await antwort.json();
  return {
    text: String(daten.text ?? '').trim(),
    confidence: konfidenzAus(daten),
    language: daten.language ?? sprache,
  };
}

// ---------------------------------------------------------- Sitzung ---

/**
 * Eine Erkennungssitzung (ein WebSocket von Jambonz). Die Transkription
 * ist injizierbar, damit die Pausenerkennung ohne Whisper testbar ist.
 */
export class Sitzung {
  constructor({ senden, transkribieren = whisperTranskribieren, schliessen = () => {}, jetzt = Date.now }) {
    this.senden = senden;
    this.transkribieren = transkribieren;
    this.schliessen = schliessen;
    this.jetzt = jetzt;
    this.sprache = 'de';
    this.rate = 8000;
    this.zwischenstaende = false;
    this.rest = Buffer.alloc(0);       // unvollstaendiges 20-ms-Fenster
    this.vorlauf = [];                 // letzte Fenster vor Sprechbeginn
    this.aeusserung = [];              // Fenster der laufenden Aeusserung
    this.spricht = false;
    this.lautFolge = 0;
    this.stillFolge = 0;
    this.aeusserungBeginn = 0;
    this.letzterZwischenstand = 0;
    this.laufend = Promise.resolve();  // Whisper-Aufrufe der Reihe nach
    this.gestoppt = false;
  }

  nachricht(text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m.type === 'start') {
      this.sprache = String(m.language ?? 'de-DE').slice(0, 2).toLowerCase();
      this.rate = Number(m.sampleRateHz) || 8000;
      this.zwischenstaende = Boolean(m.interimResults);
    } else if (m.type === 'stop') {
      this.gestoppt = true;
      this.#abschliessen(true);
    }
  }

  audio(pcm) {
    if (this.gestoppt) return;
    const fensterBytes = Math.round(this.rate * FENSTER_MS / 1000) * 2;
    let daten = Buffer.concat([this.rest, pcm]);
    while (daten.length >= fensterBytes) {
      this.#fenster(daten.subarray(0, fensterBytes));
      daten = daten.subarray(fensterBytes);
    }
    this.rest = Buffer.from(daten);
  }

  #fenster(f) {
    const laut = pegel(f) >= SCHWELLE;
    if (!this.spricht) {
      this.vorlauf.push(f);
      if (this.vorlauf.length > VORLAUF_FENSTER) this.vorlauf.shift();
      this.lautFolge = laut ? this.lautFolge + 1 : 0;
      if (this.lautFolge >= START_FENSTER) {
        this.spricht = true;
        this.stillFolge = 0;
        this.aeusserung = [...this.vorlauf];
        this.vorlauf = [];
        this.aeusserungBeginn = this.jetzt();
        this.letzterZwischenstand = this.aeusserungBeginn;
      }
      return;
    }
    this.aeusserung.push(f);
    this.stillFolge = laut ? 0 : this.stillFolge + 1;
    const dauer = this.jetzt() - this.aeusserungBeginn;
    if (this.stillFolge >= ENDE_FENSTER || dauer >= MAX_AEUSSERUNG_MS) {
      this.#abschliessen(false);
    } else if (this.zwischenstaende && laut && this.jetzt() - this.letzterZwischenstand >= ZWISCHEN_MS) {
      this.letzterZwischenstand = this.jetzt();
      this.#erkennen(Buffer.concat(this.aeusserung), false);
    }
  }

  // Laufende Aeusserung abschliessen: zu Whisper, Ergebnis als final senden.
  #abschliessen(wegenStop) {
    const hatte = this.spricht && this.aeusserung.length > START_FENSTER;
    const pcm = hatte ? Buffer.concat(this.aeusserung) : null;
    this.spricht = false;
    this.aeusserung = [];
    this.lautFolge = 0;
    this.stillFolge = 0;
    if (pcm) this.#erkennen(pcm, true);
    if (wegenStop) this.laufend = this.laufend.then(() => this.schliessen());
  }

  #erkennen(pcm, final) {
    this.laufend = this.laufend.then(async () => {
      try {
        const e = await this.transkribieren(wavVerpacken(pcm, this.rate), this.sprache);
        if (!final && !e.text) return;
        this.senden(JSON.stringify({
          type: 'transcription',
          is_final: final,
          alternatives: [{ transcript: e.text, confidence: e.confidence }],
          language: e.language ?? this.sprache,
          channel: 1,
        }));
      } catch (fehler) {
        this.senden(JSON.stringify({ type: 'error', error: fehler.message }));
      }
    });
  }
}

// ----------------------------------------------------------- Server ---

/**
 * HTTP-Server mit WebSocket-Upgrade fuer Jambonz. GET / liefert einen
 * Statusblick (Whisper erreichbar?), alles andere ist WebSocket.
 */
export function brueckeStarten({ port = Number(process.env.WHISPER_BRUECKE_PORT ?? 4116), host = process.env.HOST ?? '0.0.0.0', token = process.env.WHISPER_BRUECKE_TOKEN ?? '', transkribieren = whisperTranskribieren } = {}) {
  const server = createServer(async (req, res) => {
    if (req.url === '/' || req.url === '/status') {
      let whisper = 'unbekannt';
      try {
        const a = await fetch(`${WHISPER_URL}/docs`, { method: 'GET' });
        whisper = a.ok ? 'erreichbar' : `Status ${a.status}`;
      } catch (f) { whisper = `nicht erreichbar (${f.message})`; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        .end(JSON.stringify({ dienst: 'whisper-bruecke', whisper, whisperUrl: WHISPER_URL, tokenGesetzt: Boolean(token) }));
      return;
    }
    res.writeHead(404).end();
  });

  server.on('upgrade', (req, socket, head) => {
    const auth = String(req.headers.authorization ?? '');
    if (token && auth !== `Bearer ${token}`) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    const ws = websocketAnnehmen(req, socket, head);
    if (!ws) return;
    const sitzung = new Sitzung({
      senden: (t) => ws.send(t),
      transkribieren,
      schliessen: () => ws.close(),
    });
    ws.on('message', (daten, istText) => (istText ? sitzung.nachricht(daten) : sitzung.audio(daten)));
    ws.on('error', () => {});
  });

  server.listen(port, host, () => {
    console.log(`Whisper-Bruecke lauscht auf ws://${host}:${port} -> Whisper ${WHISPER_URL}${token ? '' : '  (WARNUNG: kein WHISPER_BRUECKE_TOKEN gesetzt)'}`);
  });
  return server;
}
