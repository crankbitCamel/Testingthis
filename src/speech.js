/**
 * Sprachein- und -ausgabe ueber die Web Speech API des Browsers.
 *
 * Beides ist optional: Fehlt die API - etwa in Firefox oder in einem
 * abgeschotteten Netz -, bleibt die Anwendung ueber die Texteingabe und die
 * Zifferntasten vollstaendig bedienbar. Eine Verwaltungsanwendung darf nicht
 * daran scheitern, dass ein Browser kein Mikrofon freigibt.
 */

const SpeechRecognitionKlasse = typeof window !== 'undefined'
  ? (window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null)
  : null;

export const spracheingabeVerfuegbar = Boolean(SpeechRecognitionKlasse);
export const sprachausgabeVerfuegbar = typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * Kapselt die kontinuierliche Spracherkennung.
 * Meldet Zwischenergebnisse fuer die Live-Anzeige und Endergebnisse an den
 * Dialog. Startet nach kurzen Pausen selbsttaetig neu, solange das Mikrofon
 * aktiv bleiben soll.
 */
export class Zuhoerer {
  constructor({ onZwischenergebnis, onErgebnis, onStatus, onFehler } = {}) {
    this.onZwischenergebnis = onZwischenergebnis ?? (() => {});
    this.onErgebnis = onErgebnis ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.onFehler = onFehler ?? (() => {});
    this.aktiv = false;
    this.pausiert = false;
    this.erkennung = null;
  }

  starten() {
    if (!spracheingabeVerfuegbar) {
      this.onFehler('Spracherkennung wird von diesem Browser nicht unterstützt. Nutzen Sie die Texteingabe.');
      return false;
    }
    if (this.aktiv) return true;

    const erkennung = new SpeechRecognitionKlasse();
    erkennung.lang = 'de-DE';
    erkennung.continuous = true;
    erkennung.interimResults = true;
    erkennung.maxAlternatives = 3;

    erkennung.onstart = () => {
      this.aktiv = true;
      this.onStatus('hoert');
    };

    erkennung.onresult = (ereignis) => {
      let zwischen = '';
      for (let i = ereignis.resultIndex; i < ereignis.results.length; i += 1) {
        const ergebnis = ereignis.results[i];
        const text = ergebnis[0].transcript.trim();
        if (ergebnis.isFinal) {
          if (text) {
            this.onStatus('verarbeitet');
            this.onErgebnis(text, [...ergebnis].map((a) => a.transcript.trim()));
          }
        } else {
          zwischen += `${text} `;
        }
      }
      if (zwischen.trim()) this.onZwischenergebnis(zwischen.trim());
    };

    erkennung.onerror = (ereignis) => {
      const meldungen = {
        'no-speech': 'Ich habe nichts gehört. Sprechen Sie bitte noch einmal.',
        'audio-capture': 'Kein Mikrofon gefunden.',
        'not-allowed': 'Der Zugriff auf das Mikrofon wurde abgelehnt oder ist in dieser Umgebung gesperrt. Sie können den Assistenten über die Texteingabe bedienen.',
        network: 'Die Spracherkennung braucht eine Netzverbindung. Nutzen Sie die Texteingabe.',
        aborted: null,
      };
      const meldung = meldungen[ereignis.error];
      if (meldung) this.onFehler(meldung);
      if (ereignis.error === 'not-allowed' || ereignis.error === 'audio-capture') {
        this.aktiv = false;
        this.onStatus('aus');
      }
    };

    erkennung.onend = () => {
      // Chrome beendet die Erkennung nach Sprechpausen von selbst.
      if (this.aktiv && !this.pausiert) {
        try {
          erkennung.start();
        } catch {
          this.aktiv = false;
          this.onStatus('aus');
        }
      } else if (!this.aktiv) {
        this.onStatus('aus');
      }
    };

    this.erkennung = erkennung;
    try {
      erkennung.start();
      return true;
    } catch (fehler) {
      this.onFehler(`Spracherkennung konnte nicht gestartet werden: ${fehler.message}`);
      return false;
    }
  }

