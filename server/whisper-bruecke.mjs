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
import { timingSafeEqual } from 'node:crypto';
import { websocketAnnehmen } from './ws.mjs';

const WHISPER_URL = (process.env.WHISPER_URL ?? 'http://localhost:9000').replace(/\/$/, '');
const SCHWELLE = Number(process.env.WHISPER_SCHWELLE ?? 500);

// Pausenerkennung in 20-ms-Fenstern. Die Zeiten sind per Umgebung
// einstellbar, damit auf dem Server ohne Neubau gemessen werden kann.
const FENSTER_MS = 20;
const fenster = (name, standardMs) => Math.max(1, Math.round(Number(process.env[name] ?? standardMs) / FENSTER_MS));
const START_FENSTER = fenster('WHISPER_START_MS', 60);      // Sprache -> Sprechbeginn
const ENDE_FENSTER = fenster('WHISPER_ENDE_MS', 700);       // Stille -> Aeusserung zu Ende
const VORLAUF_FENSTER = fenster('WHISPER_VORLAUF_MS', 300); // vor dem Sprechbeginn mitnehmen
const NACHLAUF_FENSTER = fenster('WHISPER_NACHLAUF_MS', 200); // Stille, die Whisper noch bekommt
const MAX_AEUSSERUNG_MS = Number(process.env.WHISPER_MAX_AEUSSERUNG_MS ?? 15000);
// Gleichzeitige Whisper-Aufrufe ueber alle Sitzungen: mehr macht auf einer
// CPU alle langsamer statt einen schneller. Rest wartet in Reihenfolge.
const PARALLEL = Math.max(1, Number(process.env.WHISPER_PARALLEL ?? 2));
let aktiv = 0;
const warteschlange = [];
async function platz() {
  if (aktiv < PARALLEL) { aktiv += 1; return; }
  await new Promise((r) => warteschlange.push(r));
  aktiv += 1;
}
function frei() {
  aktiv -= 1;
  const naechster = warteschlange.shift();
  if (naechster) naechster();
}
const ZWISCHEN_MS = 1500;     // Zwischenstand hoechstens alle 1,5 s
const ZWISCHEN_FENSTER_S = 3; // Zwischenstand erkennt nur die letzten 3 s
let sitzungsZaehler = 0;      // laufende Nummer fuer Logzeilen (kein Inhalt)

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
  // Fehlende Werte neutral annehmen (nicht -1: "0" ist ein gueltiger, sehr
  // guter Wert und darf nicht als "fehlt" gelten).
  const zahl = (v, sonst) => (v === undefined || v === null || Number.isNaN(Number(v)) ? sonst : Number(v));
  const logprob = segmente.reduce((a, s) => a + zahl(s.avg_logprob, -0.5), 0) / segmente.length;
  const keineSprache = Math.max(...segmente.map((s) => zahl(s.no_speech_prob, 0)));
  const k = Math.exp(logprob) * (1 - keineSprache);
  return Math.max(0, Math.min(1, Number(k.toFixed(3))));
}

