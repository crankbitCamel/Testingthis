#!/usr/bin/env node
/**
 * Startet die Whisper-Bruecke (eigener Spracherkenner fuer Jambonz).
 *
 *   WHISPER_URL=http://localhost:9000 WHISPER_BRUECKE_TOKEN=geheim npm run whisper-bruecke
 *
 * In Jambonz: Speech -> Add custom vendor -> Label "whisper",
 * URL ws(s)://<server>:4116, API key = WHISPER_BRUECKE_TOKEN.
 * In der App dann JAMBONZ_STT_VENDOR=custom:whisper (Standard).
 */
import { brueckeStarten } from '../server/whisper-bruecke.mjs';

const server = brueckeStarten();

// Sauber herunterfahren: laufende Erkennungen duerfen zu Ende kommen (max. 20 s).
function herunterfahren(signal) {
  console.log(`${signal}: Whisper-Bruecke schliesst ...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 20_000).unref();
}
process.on('SIGTERM', () => herunterfahren('SIGTERM'));
process.on('SIGINT', () => herunterfahren('SIGINT'));
