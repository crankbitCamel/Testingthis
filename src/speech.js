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
        'not-allowed': 'Der Zugriff auf das Mikrofon wurde abgelehnt. Sie können den Assistenten über die Texteingabe bedienen.',
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
 * Sprachausgabe. Waehlt eine deutsche Stimme, zerlegt lange Texte in Saetze
 * und meldet Beginn und Ende, damit das Mikrofon solange pausieren kann.
 */
export class Sprecher {
  constructor({ onStart, onEnde } = {}) {
    this.onStart = onStart ?? (() => {});
    this.onEnde = onEnde ?? (() => {});
    this.stimme = null;
    this.tempo = 1.0;
    this.stumm = false;
    this.laeuft = false;
    if (sprachausgabeVerfuegbar) {
      this.stimmeWaehlen();
      window.speechSynthesis.addEventListener?.('voiceschanged', () => this.stimmeWaehlen());
    }
  }

  stimmeWaehlen() {
    if (!sprachausgabeVerfuegbar) return;
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
    this.stimme = this.verfuegbareStimmen().find((s) => s.name === name) ?? this.stimme;
  }

  /** Spricht einen Text. Bricht laufende Ausgaben ab (Barge-in). */
  sprich(text) {
    if (!sprachausgabeVerfuegbar || this.stumm || !text) {
      this.onEnde();
      return;
    }
    window.speechSynthesis.cancel();

    // Sehr lange Texte werden von manchen Browsern abgeschnitten; deshalb
    // saetzeweise ausgeben.
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
    this.onStart();

    saetze.forEach((satz, index) => {
      const aeusserung = new SpeechSynthesisUtterance(satz);
      aeusserung.lang = 'de-DE';
      aeusserung.rate = this.tempo;
      aeusserung.pitch = 1;
      if (this.stimme) aeusserung.voice = this.stimme;
      if (index === saetze.length - 1) {
        aeusserung.onend = () => {
          this.laeuft = false;
          this.onEnde();
        };
        aeusserung.onerror = () => {
          this.laeuft = false;
          this.onEnde();
        };
      }
      window.speechSynthesis.speak(aeusserung);
    });
  }

  abbrechen() {
    if (!sprachausgabeVerfuegbar) return;
    window.speechSynthesis.cancel();
    this.laeuft = false;
    this.onEnde();
  }

  tempoSetzen(wert) {
    this.tempo = Math.min(2, Math.max(0.5, wert));
  }

  stummSchalten(wert) {
    this.stumm = wert;
    if (wert) this.abbrechen();
  }
}