  stoppen() {
    this.aktiv = false;
    this.pausiert = false;
    if (this.erkennung) {
      try { this.erkennung.stop(); } catch { /* bereits gestoppt */ }
    }
    this.onStatus('aus');
  }

  /** Waehrend der Bot spricht, pausiert das Mikrofon, um sich nicht selbst zu hoeren. */
  pausieren() {
    if (!this.aktiv) return;
    this.pausiert = true;
    if (this.erkennung) {
      try { this.erkennung.stop(); } catch { /* egal */ }
    }
    this.onStatus('pause');
  }

  fortsetzen() {
    if (!this.aktiv || !this.pausiert) return;
    this.pausiert = false;
    if (this.erkennung) {
      try {
        this.erkennung.start();
        this.onStatus('hoert');
      } catch { /* startet ueber onend erneut */ }
    }
  }

  umschalten() {
    if (this.aktiv) this.stoppen(); else this.starten();
    return this.aktiv;
  }
}

/**
 * Sprachausgabe.
 *
 * Die Web Speech API ist im Detail tueckisch; die Klasse arbeitet um die drei
 * bekannten Chrome-Fehler herum, an denen naive Implementierungen scheitern:
 *
 *   1. cancel() unmittelbar gefolgt von speak() verschluckt die Aeusserung
 *      stillschweigend. Deshalb liegt zwischen Abbruch und Neustart immer
 *      eine kurze Entkopplungspause.
 *   2. Die Engine bleibt nach einem Abbruch gelegentlich im Zustand
 *      "paused" haengen. Deshalb wird vor jedem Sprechen resume() gerufen.
 *   3. Laengere Ausgaben stoppen nach etwa 15 Sekunden, wenn die Engine
 *      einschlaeft. Ein Watchdog haelt sie mit periodischem resume() wach.
 *
 * Zusaetzlich meldet ein Startwaechter, wenn trotz allem nichts zu hoeren
 * ist - etwa weil die Umgebung die Sprachausgabe blockiert. Dann faellt die
 * Anwendung sichtbar statt still auf die reine Bildschirmausgabe zurueck.
 */
export class Sprecher {
  constructor({ onStart, onEnde, onNichtVerfuegbar } = {}) {
    this.onStart = onStart ?? (() => {});
    this.onEnde = onEnde ?? (() => {});
    this.onNichtVerfuegbar = onNichtVerfuegbar ?? (() => {});
    this.stimme = null;
    this.tempo = 1.0;
    this.stumm = false;
    this.laeuft = false;
    this.defekt = false;
    this._startTimer = null;
    this._startWaechter = null;
    this._watchdog = null;
    this._offen = 0;
    if (sprachausgabeVerfuegbar) {
      this.stimmeWaehlen();
      // Stimmen laden asynchron; Chrome liefert sie erst nach voiceschanged.
      window.speechSynthesis.addEventListener?.('voiceschanged', () => this.stimmeWaehlen());
    }
  }

  stimmeWaehlen() {
    if (!sprachausgabeVerfuegbar || this.stimmeManuell) return;
    const stimmen = window.speechSynthesis.getVoices().filter((s) => s.lang?.startsWith('de'));
    if (!stimmen.length) return;
    // Lokale Stimmen klingen gleichmaessiger und funktionieren offline.
    this.stimme = stimmen.find((s) => s.localService) ?? stimmen[0];
  }

  verfuegbareStimmen() {
    if (!sprachausgabeVerfuegbar) return [];
    return window.speechSynthesis.getVoices().filter((s) => s.lang?.startsWith('de'));
  }

  stimmeSetzen(name) {
    const gewaehlt = this.verfuegbareStimmen().find((s) => s.name === name);
    if (gewaehlt) {
      this.stimme = gewaehlt;
      this.stimmeManuell = true;
    } else if (!name) {
      this.stimmeManuell = false;
      this.stimmeWaehlen();
    }
  }

