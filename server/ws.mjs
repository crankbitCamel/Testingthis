/**
 * Minimaler WebSocket-Server (RFC 6455) ohne Abhaengigkeiten.
 *
 * Reicht fuer die Whisper-Bruecke: Handshake, Text- und Binaerframes in
 * beide Richtungen, Fragmentierung, Ping/Pong, Close. Bewusst kein
 * Kompressions-Extension-Support (permessage-deflate wird abgelehnt, indem
 * die Erweiterung schlicht nicht bestaetigt wird - der Client faellt dann
 * auf unkomprimierte Frames zurueck).
 *
 * Nutzung:
 *   server.on('upgrade', (req, socket, head) => {
 *     const ws = websocketAnnehmen(req, socket, head);
 *     ws.on('message', (daten, istText) => ...);
 *     ws.send('text'); ws.send(Buffer); ws.close();
 *   });
 */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function acceptSchluessel(key) {
  return createHash('sha1').update(`${key}${GUID}`).digest('base64');
}

/** Einen Frame (Server -> Client, unmaskiert) kodieren. */
export function frameKodieren(nutzlast, { opcode = 1, fin = true } = {}) {
  const daten = typeof nutzlast === 'string' ? Buffer.from(nutzlast, 'utf8') : Buffer.from(nutzlast ?? []);
  const laenge = daten.length;
  let kopf;
  if (laenge < 126) {
    kopf = Buffer.alloc(2);
    kopf[1] = laenge;
  } else if (laenge < 65536) {
    kopf = Buffer.alloc(4);
    kopf[1] = 126;
    kopf.writeUInt16BE(laenge, 2);
  } else {
    kopf = Buffer.alloc(10);
    kopf[1] = 127;
    kopf.writeBigUInt64BE(BigInt(laenge), 2);
  }
  kopf[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
  return Buffer.concat([kopf, daten]);
}

/**
 * Einen Frame aus dem Puffer lesen. Liefert null, wenn noch nicht genug
 * Bytes da sind, sonst { fin, opcode, nutzlast, verbraucht }.
 */
export function frameDekodieren(puffer) {
  if (puffer.length < 2) return null;
  const fin = (puffer[0] & 0x80) !== 0;
  const opcode = puffer[0] & 0x0f;
  const maskiert = (puffer[1] & 0x80) !== 0;
  let laenge = puffer[1] & 0x7f;
  let pos = 2;
  if (laenge === 126) {
    if (puffer.length < 4) return null;
    laenge = puffer.readUInt16BE(2);
    pos = 4;
  } else if (laenge === 127) {
    if (puffer.length < 10) return null;
    laenge = Number(puffer.readBigUInt64BE(2));
    pos = 10;
  }
  let maske = null;
  if (maskiert) {
    if (puffer.length < pos + 4) return null;
    maske = puffer.subarray(pos, pos + 4);
    pos += 4;
  }
  if (puffer.length < pos + laenge) return null;
  const nutzlast = Buffer.from(puffer.subarray(pos, pos + laenge));
  if (maske) {
    for (let i = 0; i < nutzlast.length; i += 1) nutzlast[i] ^= maske[i & 3];
  }
  return { fin, opcode, nutzlast, verbraucht: pos + laenge };
}

/** Maskierten Frame (Client -> Server) erzeugen - fuer Tests und Clients. */
export function frameKodierenMaskiert(nutzlast, { opcode = 1, fin = true, maske = Buffer.from([1, 2, 3, 4]) } = {}) {
  const roh = frameKodieren(nutzlast, { opcode, fin });
  const kopfLaenge = roh[1] === 126 ? 4 : roh[1] === 127 ? 10 : 2;
  const daten = Buffer.from(roh.subarray(kopfLaenge));
  for (let i = 0; i < daten.length; i += 1) daten[i] ^= maske[i & 3];
  const kopf = Buffer.from(roh.subarray(0, kopfLaenge));
  kopf[1] |= 0x80;
  return Buffer.concat([kopf, maske, daten]);
}

export class WebSocketVerbindung extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.puffer = Buffer.alloc(0);
    this.fragmente = [];
    this.fragmentOpcode = 0;
    this.offen = true;
    socket.on('data', (teil) => this.#empfangen(teil));
    socket.on('close', () => { this.offen = false; this.emit('close'); });
    socket.on('error', (f) => this.emit('error', f));
  }

  #empfangen(teil) {
    this.puffer = Buffer.concat([this.puffer, teil]);
    for (;;) {
      const frame = frameDekodieren(this.puffer);
      if (!frame) return;
      this.puffer = this.puffer.subarray(frame.verbraucht);
      this.#frame(frame);
    }
  }

  #frame({ fin, opcode, nutzlast }) {
    switch (opcode) {
      case 0x0: // Fortsetzung
        this.fragmente.push(nutzlast);
        if (fin) {
          const ganz = Buffer.concat(this.fragmente);
          const istText = this.fragmentOpcode === 0x1;
          this.fragmente = [];
          this.emit('message', istText ? ganz.toString('utf8') : ganz, istText);
        }
        break;
      case 0x1: case 0x2:
        if (!fin) {
          this.fragmentOpcode = opcode;
          this.fragmente = [nutzlast];
        } else {
          this.emit('message', opcode === 0x1 ? nutzlast.toString('utf8') : nutzlast, opcode === 0x1);
        }
        break;
      case 0x8: // Close
        this.close();
        break;
      case 0x9: // Ping -> Pong
        this.#roh(frameKodieren(nutzlast, { opcode: 0xa }));
        break;
      default: break; // Pong u. a. ignorieren
    }
  }

  #roh(frame) {
    if (this.offen && !this.socket.destroyed) this.socket.write(frame);
  }

  send(daten) {
    const istText = typeof daten === 'string';
    this.#roh(frameKodieren(daten, { opcode: istText ? 0x1 : 0x2 }));
  }

  close(code = 1000) {
    if (!this.offen) return;
    this.offen = false;
    const nutzlast = Buffer.alloc(2);
    nutzlast.writeUInt16BE(code);
    if (!this.socket.destroyed) {
      this.socket.write(frameKodieren(nutzlast, { opcode: 0x8 }));
      this.socket.end();
    }
    this.emit('close');
  }
}

/**
 * HTTP-Upgrade zu WebSocket annehmen. Gibt die Verbindung zurueck oder
 * null (dann wurde der Socket mit 400 beendet).
 */
export function websocketAnnehmen(req, socket, head = Buffer.alloc(0)) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade ?? '').toLowerCase();
  if (upgrade !== 'websocket' || !key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${acceptSchluessel(key)}\r\n\r\n`,
  );
  const ws = new WebSocketVerbindung(socket);
  if (head?.length) socket.emit('data', head);
  return ws;
}
