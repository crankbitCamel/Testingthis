/**
 * Tests der Whisper-Bruecke OHNE Whisper und OHNE Jambonz: WebSocket-
 * Rahmen, Pausenerkennung, Protokoll (start/audio/stop -> transcription),
 * Konfidenz-Ableitung, Token-Pruefung. Whisper wird durch eine Funktion
 * ersetzt, die das gelieferte WAV nur vermisst.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import {
  frameKodieren, frameDekodieren, frameKodierenMaskiert, acceptSchluessel,
} from '../server/ws.mjs';
import {
  pegel, wavVerpacken, konfidenzAus, Sitzung, brueckeStarten,
} from '../server/whisper-bruecke.mjs';

// 8 kHz, 16 bit: 20 ms = 160 Samples.
const RATE = 8000;
function ton(ms, amplitude = 8000, f = 440) {
  const n = Math.round(RATE * ms / 1000);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) b.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * f * i / RATE)), i * 2);
  return b;
}
const stille = (ms) => Buffer.alloc(Math.round(RATE * ms / 1000) * 2);

describe('WebSocket-Rahmen', () => {
  test('Text- und Binaerframes ueberleben Kodieren/Dekodieren, auch maskiert', () => {
    const t = frameDekodieren(frameKodieren('hallo'));
    assert.equal(t.opcode, 1);
    assert.equal(t.nutzlast.toString(), 'hallo');
    const gross = randomBytes(70000);
    const g = frameDekodieren(frameKodierenMaskiert(gross, { opcode: 2 }));
    assert.equal(g.opcode, 2);
    assert.ok(g.nutzlast.equals(gross));
    assert.equal(frameDekodieren(Buffer.from([0x81])), null, 'unvollstaendig -> null');
  });

  test('Sec-WebSocket-Accept wie in RFC 6455', () => {
    assert.equal(acceptSchluessel('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});

describe('Audio-Hilfen', () => {
  test('Pegel: Stille null, Ton hoch; WAV-Kopf korrekt', () => {
    assert.equal(pegel(stille(20)), 0);
    assert.ok(pegel(ton(20)) > 5000);
    const wav = wavVerpacken(stille(100), RATE);
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.equal(wav.readUInt32LE(24), RATE);
    assert.equal(wav.readUInt32LE(40), 1600);
  });

  test('Konfidenz aus Whisper-Werten', () => {
    assert.equal(konfidenzAus({}), 0);
    const gut = konfidenzAus({ segments: [{ avg_logprob: -0.1, no_speech_prob: 0.01 }] });
    const schlecht = konfidenzAus({ segments: [{ avg_logprob: -1.5, no_speech_prob: 0.7 }] });
    assert.ok(gut > 0.85 && gut <= 1);
    assert.ok(schlecht < 0.1);
  });
});

describe('Erkennungssitzung (Pausenerkennung + Protokoll)', () => {
  function sitzungMitAttrappe() {
    const gesendet = [];
    const aufrufe = [];
    let geschlossen = 0;
    const sitzung = new Sitzung({
      senden: (t) => gesendet.push(JSON.parse(t)),
      transkribieren: async (wav, sprache) => {
        aufrufe.push({ bytes: wav.length - 44, sprache });
        return { text: `erkannt ${aufrufe.length}`, confidence: 0.9, language: sprache };
      },
      schliessen: () => { geschlossen += 1; },
    });
    return { sitzung, gesendet, aufrufe, geschlossen: () => geschlossen };
  }
  const abwarten = (s) => s.laufend;

  test('Ton, dann 700 ms Stille -> ein finales Transkript in der Startsprache', async () => {
    const { sitzung, gesendet, aufrufe } = sitzungMitAttrappe();
    sitzung.nachricht(JSON.stringify({ type: 'start', language: 'de-DE', sampleRateHz: 8000, interimResults: false }));
    sitzung.audio(stille(500));
    sitzung.audio(ton(1000));
    sitzung.audio(stille(800));
    await abwarten(sitzung);
    assert.equal(gesendet.length, 1);
    assert.equal(gesendet[0].type, 'transcription');
    assert.equal(gesendet[0].is_final, true);
    assert.equal(gesendet[0].alternatives[0].transcript, 'erkannt 1');
    assert.equal(gesendet[0].language, 'de');
    assert.equal(aufrufe[0].sprache, 'de');
    // Etwa 1 s Ton + 300 ms Vorlauf + 200 ms Nachlauf (der Rest der 700 ms
    // Stille wird abgeschnitten), in Bytes bei 8 kHz/16 bit.
    assert.ok(aufrufe[0].bytes > 1.3 * RATE * 2 && aufrufe[0].bytes < 1.7 * RATE * 2, `Bytes ${aufrufe[0].bytes}`);
  });

  test('nur Stille -> nichts gesendet; stop schliesst', async () => {
    const { sitzung, gesendet, geschlossen } = sitzungMitAttrappe();
    sitzung.nachricht(JSON.stringify({ type: 'start', language: 'en-GB' }));
    sitzung.audio(stille(2000));
    sitzung.nachricht(JSON.stringify({ type: 'stop' }));
    await abwarten(sitzung);
    assert.equal(gesendet.length, 0);
    assert.equal(geschlossen(), 1);
  });

  test('stop mitten in der Aeusserung liefert das letzte Transkript vor dem Schliessen', async () => {
    const { sitzung, gesendet, geschlossen } = sitzungMitAttrappe();
    sitzung.nachricht(JSON.stringify({ type: 'start', language: 'de-DE' }));
    sitzung.audio(ton(600));
    sitzung.nachricht(JSON.stringify({ type: 'stop' }));
    await abwarten(sitzung);
    assert.equal(gesendet.length, 1);
    assert.equal(gesendet[0].is_final, true);
    assert.equal(geschlossen(), 1);
  });

  test('zwei Aeusserungen -> zwei finale Transkripte', async () => {
    const { sitzung, gesendet } = sitzungMitAttrappe();
    sitzung.nachricht(JSON.stringify({ type: 'start', language: 'de-DE' }));
    sitzung.audio(ton(500)); sitzung.audio(stille(800));
    sitzung.audio(ton(500)); sitzung.audio(stille(800));
    await abwarten(sitzung);
    assert.deepEqual(gesendet.map((g) => g.alternatives[0].transcript), ['erkannt 1', 'erkannt 2']);
  });

  test('Whisper-Fehler wird als error-Nachricht gemeldet', async () => {
    const gesendet = [];
    const sitzung = new Sitzung({
      senden: (t) => gesendet.push(JSON.parse(t)),
      transkribieren: async () => { throw new Error('Whisper 503'); },
    });
    sitzung.nachricht(JSON.stringify({ type: 'start' }));
    sitzung.audio(ton(400)); sitzung.audio(stille(800));
    await sitzung.laufend;
    assert.equal(gesendet[0].type, 'error');
    assert.match(gesendet[0].error, /503/);
  });
});

describe('Schutz gegen fehlerhafte oder boesartige Eingaben', () => {
  test('unplausible Abtastrate wird abgewiesen statt die Fensterschleife zu blockieren', () => {
    const gesendet = [];
    let geschlossen = 0;
    const sitzung = new Sitzung({ senden: (t) => gesendet.push(JSON.parse(t)), transkribieren: async () => ({ text: 'x', confidence: 1 }), schliessen: () => { geschlossen += 1; } });
    sitzung.nachricht(JSON.stringify({ type: 'start', sampleRateHz: 1 }));
    sitzung.audio(ton(100));   // wuerde vorher endlos schleifen
    assert.equal(gesendet[0].type, 'error');
    assert.match(gesendet[0].error, /sampleRateHz/);
    assert.equal(geschlossen, 1);
  });

  test('Konfidenz: avg_logprob 0 ist ein guter Wert, fehlende Werte sind neutral', () => {
    assert.ok(konfidenzAus({ segments: [{ avg_logprob: 0, no_speech_prob: 0 }] }) >= 0.99);
    const neutral = konfidenzAus({ segments: [{}] });
    assert.ok(neutral > 0.4 && neutral < 0.8, `neutral ${neutral}`);
  });

  test('WebSocket: angekuendigter Riesen-Frame wird abgelehnt statt gepuffert', () => {
    const kopf = Buffer.alloc(10);
    kopf[0] = 0x82; kopf[1] = 127; kopf.writeBigUInt64BE(2n ** 40n, 2);
    const f = frameDekodieren(kopf);
    assert.equal(f.zuGross, true);
  });

  test('ohne Token darf die Bruecke nur auf localhost starten', () => {
    assert.throws(() => brueckeStarten({ port: 0, host: '0.0.0.0', token: '' }), /WHISPER_BRUECKE_TOKEN/);
  });
});

describe('Bruecke als Server (WebSocket-Handshake und Token)', () => {
  test('ohne gueltigen Token 401, mit Token 101 und Transkript ueber die Leitung', async () => {
    const server = brueckeStarten({
      port: 0, host: '127.0.0.1', token: 'geheim',
      transkribieren: async () => ({ text: 'Was kostet ein Reisepass?', confidence: 0.93, language: 'de' }),
    });
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address();

    const verbinden = (auth) => new Promise((resolve) => {
      const s = connect(port, '127.0.0.1', () => {
        s.write(`GET /stt HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${auth ? `Authorization: Bearer ${auth}\r\n` : ''}\r\n`);
      });
      s.once('data', (d) => resolve({ s, kopf: d.toString() }));
    });

    const falsch = await verbinden('nix');
    assert.match(falsch.kopf, /401/);
    falsch.s.destroy();

    const richtig = await verbinden('geheim');
    assert.match(richtig.kopf, /101 Switching Protocols/);
    assert.match(richtig.kopf, /s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/);

    const antwort = new Promise((resolve) => {
      let puffer = Buffer.alloc(0);
      richtig.s.on('data', (d) => {
        puffer = Buffer.concat([puffer, d]);
        const f = frameDekodieren(puffer);
        if (f && f.opcode === 1) resolve(JSON.parse(f.nutzlast.toString()));
      });
    });
    richtig.s.write(frameKodierenMaskiert(JSON.stringify({ type: 'start', language: 'de-DE', sampleRateHz: 8000 })));
    richtig.s.write(frameKodierenMaskiert(ton(800), { opcode: 2 }));
    richtig.s.write(frameKodierenMaskiert(stille(900), { opcode: 2 }));
    const t = await antwort;
    assert.equal(t.type, 'transcription');
    assert.equal(t.alternatives[0].transcript, 'Was kostet ein Reisepass?');
    richtig.s.destroy();
    server.close();
  });
});
