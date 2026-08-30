#!/usr/bin/env node
/**
 * Legt ein Neon-Projekt (serverloses PostgreSQL) per Neon-API an und gibt den
 * Connection String aus. API = Application Programming Interface, die
 * programmatische Schnittstelle eines Dienstes.
 *
 * Voraussetzung: ein API-Schluessel aus der Neon-Konsole
 * (console.neon.tech -> Account -> API keys), gesetzt als NEON_API_KEY.
 *
 * Aufruf:
 *   NEON_API_KEY="neon_api_..." node scripts/neon-provision.mjs
 *   ... [--name verwaltungsassistent] [--region aws-eu-central-1]
 *
 * Idempotent: existiert ein Projekt dieses Namens bereits, wird kein zweites
 * angelegt, sondern dessen Connection String ermittelt.
 */

const API = 'https://console.neon.tech/api/v2';
const schluessel = process.env.NEON_API_KEY;

const argument = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};
const projektName = argument('name', 'verwaltungsassistent');
const region = argument('region', 'aws-eu-central-1'); // Frankfurt - Daten bleiben in der EU

if (!schluessel) {
  console.error('NEON_API_KEY fehlt. Schluessel unter console.neon.tech -> Account -> API keys anlegen und setzen:');
  console.error('  NEON_API_KEY="neon_api_..." node scripts/neon-provision.mjs');
  process.exit(1);
}

async function api(pfad, optionen = {}) {
  const antwort = await fetch(`${API}${pfad}`, {
    ...optionen,
    headers: {
      Authorization: `Bearer ${schluessel}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(optionen.headers ?? {}),
    },
  });
  const text = await antwort.text();
  if (!antwort.ok) throw new Error(`Neon-API ${optionen.method ?? 'GET'} ${pfad} -> ${antwort.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// Existiert das Projekt schon?
const { projects = [] } = await api('/projects?limit=100');
let projekt = projects.find((p) => p.name === projektName);
let verbindung = null;

if (projekt) {
  console.log(`Projekt "${projektName}" existiert bereits (${projekt.id}) - Connection String wird ermittelt.`);
  const { branches = [] } = await api(`/projects/${projekt.id}/branches`);
  const zweig = branches.find((b) => b.default) ?? branches[0];
  if (!zweig) throw new Error('Projekt hat keinen Branch - bitte in der Neon-Konsole pruefen.');
  const { databases = [] } = await api(`/projects/${projekt.id}/branches/${zweig.id}/databases`);
  const { roles = [] } = await api(`/projects/${projekt.id}/branches/${zweig.id}/roles`);
  const datenbank = databases[0];
  const rolle = roles.find((r) => !r.protected) ?? roles[0];
  if (!datenbank || !rolle) throw new Error('Keine Datenbank/Rolle im Standardbranch gefunden.');
  const uri = await api(
    `/projects/${projekt.id}/connection_uri?branch_id=${zweig.id}` +
    `&database_name=${encodeURIComponent(datenbank.name)}&role_name=${encodeURIComponent(rolle.name)}`,
  );
  verbindung = uri.uri;
} else {
  console.log(`Lege Projekt "${projektName}" in Region ${region} an ...`);
  const ergebnis = await api('/projects', {
    method: 'POST',
    body: JSON.stringify({ project: { name: projektName, region_id: region, pg_version: 17 } }),
  });
  projekt = ergebnis.project;
  verbindung = ergebnis.connection_uris?.[0]?.connection_uri ?? null;
  console.log(`Projekt angelegt: ${projekt.id}`);
}

if (!verbindung) throw new Error('Kein Connection String erhalten - bitte in der Neon-Konsole nachsehen.');

console.log('\nConnection String (geheim halten - enthaelt das Datenbankpasswort):\n');
console.log(`  ${verbindung}\n`);
console.log('Naechster Schritt - Wissensbasis importieren:');
console.log(`  DATABASE_URL="${verbindung}" npm run db:import`);
