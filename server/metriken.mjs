/**
 * Minimale Metriken ohne Abhaengigkeiten, im Prometheus-Textformat.
 *
 * Zaehler und Dauer-Histogramme fuer das, was im Betrieb zaehlt: Runden je
 * Kanal, Modellanfragen und 429, Erkennungsdauer, aktive Anrufe,
 * Protokollfehler. Abholen unter GET /metrics (App) - auf dem Server scrapt
 * das mit Jambonz installierte Telegraf/Prometheus oder Grafana.
 *
 *   zaehle('mistral_requests_total', { status: '200' })
 *   beobachte('runde_dauer_ms', 4200, { kanal: 'jambonz' })
 *   setze('anrufe_aktiv', 3)
 */
const zaehler = new Map();   // name{labels} -> n
const messwerte = new Map(); // name{labels} -> { grenzen, buckets[], summe, anzahl }
const pegel = new Map();     // name -> wert

const GRENZEN_MS = [100, 250, 500, 1000, 2000, 3000, 5000, 8000, 12000, 20000, 30000];

const schluessel = (name, labels) => {
  const l = Object.entries(labels ?? {}).map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(',');
  return l ? `${name}{${l}}` : name;
};

export function zaehle(name, labels = {}, n = 1) {
  const k = schluessel(name, labels);
  zaehler.set(k, (zaehler.get(k) ?? 0) + n);
}

export function beobachte(name, wert, labels = {}) {
  const k = schluessel(name, labels);
  let m = messwerte.get(k);
  if (!m) {
    m = { name, labels, buckets: GRENZEN_MS.map(() => 0), summe: 0, anzahl: 0 };
    messwerte.set(k, m);
  }
  const w = Number(wert) || 0;
  m.summe += w;
  m.anzahl += 1;
  GRENZEN_MS.forEach((g, i) => { if (w <= g) m.buckets[i] += 1; });
}

export function setze(name, wert) {
  pegel.set(name, Number(wert) || 0);
}

/** Text im Prometheus-Expositionsformat. */
export function prometheusText() {
  const zeilen = [];
  for (const [k, n] of zaehler) zeilen.push(`${k} ${n}`);
  for (const [name, w] of pegel) zeilen.push(`${name} ${w}`);
  for (const m of messwerte.values()) {
    const basis = Object.entries(m.labels).map(([k, v]) => `${k}="${v}"`);
    const mit = (extra) => `${m.name}_bucket{${[...basis, extra].join(',')}}`;
    GRENZEN_MS.forEach((g, i) => zeilen.push(`${mit(`le="${g}"`)} ${m.buckets[i]}`));
    zeilen.push(`${mit('le="+Inf"')} ${m.anzahl}`);
    const l = basis.length ? `{${basis.join(',')}}` : '';
    zeilen.push(`${m.name}_sum${l} ${m.summe}`);
    zeilen.push(`${m.name}_count${l} ${m.anzahl}`);
  }
  return `${zeilen.join('\n')}\n`;
}

/** Nur fuer Tests. */
export function _zuruecksetzen() { zaehler.clear(); messwerte.clear(); pegel.clear(); }