/** Whisper per HTTP aufrufen. Liefert { text, confidence, language }. */
export async function whisperTranskribieren(wav, sprache = 'de', basis = WHISPER_URL) {
  const form = new FormData();
  form.append('audio_file', new Blob([wav], { type: 'audio/wav' }), 'aeusserung.wav');
  const url = `${basis}/asr?task=transcribe&output=json${sprache ? `&language=${encodeURIComponent(sprache)}` : ''}`;
  // Haengt Whisper, darf die Sitzung nicht ewig warten: nach WHISPER_TIMEOUT_MS
  // (Standard 8 s) Fehler melden, Jambonz kann dann reagieren.
  await platz();
  let daten;
  try {
    const antwort = await fetch(url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(Number(process.env.WHISPER_TIMEOUT_MS ?? 8000)),
    });
    if (!antwort.ok) throw new Error(`Whisper ${antwort.status}: ${(await antwort.text()).slice(0, 200)}`);
    daten = await antwort.json();
  } finally {
    frei();
  }
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
    this.zwischenLaeuft = false;       // hoechstens ein Zwischenstand in Arbeit
    this.gestoppt = false;
    sitzungsZaehler += 1;
    this.nummer = sitzungsZaehler;
  }

  nachricht(text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m.type === 'start') {
      this.sprache = String(m.language ?? 'de-DE').slice(0, 2).toLowerCase();
      // Abtastrate nur im plausiblen Bereich: bei sehr kleinen Werten wuerde
      // das 20-ms-Fenster 0 Bytes gross und die Fensterschleife nie enden.
      const rate = Number(m.sampleRateHz) || 8000;
      if (!Number.isInteger(rate) || rate < 8000 || rate > 48000) {
        this.senden(JSON.stringify({ type: 'error', error: `sampleRateHz ${m.sampleRateHz} nicht unterstützt (8000–48000)` }));
        this.gestoppt = true;
        this.schliessen();
        return;
      }
      this.rate = rate;
      this.zwischenstaende = Boolean(m.interimResults);
    } else if (m.type === 'stop') {
      this.gestoppt = true;
      this.#abschliessen(true);
    }
  }

  audio(pcm) {
    if (this.gestoppt) return;
    const fensterBytes = Math.round(this.rate * FENSTER_MS / 1000) * 2;
    if (fensterBytes <= 0) return;
    // Deckel nach Datenmenge, nicht nur nach Wanduhr: wer schneller als
    // Echtzeit sendet, darf trotzdem nicht mehr als MAX_AEUSSERUNG_MS Audio
    // im Speicher anhaeufen.
    const maxBytes = Math.round(this.rate * 2 * MAX_AEUSSERUNG_MS / 1000);
    if (this.spricht && this.aeusserung.length * fensterBytes >= maxBytes) this.#abschliessen(false);
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
    } else if (this.zwischenstaende && laut && !this.zwischenLaeuft
      && this.jetzt() - this.letzterZwischenstand >= ZWISCHEN_MS) {
      // Zwischenstand fuer Barge-in: nur wenn keiner in Arbeit ist, und nur
      // die letzten Sekunden - sonst staut sich Rechenzeit vor dem Endergebnis.
      this.letzterZwischenstand = this.jetzt();
      const fensterProSekunde = 1000 / FENSTER_MS;
      const letzte = this.aeusserung.slice(-Math.round(ZWISCHEN_FENSTER_S * fensterProSekunde));
      this.#erkennen(Buffer.concat(letzte), false);
    }
  }

  // Laufende Aeusserung abschliessen: zu Whisper, Ergebnis als final senden.
  #abschliessen(wegenStop) {
    const hatte = this.spricht && this.aeusserung.length > START_FENSTER;
    // Den Stilleschwanz (700 ms) nicht komplett an Whisper schicken - 200 ms
    // reichen als Satzende und sparen Rechenzeit.
    let fensterListe = this.aeusserung;
    if (hatte && !wegenStop && this.stillFolge >= ENDE_FENSTER) {
      const abschneiden = Math.max(0, ENDE_FENSTER - NACHLAUF_FENSTER);
      fensterListe = this.aeusserung.slice(0, Math.max(START_FENSTER + 1, this.aeusserung.length - abschneiden));
    }
    const pcm = hatte ? Buffer.concat(fensterListe) : null;
    this.spricht = false;
    this.aeusserung = [];
    this.lautFolge = 0;
    this.stillFolge = 0;
    if (pcm) this.#erkennen(pcm, true);
    if (wegenStop) this.laufend = this.laufend.then(() => this.schliessen());
  }

  #erkennen(pcm, final) {
    const beginn = this.jetzt();
    const lauf = async () => {
      try {
        const e = await this.transkribieren(wavVerpacken(pcm, this.rate), this.sprache);
        if (final) {
          // Latenz-Logzeile ohne Inhalt: Audiodauer, Whisper-Dauer, Konfidenz.
          console.log(`  stt sitzung=${this.nummer} audio_ms=${Math.round(pcm.length / 2 / this.rate * 1000)} whisper_ms=${this.jetzt() - beginn} konf=${e.confidence} zeichen=${e.text.length}`);
        }
        if (!final && !e.text) return;
        this.senden(JSON.stringify({
          type: 'transcription',
          is_final: final,
          alternatives: [{ transcript: e.text, confidence: e.confidence }],
          language: e.language ?? this.sprache,
          channel: 1,
        }));
      } catch (fehler) {
        console.warn(`  stt sitzung=${this.nummer} fehler=${fehler.message}`);
        if (final) this.senden(JSON.stringify({ type: 'error', error: fehler.message }));
      }
    };
    if (final) {
      // Endergebnisse der Reihe nach - sie muessen in Sprechreihenfolge ankommen.
      this.laufend = this.laufend.then(lauf);
    } else {
      // Zwischenstaende laufen nebenher und blockieren das Endergebnis nicht.
      this.zwischenLaeuft = true;
      lauf().finally(() => { this.zwischenLaeuft = false; });
    }
  }
}

// ----------------------------------------------------------- Server ---

/**
 * HTTP-Server mit WebSocket-Upgrade fuer Jambonz. GET / liefert einen
 * Statusblick (Whisper erreichbar?), alles andere ist WebSocket.
 */
export function brueckeStarten({ port = Number(process.env.WHISPER_BRUECKE_PORT ?? 4116), host = process.env.HOST ?? '127.0.0.1', token = process.env.WHISPER_BRUECKE_TOKEN ?? '', transkribieren = whisperTranskribieren } = {}) {
  // Ohne Token nur auf localhost: jeder, der den Port erreicht, koennte sonst
  // Audio einspeisen und Whisper-Rechenzeit verbrauchen.
  const nurLokal = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!token && !nurLokal) {
    throw new Error('WHISPER_BRUECKE_TOKEN fehlt - ohne Token darf die Bruecke nur auf 127.0.0.1 lauschen');
  }
  const tokenOk = (auth) => {
    if (!token) return true;
    const a = Buffer.from(String(auth ?? ''));
    const b = Buffer.from(`Bearer ${token}`);
    return a.length === b.length && timingSafeEqual(a, b);
  };
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
    if (!tokenOk(req.headers.authorization)) {
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
