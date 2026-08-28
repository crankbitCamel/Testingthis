/**
 * Verdrahtung von Dialog, Sprache und Oberflaeche.
 *
 * Die Datei enthaelt keine Fachlogik: Was gesagt wird, entscheidet dialog.js,
 * was gewusst wird, steht in kb/. Hier geht es nur um Darstellung, Eingabe und
 * das Zusammenspiel von Mikrofon und Sprachausgabe.
 */
import { Dialog } from './dialog.js';
import { Zuhoerer, Sprecher, spracheingabeVerfuegbar, sprachausgabeVerfuegbar } from './speech.js';
import { kennzahlen } from './kb/index.js';
import { regionalKennzahlen, LAENDER } from './kb/regional/index.js';
import { verstehe, entscheide, erkenneBefehl, erkenneZiffer } from './nlu.js';

const dialog = new Dialog();

const el = {
  verlauf: document.getElementById('verlauf'),
  zwischen: document.getElementById('zwischenergebnis'),
  tastenfeld: document.getElementById('tastenfeld'),
  auskunft: document.getElementById('auskunft'),
  pfad: document.getElementById('pfad'),
  textForm: document.getElementById('text-form'),
  textEingabe: document.getElementById('text-eingabe'),
  mikro: document.getElementById('btn-mikro'),
  mikroText: document.querySelector('.mikro-text'),
  info: document.getElementById('btn-info'),
  infoPanel: document.getElementById('info-panel'),
  kennzahlen: document.getElementById('kb-kennzahlen'),
  optSprachausgabe: document.getElementById('opt-sprachausgabe'),
  optTempo: document.getElementById('opt-tempo'),
  tempoWert: document.getElementById('tempo-wert'),
  optStimme: document.getElementById('opt-stimme'),
  optRegion: document.getElementById('opt-region'),
  diagnose: document.getElementById('diagnose'),
};

// ---------------------------------------------------------------------------
// Sprachausgabe und Mikrofon
// ---------------------------------------------------------------------------

const sprecher = new Sprecher({
  onStart: () => zuhoerer.pausieren(),
  onEnde: () => zuhoerer.fortsetzen(),
  onNichtVerfuegbar: () => {
    systemhinweis('Die Sprachausgabe scheint in dieser Umgebung blockiert zu sein. Alle Antworten stehen vollständig auf dem Bildschirm. Ein Klick auf den Schalter "Sprachausgabe" versucht es erneut.');
  },
});

const zuhoerer = new Zuhoerer({
  onZwischenergebnis: (text) => { el.zwischen.textContent = text; },
  onErgebnis: (text) => {
    el.zwischen.textContent = '';
    eingabeVerarbeiten(text, 'sprache');
  },
  onStatus: (status) => {
    const beschriftung = { hoert: 'Hört zu', pause: 'Pause', verarbeitet: 'Verstanden', aus: 'Sprechen' };
    el.mikro.setAttribute('aria-pressed', String(status === 'hoert' || status === 'pause' || status === 'verarbeitet'));
    el.mikroText.textContent = beschriftung[status] ?? 'Sprechen';
  },
  onFehler: (meldung) => systemhinweis(meldung),
});

// ---------------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------------

function blase(text, art, stufe) {
  const div = document.createElement('div');
  div.className = `blase blase-${art}`;
  if (art === 'bot' && typeof stufe === 'number' && stufe > 0) {
    const marke = document.createElement('span');
    marke.className = 'blase-stufe';
    marke.textContent = `Stufe ${stufe} — ${['', 'Bereich', 'Leistung', 'Detail'][stufe]}`;
    div.append(marke);
  }
  div.append(document.createTextNode(text));
  el.verlauf.append(div);
  // Erst nach dem Layout scrollen, sonst ist scrollHeight noch der alte Wert.
  requestAnimationFrame(() => { el.verlauf.scrollTop = el.verlauf.scrollHeight; });
}

function systemhinweis(text) {
  blase(text, 'system');
}

