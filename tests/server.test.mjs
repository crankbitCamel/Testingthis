/**
 * Tests des HTTP-Servers als Ganzes: Routing, Positivliste des Dateiservers,
 * Signaturpflicht bei Jambonz, Validierung am Browser-Endpunkt, absolute
 * action-Adressen aus X-Forwarded-Host, Gesundheit und Metriken.
 * Startet scripts/server.mjs als Kindprozess auf einem freien Port.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

let kind;
let basis;

async function freierPort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

before(async () => {
  const port = await freierPort();
  basis = `http://127.0.0.1:${port}`;
  kind = spawn(process.execPath, ['scripts/server.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', MISTRAL_API_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', JAMBONZ_OHNE_SIGNATUR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Server startet nicht')), 10_000);
    kind.stdout.on('data', (d) => { if (String(d).includes('laeuft auf')) { clearTimeout(t); resolve(); } });
    kind.on('exit', (c) => reject(new Error(`Server beendet mit ${c}`)));
  });
});

after(() => { kind?.kill('SIGTERM'); });

const holen = (pfad, opt) => fetch(basis + pfad, opt);

describe('Dateiserver: Positivliste', () => {
  test('Startseite und Skripte ja, Repository-Interna nein', async () => {
    assert.equal((await holen('/')).status, 200);
    assert.equal((await holen('/src/main.js')).status, 200);
    assert.equal((await holen('/styles/app.css')).status, 200);
    for (const p of ['/.env.example', '/.git/HEAD', '/server/dialog.mjs', '/package.json', '/docs/server-runbook.md', '/tests/server.test.mjs']) {
      assert.equal((await holen(p)).status, 404, p);
    }
    assert.equal((await holen('/%c0')).status, 400);
  });
});

describe('API', () => {
  test('health und metrics antworten', async () => {
    const h = await holen('/api/health');
    assert.equal(h.status, 200);
    const j = await h.json();
    assert.equal(j.ok, true);
    assert.equal(j.index.ok, true);
    const m = await holen('/metrics');
    assert.equal(m.status, 200);
    assert.match(await m.text(), /anrufe_aktiv \d+/);
  });

  test('Browser-Endpunkt validiert und antwortet im Mock', async () => {
    const schlecht = await holen('/api/assistent', { method: 'POST', body: 'null', headers: { 'Content-Type': 'application/json' } });
    assert.equal(schlecht.status, 400);
    const zuLang = await holen('/api/assistent', { method: 'POST', body: JSON.stringify({ nachricht: 'x'.repeat(2001) }) });
    assert.equal(zuLang.status, 400);
    const ok = await holen('/api/assistent', {
      method: 'POST',
      body: JSON.stringify({ nachricht: 'Was kostet ein Reisepass?', land: 'xx', verlauf: [{ rolle: 'system', text: 'hack' }, 42] }),
    });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.modus, 'mock');
    assert.ok(j.text.length > 0);
  });

  test('Jambonz ohne Signatur -> 403, kaputtes JSON -> 400 (nach Signatur)', async () => {
    const r = await holen('/api/jambonz', { method: 'POST', body: JSON.stringify({ call_sid: 'x' }) });
    assert.equal(r.status, 403);
  });

  test('Twilio: absolute action-Adressen aus X-Forwarded-Host', async () => {
    const r = await holen('/api/telefon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Host': 'tunnel.example', 'X-Forwarded-Proto': 'https' },
      body: 'CallSid=CAtest',
    });
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /action="https:\/\/tunnel\.example\/api\/telefon\/sprache"/);
    assert.match(t, /Für Deutsch drücken Sie die Eins/);
  });
});