  /** Spricht einen Text. Bricht laufende Ausgaben ab (Barge-in). */
  sprich(text) {
    if (!sprachausgabeVerfuegbar || this.stumm || this.defekt || !text) {
      this.onEnde();
      return;
    }

    this._aufraeumen();
    window.speechSynthesis.cancel();

    // Chrome-Fehler 1: Nach cancel() braucht die Engine einen Moment, bevor
    // sie eine neue Aeusserung annimmt - sonst verschluckt sie sie ohne
    // Fehlermeldung. Genau das aeusserte sich als "TTS funktioniert nicht".
    this._startTimer = setTimeout(() => this._sprechen(text), 150);
  }

  _sprechen(text) {
    // Chrome-Fehler 2: haengengebliebener paused-Zustand.
    try { window.speechSynthesis.resume(); } catch { /* egal */ }

    // Sehr lange Texte werden von manchen Engines abgeschnitten; deshalb
    // in Satzgruppen von etwa 180 Zeichen ausgeben.
    const saetze = text
      .split(/(?<=[.!?:])\s+/)
      .reduce((gruppen, satz) => {
        const letzte = gruppen[gruppen.length - 1];
        if (letzte && (letzte.length + satz.length) < 180) {
          gruppen[gruppen.length - 1] = `${letzte} ${satz}`;
        } else {
          gruppen.push(satz);
        }
        return gruppen;
      }, []);

    this.laeuft = true;
    this._offen = saetze.length;
    let gestartet = false;
    this.onStart();

    const fertigMelden = () => {
      this._offen -= 1;
      if (this._offen <= 0) this._beenden();
    };

    for (const satz of saetze) {
      const aeusserung = new SpeechSynthesisUtterance(satz);
      aeusserung.lang = 'de-DE';
      aeusserung.rate = this.tempo;
      aeusserung.pitch = 1;
      if (this.stimme) aeusserung.voice = this.stimme;
      aeusserung.onstart = () => { gestartet = true; };
      // Jede Aeusserung meldet ihr Ende - nicht nur die letzte. Bricht eine
      // mittlere ab, bleibt sonst der Zustand "spricht" haengen und das
      // Mikrofon pausiert dauerhaft.
      aeusserung.onend = fertigMelden;
      aeusserung.onerror = (e) => {
        // "interrupted"/"canceled" sind normale Barge-in-Folgen.
        if (e.error !== 'interrupted' && e.error !== 'canceled') gestartet = gestartet || false;
        fertigMelden();
      };
      window.speechSynthesis.speak(aeusserung);
    }

    // Startwaechter: Hat nach 1,5 Sekunden keine Aeusserung begonnen und die
    // Engine meldet auch kein Sprechen, ist die Ausgabe in dieser Umgebung
    // blockiert. Das wird einmal gemeldet statt still ignoriert.
    this._startWaechter = setTimeout(() => {
      if (!gestartet && !window.speechSynthesis.speaking && this.laeuft) {
        this.defekt = true;
        this._beenden();
        this.onNichtVerfuegbar();
      }
    }, 1500);

    // Chrome-Fehler 3: Engine schlaeft bei langen Ausgaben ein.
    this._watchdog = setInterval(() => {
      if (window.speechSynthesis.speaking) {
        try { window.speechSynthesis.resume(); } catch { /* egal */ }
      }
    }, 8000);
  }

  _beenden() {
    this.laeuft = false;
    this._aufraeumen();
    this.onEnde();
  }

  _aufraeumen() {
    clearTimeout(this._startTimer);
    clearTimeout(this._startWaechter);
    clearInterval(this._watchdog);
    this._startTimer = null;
    this._startWaechter = null;
    this._watchdog = null;
  }

  abbrechen() {
    if (!sprachausgabeVerfuegbar) return;
    this._aufraeumen();
    window.speechSynthesis.cancel();
    this.laeuft = false;
    this.onEnde();
  }

  /** Erneut versuchen, nachdem die Ausgabe als blockiert galt. */
  reaktivieren() {
    this.defekt = false;
  }

  tempoSetzen(wert) {
    this.tempo = Math.min(2, Math.max(0.5, wert));
  }

  stummSchalten(wert) {
    this.stumm = wert;
    if (wert) this.abbrechen();
  }
}