// ---------------------------------------------------------------------------
// Denk-Indikator
//
// Die Klassifikation selbst ist in Millisekunden fertig. Die kurze sichtbare
// Pause mit den drei Punkten gibt dem Blick Zeit, der eigenen Eingabe zu
// folgen, bevor die Antwort erscheint - und macht am Bildschirm sichtbar,
// dass gearbeitet wird. Sie skaliert leicht mit der Antwortlaenge und faellt
// weg, wenn der Nutzer waehrenddessen schon weitertippt.
// ---------------------------------------------------------------------------

let denkIndikator = null;
let denkTimer = null;

function denkenZeigen() {
  denkenVerbergen();
  denkIndikator = document.createElement('div');
  denkIndikator.className = 'denkt';
  denkIndikator.setAttribute('aria-label', 'Der Assistent denkt nach');
  for (let i = 0; i < 3; i += 1) {
    const punkt = document.createElement('span');
    punkt.className = 'denkt-punkt';
    denkIndikator.append(punkt);
  }
  el.verlauf.append(denkIndikator);
  el.verlauf.scrollTop = el.verlauf.scrollHeight;
}

function denkenVerbergen() {
  if (denkTimer) { clearTimeout(denkTimer); denkTimer = null; }
  if (denkIndikator) { denkIndikator.remove(); denkIndikator = null; }
}

function tastenfeldZeichnen(optionen) {
  el.tastenfeld.replaceChildren();
  for (const option of optionen) {
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = `taste${option.gehoert ? ' taste-gehoert' : ''}`;
    knopf.dataset.ziffer = String(option.ziffer);

    const ziffer = document.createElement('span');
    ziffer.className = 'taste-ziffer';
    ziffer.textContent = String(option.ziffer);

    const label = document.createElement('span');
    label.textContent = option.label + (option.gehoert ? ' ✓' : '');

    knopf.append(ziffer, label);
    knopf.addEventListener('click', () => eingabeVerarbeiten(String(option.ziffer), 'taste'));
    el.tastenfeld.append(knopf);
  }
}

function pfadZeichnen(pfad) {
  el.pfad.replaceChildren();
  pfad.forEach((glied, index) => {
    if (index > 0) {
      const pfeil = document.createElement('span');
      pfeil.className = 'pfad-pfeil';
      pfeil.textContent = '›';
      el.pfad.append(pfeil);
    }
    const span = document.createElement('span');
    span.className = 'pfad-glied';
    const ebene = document.createElement('span');
    ebene.className = 'pfad-ebene';
    ebene.textContent = glied.ebene;
    span.append(ebene, document.createTextNode(glied.label));
    el.pfad.append(span);
  });
}

function auskunftZeichnen(anzeige, stufe) {
  el.auskunft.replaceChildren();
  if (!anzeige) return;

  const kopf = document.createElement('div');
  kopf.className = 'auskunft-kopf';

  if (stufe > 0) {
    const marke = document.createElement('span');
    marke.className = 'auskunft-stufe';
    marke.textContent = `Stufe ${stufe} — ${['', 'Bereichswissen', 'Leistung', 'Detailauskunft'][stufe]}`;
    kopf.append(marke);
  }

  const h2 = document.createElement('h2');
  h2.textContent = anzeige.titel;
  kopf.append(h2);

  if (anzeige.untertitel) {
    const p = document.createElement('p');
    p.className = 'auskunft-untertitel';
    p.textContent = anzeige.untertitel;
    kopf.append(p);
  }
  el.auskunft.append(kopf);

  for (const absatz of anzeige.absaetze ?? []) {
    if (!absatz) continue;
    const p = document.createElement('p');
    p.className = 'auskunft-absatz';
    p.textContent = absatz;
    el.auskunft.append(p);
  }

  for (const liste of anzeige.listen ?? []) {
    if (!liste?.eintraege?.length) continue;
    const block = document.createElement('section');
    block.className = 'block';
    const titel = document.createElement('h3');
    titel.className = 'block-titel';
    titel.textContent = liste.titel;
    const ul = document.createElement('ul');
    ul.className = 'block-liste';
    for (const eintrag of liste.eintraege) {
      if (!eintrag) continue;
      const li = document.createElement('li');
      li.textContent = eintrag;
      ul.append(li);
    }
    block.append(titel, ul);
    el.auskunft.append(block);
  }

  if (anzeige.hinweis) {
    const hinweis = document.createElement('p');
    hinweis.className = 'hinweis';
    hinweis.textContent = anzeige.hinweis;
    el.auskunft.append(hinweis);
  }

  el.auskunft.scrollTop = 0;
}

function auskunftLeeren() {
  el.auskunft.replaceChildren();
  const leer = document.createElement('div');
  leer.className = 'auskunft-leer';
  const stark = document.createElement('strong');
  stark.textContent = 'Noch keine Auskunft';
  const p = document.createElement('p');
  p.textContent = 'Sobald ein Bereich erkannt ist, erscheint hier das Bereichswissen — und danach die vollständige Leistungsauskunft zum Nachlesen.';
  leer.append(stark, p);
  el.auskunft.append(leer);
}

function diagnoseZeichnen(text) {
  if (!text) { el.diagnose.textContent = '–'; return; }

  // Steuerbefehle und Ziffernwahl laufen an der Klassifikation vorbei - das
  // soll die Diagnoseanzeige auch so ausweisen.
  const befehl = erkenneBefehl(text);
  if (befehl) {
    el.diagnose.textContent = `art=befehl  befehl=${befehl}`;
    el.diagnose.title = 'Steuerbefehl, keine Klassifikation nötig';
    return;
  }
  const ziffer = erkenneZiffer(text);
  if (ziffer !== null && dialog.optionen.some((o) => o.ziffer === ziffer)) {
    el.diagnose.textContent = `art=ziffernwahl  ziffer=${ziffer}`;
    el.diagnose.title = 'Auswahl aus dem angebotenen Menü';
    return;
  }

  const analyse = verstehe(text);
  const ergebnis = entscheide(analyse);
  const bester = analyse.clusterTreffer[0];
  const teile = [
    `art=${ergebnis.art}`,
    bester ? `cluster=${bester.id}(${bester.score.toFixed(1)})` : 'cluster=–',
    analyse.leistungTreffer[0] ? `leistung=${analyse.leistungTreffer[0].id}(${analyse.leistungTreffer[0].score.toFixed(1)})` : 'leistung=–',
    analyse.aspekt ? `aspekt=${analyse.aspekt}` : null,
    `konfidenz=${analyse.sicherheit.toFixed(2)}`,
  ].filter(Boolean);
  el.diagnose.textContent = teile.join('  ');
  el.diagnose.title = `Tokens: ${analyse.tokens.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

function antwortAusgeben(antwort) {
  // Landeswahl kann auch per Sprache erfolgt sein - Select nachziehen.
  if (el.optRegion.value !== (dialog.land ?? '')) el.optRegion.value = dialog.land ?? '';

  blase(antwort.sprich, 'bot', antwort.stufe);
  tastenfeldZeichnen(antwort.optionen ?? []);
  pfadZeichnen(antwort.pfad ?? []);
  if (antwort.anzeige && (antwort.stufe > 0 || antwort.quelle)) {
    auskunftZeichnen(antwort.anzeige, antwort.stufe);
  } else if (antwort.anzeige) {
    auskunftZeichnen(antwort.anzeige, 0);
  }
  sprecher.sprich(antwort.sprich);
}

function eingabeVerarbeiten(text, quelle) {
  const eingabe = (text ?? '').trim();
  if (!eingabe) return;

  // Barge-in: Wer spricht oder tippt, unterbricht die laufende Ausgabe -
  // und eine noch ausstehende Antwort wird sofort abgeraeumt.
  sprecher.abbrechen();
  denkenVerbergen();

  blase(eingabe, 'nutzer');
  if (quelle !== 'taste') diagnoseZeichnen(eingabe);

  const antwort = dialog.verarbeite(eingabe);

  denkenZeigen();
  const pause = Math.min(1100, 380 + antwort.sprich.length * 1.2 + Math.random() * 180);
  denkTimer = setTimeout(() => {
    denkenVerbergen();
    antwortAusgeben(antwort);
  }, pause);
}

// ---------------------------------------------------------------------------
// Ereignisse
// ---------------------------------------------------------------------------

el.textForm.addEventListener('submit', (ereignis) => {
  ereignis.preventDefault();
  const wert = el.textEingabe.value;
  el.textEingabe.value = '';
  eingabeVerarbeiten(wert, 'text');
});

el.mikro.addEventListener('click', () => {
  if (zuhoerer.aktiv) {
    zuhoerer.stoppen();
  } else {
    zuhoerer.starten();
  }
});

el.info.addEventListener('click', () => {
  const offen = el.infoPanel.hidden;
  el.infoPanel.hidden = !offen;
  el.info.setAttribute('aria-expanded', String(offen));
});

el.optSprachausgabe.addEventListener('change', () => {
  sprecher.stummSchalten(!el.optSprachausgabe.checked);
  if (el.optSprachausgabe.checked) sprecher.reaktivieren();
});

el.optTempo.addEventListener('input', () => {
  const wert = Number(el.optTempo.value);
  sprecher.tempoSetzen(wert);
  el.tempoWert.textContent = `${wert.toFixed(1).replace('.', ',')}×`;
});

el.optStimme.addEventListener('change', () => {
  sprecher.stimmeSetzen(el.optStimme.value);
});

el.optRegion.addEventListener('change', () => {
  const geaendert = dialog.landSetzen(el.optRegion.value || null);
  if (geaendert && dialog.land) {
    const antwort = dialog.landBestaetigen();
    dialog.merke(antwort);
    antwortAusgeben(antwort);
  } else if (geaendert) {
    systemhinweis('Regionale Angaben sind abgeschaltet - es gelten wieder die bundesweiten Spannen.');
  }
});

// Ziffernwahl auch ueber die Tastatur - wie am Telefon.
document.addEventListener('keydown', (ereignis) => {
  if (document.activeElement === el.textEingabe) return;
  if (/^[0-9]$/.test(ereignis.key)) {
    const taste = el.tastenfeld.querySelector(`[data-ziffer="${ereignis.key}"]`);
    if (taste) {
      ereignis.preventDefault();
      taste.click();
    }
  }
  if (ereignis.key === 'Escape') {
    sprecher.abbrechen();
  }
});

function stimmenlisteFuellen() {
  const stimmen = sprecher.verfuegbareStimmen();
  if (!stimmen.length) return;
  const aktuell = el.optStimme.value;
  el.optStimme.replaceChildren();
  const standard = document.createElement('option');
  standard.value = '';
  standard.textContent = 'Standard';
  el.optStimme.append(standard);
  for (const stimme of stimmen) {
    const option = document.createElement('option');
    option.value = stimme.name;
    option.textContent = `${stimme.name}${stimme.localService ? '' : ' (online)'}`;
    el.optStimme.append(option);
  }
  el.optStimme.value = aktuell;
}

if (sprachausgabeVerfuegbar) {
  stimmenlisteFuellen();
  window.speechSynthesis.addEventListener?.('voiceschanged', stimmenlisteFuellen);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function start() {
  const k = kennzahlen();
  const rk = regionalKennzahlen();
  el.kennzahlen.textContent =
    `${k.leistungen} Leistungen · ${k.cluster} Bereiche · ${k.leistungen * k.aspekte} Detailauskünfte · ${rk.registerbereiche} Registerbereiche mit Landesdaten (${Object.keys(rk.jeLand).map((c) => LAENDER[c].kuerzel).join(', ')})`;

  auskunftLeeren();

  const begruessung = dialog.begruessung();
  blase(begruessung.sprich, 'bot', 0);
  auskunftZeichnen(begruessung.anzeige, 0);
  pfadZeichnen([]);

  if (!spracheingabeVerfuegbar) {
    systemhinweis('Dieser Browser unterstützt keine Spracherkennung. Der Assistent ist über die Texteingabe und die Zifferntasten vollständig bedienbar. Für Spracheingabe eignen sich Chrome, Edge oder Safari.');
    el.mikro.disabled = true;
    el.mikro.title = 'Spracherkennung in diesem Browser nicht verfügbar';
  }
  if (!sprachausgabeVerfuegbar) {
    el.optSprachausgabe.disabled = true;
    el.optSprachausgabe.checked = false;
  }

  el.textEingabe.focus();
}

start();
