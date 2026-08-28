/**
 * Dialogsteuerung des Verwaltungs-Voice-Agent.
 *
 * Der Bot fuehrt ein Gespraech in drei Stufen, so wie es die Behoerdennummer
 * 115 im Erstkontakt tut:
 *
 *   Stufe 1  Bereich    "Es geht um Melde- und Ausweisangelegenheiten.
 *                        Grob gilt hier: ..."   -> danach 1, 2 oder 3
 *   Stufe 2  Leistung   Kurzprofil der konkreten Leistung -> danach 1 bis 6
 *   Stufe 3  Aspekt     Unterlagen, Kosten, Ablauf, Fristen, Zustaendigkeit
 *
 * Jede Antwort trennt bewusst zwischen "sprich" - was vorgelesen wird, kurz
 * und ohne Aufzaehlungszeichen - und "anzeige" - was am Bildschirm steht,
 * vollstaendig und nachlesbar. Ein Voicebot, der Listen mit zwoelf Punkten
 * vorliest, ist am Telefon unbrauchbar.
 */
import {
  CLUSTER_BY_ID, LEISTUNG_BY_ID, ASPEKT_BY_ID, ASPEKT_MENUE,
  topLeistungen, leistungenImCluster,
} from './kb/index.js';
import { verstehe, entscheide, erkenneZiffer, erkenneBefehl, erkenneAspekt, erkenneLand, istReineOrtsangabe } from './nlu.js';
import { regional, LAENDER, registerbereichFuer } from './kb/regional/index.js';
import { rechtsebene, ebenenAnsage } from './kb/ebenen.js';

export const ZUSTAND = {
  START: 'start',
  BEREICHSWAHL: 'bereichswahl',
  CLUSTER: 'cluster',
  LEISTUNG: 'leistung',
  ASPEKT: 'aspekt',
  ORTSKLAERUNG: 'ortsklaerung',
  MENSCH: 'mensch',
  ENDE: 'ende',
};

/**
 * Formulierungsvariation. Ein Bot, der jede Antwort mit demselben Satz
 * einleitet, klingt nach Blechstimme. Die Varianten rotieren deterministisch
 * ueber einen Zaehler - deterministisch, damit Tests reproduzierbar bleiben,
 * rotierend, damit das Gespraech lebt.
 */
class Varianten {
  constructor() { this.zaehler = new Map(); }
  waehle(schluessel, varianten) {
    const n = this.zaehler.get(schluessel) ?? 0;
    this.zaehler.set(schluessel, n + 1);
    return varianten[n % varianten.length];
  }
}

const DISCLAIMER = 'Ich gebe allgemeine Auskunft. Gebühren und Fristen können in Ihrer Gemeinde abweichen. Verbindlich entscheidet immer die zuständige Behörde.';

/** Aufzaehlung fuer die Sprachausgabe: kurz halten, mit "und" verbinden. */
function sprichListe(eintraege, max = 3) {
  const teil = eintraege.slice(0, max);
  if (teil.length === 0) return '';
  if (teil.length === 1) return teil[0];
  return `${teil.slice(0, -1).join(', ')} und ${teil[teil.length - 1]}`;
}

function satzEnde(text) {
  const t = (text ?? '').trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Baut die Ziffernansage: "Sagen Sie 1 für ..., 2 für ... oder 3 für ...". */
function ziffernansage(optionen) {
  const teile = optionen.map((o) => `${o.ziffer} für ${o.sprechLabel ?? o.label}`);
  if (teile.length === 0) return '';
  if (teile.length === 1) return `Sagen Sie ${teile[0]}.`;
  return `Sagen Sie ${teile.slice(0, -1).join(', ')} oder ${teile[teile.length - 1]}.`;
}

export class Dialog {
  constructor() {
    /** Bundesland des Anrufers - ueberdauert ein "neues Anliegen" bewusst. */
    this.land = null;
    this.landHinweisGegeben = false;
    /** Der Anrufer hat die Ortsfrage abgelehnt - nicht erneut fragen. */
    this.ortsfrageAbgelehnt = false;
    this.varianten = new Varianten();
    this.zuruecksetzen();
  }

  zuruecksetzen() {
    this.zustand = ZUSTAND.START;
    /** Waehrend der Ortsklaerung: die Antwort, die danach gegeben wird. */
    this.ausstehend = null;
    this.clusterId = null;
    this.leistungId = null;
    this.aspektId = null;
    /** Zuletzt angebotene Ziffernoptionen - Grundlage der Auswahl. */
    this.optionen = [];
    /** Bereichsvorschlaege aus einer mehrdeutigen Frage. */
    this.vorschlagCluster = [];
    /** Zaehler fuer Nichtverstehen, steuert die Eskalation an einen Menschen. */
    this.missverstaendnisse = 0;
    /** Bereits vorgelesene Aspekte einer Leistung, um nicht zu wiederholen. */
    this.gehoerteAspekte = new Set();
    this.disclaimerGesagt = false;
    this.letzteAntwort = null;
    this.verlauf = [];
  }

  // -------------------------------------------------------------------------
  // Einstieg
  // -------------------------------------------------------------------------

  begruessung() {
    const antwort = {
      stufe: 0,
      zustand: ZUSTAND.START,
      sprich: 'Guten Tag, hier ist der Verwaltungsassistent. Schildern Sie Ihr Anliegen einfach in eigenen Worten. Zum Beispiel: Ich bin umgezogen. Oder: Mein Ausweis ist abgelaufen.',
      anzeige: {
        titel: 'Wie kann ich helfen?',
        absaetze: [
          'Beschreiben Sie Ihr Anliegen in eigenen Worten. Ich ordne es einem Bereich zu, sage Ihnen zuerst, was dort allgemein gilt, und frage dann per Ziffernwahl nach, was genau Sie brauchen.',
        ],
        listen: [
          {
            titel: 'Beispiele, die gut funktionieren',
            eintraege: [
              'Ich bin umgezogen und weiß nicht, was ich melden muss',
              'Mein Personalausweis läuft nächsten Monat ab',
              'Ich habe ein gebrauchtes Auto gekauft',
              'Wir haben ein Kind bekommen',
              'Ich möchte mich selbstständig machen',
              'Ich habe einen Bußgeldbescheid bekommen',
            ],
          },
        ],
        hinweis: DISCLAIMER,
      },
      optionen: [],
      pfad: [],
      quelle: null,
    };
    this.letzteAntwort = antwort;
    return antwort;
  }

  // -------------------------------------------------------------------------
  // Haupteinstieg fuer jede Nutzeraeusserung
  // -------------------------------------------------------------------------

  /**
   * Verarbeitet eine Aeusserung und liefert die naechste Antwort.
   * @param {string} eingabe gesprochener oder getippter Text
   */
  verarbeite(eingabe) {
    const text = (eingabe ?? '').trim();
    this.verlauf.push({ rolle: 'nutzer', text });

    if (!text) return this.merke(this.nichtVerstanden());

    // 1. Steuerbefehle gelten in jedem Zustand.
    const befehl = erkenneBefehl(text);
    if (befehl) {
      const antwort = this.behandleBefehl(befehl);
      if (antwort) return this.merke(antwort);
    }

    // 2. Laeuft eine Ortsklaerung, ist jede Eingabe zuerst deren Antwort -
    //    ausser sie ist erkennbar ein neues Anliegen.
    if (this.zustand === ZUSTAND.ORTSKLAERUNG && this.ausstehend) {
      const ziffernwahl = erkenneZiffer(text);
      if (ziffernwahl !== null && this.optionen.some((o) => o.ziffer === ziffernwahl)) {
        const option = this.optionen.find((o) => o.ziffer === ziffernwahl);
        this.missverstaendnisse = 0;
        return this.merke(this.folgeOption(option));
      }
      const neuesAnliegen = entscheide(verstehe(text));
      if (neuesAnliegen.art === 'unklar' || erkenneLand(text)) {
        this.missverstaendnisse = 0;
        return this.merke(this.ortsklaerungAufloesen(text));
      }
      // Der Anrufer hat ein anderes Anliegen begonnen - Klaerung verwerfen.
      this.ausstehend = null;
    }

    // 3. Ziffernwahl auf ein zuvor angebotenes Menue.
    const ziffer = erkenneZiffer(text);
    if (ziffer !== null && this.optionen.length > 0) {
      const option = this.optionen.find((o) => o.ziffer === ziffer);
      if (option) {
        this.missverstaendnisse = 0;
        return this.merke(this.folgeOption(option));
      }
      // Ziffer genannt, die es im Menue nicht gibt.
      if (/^[0-9]$|^(eins|zwei|drei|vier|fuenf|sechs|sieben|acht|neun|null)$/i.test(text.trim())) {
        return this.merke(this.zifferUnbekannt(ziffer));
      }
    }

    // 3. Landesangabe: als Nebeneffekt setzen; ist der Satz NUR eine
    //    Landesangabe, wird bestaetigt und der Kontext regional neu gerendert.
    const landTreffer = erkenneLand(text);
    if (landTreffer) {
      this.landSetzen(landTreffer.code);
      if (istReineOrtsangabe(text, landTreffer.stichwort)) {
        this.missverstaendnisse = 0;
        return this.merke(this.landBestaetigen());
      }
      // Sonst laeuft die Klassifikation normal weiter - der Satz enthaelt
      // neben dem Ort auch ein Anliegen ("bin nach Koeln gezogen").
    }

    // 4. Innerhalb einer Leistung: direkte Frage nach einem Aspekt.
    if (this.leistungId) {
      const aspekt = erkenneAspekt(text);
      if (aspekt) {
        this.missverstaendnisse = 0;
        return this.merke(this.zeigeAspekt(this.leistungId, aspekt));
      }
    }

    // 4. Freie Aeusserung neu klassifizieren.
    const analyse = verstehe(text);
    const ergebnis = entscheide(analyse);

    if (ergebnis.art === 'leistung') {
      this.missverstaendnisse = 0;
      const aspekt = analyse.aspekt;
      if (aspekt) {
        // Die Frage war schon konkret: direkt auf Stufe 3 antworten.
        this.clusterId = ergebnis.clusterId;
        this.leistungId = ergebnis.leistungId;
        this.gehoerteAspekte = new Set();
        return this.merke(this.zeigeAspekt(ergebnis.leistungId, aspekt, { mitEinordnung: true }));
      }
      return this.merke(this.zeigeLeistung(ergebnis.leistungId));
    }

    if (ergebnis.art === 'cluster') {
      this.missverstaendnisse = 0;
      return this.merke(this.zeigeCluster(ergebnis.clusterId, analyse));
    }

    if (ergebnis.art === 'auswahl') {
      this.missverstaendnisse = 0;
      return this.merke(this.zeigeBereichswahl(ergebnis.clusterIds));
    }

    // Der Satz trug zwar kein erkennbares Anliegen, aber eine Ortsangabe -
    // dann ist die Landesbestaetigung die richtige Antwort, kein Fehlversuch.
    if (landTreffer) {
      this.missverstaendnisse = 0;
      return this.merke(this.landBestaetigen());
    }

    return this.merke(this.nichtVerstanden());
  }

  merke(antwort) {
    this.letzteAntwort = antwort;
    this.optionen = antwort.optionen ?? [];
    this.zustand = antwort.zustand;
    this.verlauf.push({ rolle: 'bot', text: antwort.sprich, stufe: antwort.stufe });
    return antwort;
  }

  // -------------------------------------------------------------------------
  // Regionale Schicht
  // -------------------------------------------------------------------------

  /** Setzt das Bundesland; liefert true, wenn sich etwas geaendert hat. */
  landSetzen(code) {
    const neu = LAENDER[code] ? code : null;
    if (neu === this.land) return false;
    this.land = neu;
    return true;
  }

  /**
   * Antwort auf eine reine Landesangabe ("Ich wohne in Koeln"): bestaetigen
   * und - wenn gerade eine Leistung offen ist - die aktuelle Auskunft mit dem
   * Regionalblock neu aufbauen, damit die Angabe sofort sichtbar wirkt.
   */
  landBestaetigen() {
    const land = LAENDER[this.land];
    if (this.leistungId && this.aspektId && this.aspektId !== 'alles') {
      const a = this.zeigeAspekt(this.leistungId, this.aspektId);
      return { ...a, sprich: `Verstanden, ${land.name}. ${a.sprich}` };
    }
    if (this.leistungId) {
      const a = this.zeigeLeistung(this.leistungId, { kurz: true });
      return { ...a, sprich: `Verstanden, ${land.name}. ${a.sprich}` };
    }
    const a = this.letzteAntwort ?? this.begruessung();
    return {
      ...a,
      sprich: `Verstanden, ich berücksichtige jetzt die Angaben für ${land.name}. Worum geht es?`,
    };
  }

  /**
   * Baut den Regionalblock einer Leistung fuer das gesetzte Land.
   * aspektId begrenzt auf die zum Aspekt passenden Felder; ohne aspektId
   * (Leistungs- und Vollansicht) wird alles Hinterlegte gezeigt.
   */
  regionalTeile(leistungId, aspektId = null) {
    if (!this.land) return null;
    const r = regional(leistungId, this.land);
    if (!r) return null;
    const { land, eintrag, profil, bereich } = r;

    const eintraege = [];
    const will = (feld) => !aspektId || ASPEKT_REGIONALFELDER[aspektId]?.includes(feld);

    if (eintrag) {
      if (eintrag.zustaendigkeit && will('zustaendigkeit')) {
        eintraege.push(`Zuständig in ${land.kuerzel}: ${eintrag.zustaendigkeit.stelle}${eintrag.zustaendigkeit.hinweis ? ` — ${eintrag.zustaendigkeit.hinweis}` : ''}`);
      }
      if (eintrag.gebuehren && will('gebuehren')) {
        for (const g of eintrag.gebuehren) eintraege.push(`${g.position}: ${g.betrag}`);
      }
      if (eintrag.fristen && will('fristen')) {
        for (const f of eintrag.fristen) eintraege.push(f);
      }
      if (eintrag.online && will('online')) eintraege.push(`Online in ${land.kuerzel}: ${eintrag.online}`);
      if (eintrag.besonderheiten && will('besonderheiten')) {
        for (const b of eintrag.besonderheiten) eintraege.push(b);
      }
      if (eintrag.rechtsgrundlagen && will('rechtsgrundlagen')) {
        for (const rg of eintrag.rechtsgrundlagen) eintraege.push(`Rechtsgrundlage: ${rg}`);
      }
    }
    // Ohne konkreten Leistungseintrag traegt das Registerbereichsprofil.
    if (!eintraege.length && profil) {
      eintraege.push(profil.kurz);
      for (const f of profil.fakten ?? []) eintraege.push(f);
    }
    if (!eintraege.length) return null;

    if (profil?.portal && !aspektId) eintraege.push(`Portal: ${profil.portal}`);
    const quelle = eintrag?.rechtsgrundlagen?.[0] ?? profil?.quelleHinweis;
    const standsatz = `Stand ${eintrag?.stand ?? land.stand}${quelle && !aspektId ? ` · ${quelle}` : ''}`;

    // Kurzer Sprechsatz: die wichtigste Landesabweichung, nicht die Liste.
    let sprichSatz = '';
    if (eintrag?.zustaendigkeit && will('zustaendigkeit')) {
      sprichSatz = `In ${land.name} ist dafür ${eintrag.zustaendigkeit.stelle} zuständig.`;
    } else if (eintrag?.gebuehren?.length && will('gebuehren')) {
      sprichSatz = `In ${land.name}: ${eintrag.gebuehren[0].position} ${eintrag.gebuehren[0].betrag}.`;
    } else if (eintrag?.fristen?.length && will('fristen')) {
      sprichSatz = `In ${land.name} gilt: ${eintrag.fristen[0]}`;
    } else if (eintrag?.besonderheiten?.length) {
      sprichSatz = `Für ${land.name} wichtig: ${eintrag.besonderheiten[0]}`;
    } else if (profil) {
      sprichSatz = `Für ${land.name}: ${profil.kurz}`;
    }

    return {
      liste: {
        titel: `Regional: ${land.name}${bereich ? ` · ${bereich.name}` : ''} (${standsatz})`,
        eintraege,
      },
      sprichSatz,
    };
  }

  /**
   * Hinweis, dass Landesdaten existieren - einmal pro Gespraech, und nur wenn
   * die Leistung tatsaechlich landes- oder ortsabhaengig ist.
   */
  landAngebot(l) {
    if (this.land || this.landHinweisGegeben) return null;
    if (l.belastbarkeit.quelle === 'bundesrecht') return null;
    if (!regional(l.id, 'nw') && !regional(l.id, 'rp')) return null;
    this.landHinweisGegeben = true;
    return 'Für NRW und Rheinland-Pfalz habe ich Landesdaten - nennen Sie dazu Ihr Bundesland.';
  }

  // -------------------------------------------------------------------------
  // Rechtsebenen-Klaerung
  //
  // Der Ablauf, den ein Anrufer erlebt: Er nennt sein Anliegen, das System
  // qualifiziert es, stellt selbst fest, auf welcher Ebene das Recht sitzt -
  // und fragt erst dann nach dem Ort, wenn die konkrete Antwort wirklich
  // davon abhaengt. Bundesrecht wird nie mit einer Ortsfrage belastet.
  // -------------------------------------------------------------------------

  /**
   * Prueft vor einer Aspektantwort, ob zuerst der Ort geklaert werden muss.
   * Liefert die Klaerungsfrage - oder null, wenn direkt geantwortet wird.
   */
  ortsklaerungNoetig(leistungId, aspektId) {
    if (this.land || this.ortsfrageAbgelehnt) return null;
    const e = rechtsebene(leistungId, aspektId);
    if (!e?.ortsabhaengig) return null;
    // Nur fragen, wenn wir die Antwort auch verfeinern koennten.
    if (!regional(leistungId, 'nw') && !regional(leistungId, 'rp')) return null;
    return e;
  }

  /** Stellt die Ortsfrage und merkt sich, welche Antwort danach faellig ist. */
  frageNachOrt(leistungId, aspektId, ebenenInfo) {
    const l = LEISTUNG_BY_ID[leistungId];
    this.ausstehend = { leistungId, aspektId };
    const nachLand = ebenenInfo.aufloesung === 'land';

    const frage = nachLand
      ? 'In welchem Bundesland wohnen Sie?'
      : 'Für welche Stadt oder Gemeinde fragen Sie?';

    const optionen = [
      { ziffer: 1, label: 'Nordrhein-Westfalen', sprechLabel: 'Nordrhein-Westfalen', ziel: { art: 'ort', land: 'nw' } },
      { ziffer: 2, label: 'Rheinland-Pfalz', sprechLabel: 'Rheinland-Pfalz', ziel: { art: 'ort', land: 'rp' } },
      { ziffer: 3, label: 'Anderes Bundesland / weiter mit bundesweiter Auskunft', sprechLabel: 'ein anderes Bundesland', ziel: { art: 'ort', land: null } },
    ];

    return {
      stufe: 3,
      zustand: ZUSTAND.ORTSKLAERUNG,
      sprich: [
        satzEnde(ebenenAnsage(leistungId, aspektId)),
        `Damit ich Ihnen die Werte für Ihren Ort nennen kann: ${frage}`,
        'Sie können auch einfach die Stadt sagen - oder 3 für die bundesweite Auskunft.',
      ].join(' '),
      anzeige: {
        titel: `Kurze Rückfrage: ${nachLand ? 'Ihr Bundesland' : 'Ihre Kommune'}`,
        untertitel: `${l.name} — ${ebenenInfo.ebene.name}`,
        absaetze: [
          ebenenInfo.ebene.erklaerung,
          'Hinterlegt sind Landesdaten für Nordrhein-Westfalen und Rheinland-Pfalz. Für andere Orte nenne ich die bundesweite Spanne.',
        ],
        listen: [],
        hinweis: null,
      },
      optionen,
      pfad: [
        { ebene: 'Leistung', label: l.name },
        { ebene: 'Rückfrage', label: nachLand ? 'Bundesland' : 'Kommune' },
      ],
      quelle: { stufe: 3, leistungId, aspektId, klaerung: true },
    };
  }

  /** Verarbeitet die Antwort auf die Ortsfrage. */
  ortsklaerungAufloesen(text) {
    const offen = this.ausstehend;
    this.ausstehend = null;
    if (!offen) return this.nichtVerstanden();

    const treffer = erkenneLand(text);
    if (treffer) {
      this.landSetzen(treffer.code);
      const a = this.zeigeAspekt(offen.leistungId, offen.aspektId);
      return { ...a, sprich: `${LAENDER[this.land].name}, verstanden. ${a.sprich}` };
    }

    // Ort genannt, aber nicht hinterlegt - oder Verzicht ("egal", "weiter").
    this.ortsfrageAbgelehnt = true;
    const a = this.zeigeAspekt(offen.leistungId, offen.aspektId);
    const istVerzicht = /(egal|weiter|ohne|weiss nicht|weiß nicht|keine ahnung|3|anderes)/i.test(text);
    const vorspann = istVerzicht
      ? 'Gut, dann bundesweit.'
      : 'Für diesen Ort habe ich keine eigenen Daten hinterlegt - ich nenne Ihnen die bundesweite Spanne; verbindlich ist Ihre örtliche Satzung.';
    return { ...a, sprich: `${vorspann} ${a.sprich}` };
  }

  // -------------------------------------------------------------------------
  // Steuerbefehle
  // -------------------------------------------------------------------------

  behandleBefehl(befehl) {
    switch (befehl) {
      case 'hauptmenue': {
        const cluster = this.clusterId;
        this.zuruecksetzen();
        this.disclaimerGesagt = true;
        const a = this.begruessung();
        return {
          ...a,
          sprich: 'Gut, wir fangen neu an. Worum geht es?',
          anzeige: { ...a.anzeige, titel: 'Neues Anliegen', absaetze: ['Beschreiben Sie Ihr neues Anliegen in eigenen Worten.', cluster ? 'Der vorherige Bereich wurde verlassen.' : ''].filter(Boolean) },
        };
      }
      case 'zurueck':
        return this.eineEbeneZurueck();
      case 'wiederholen':
        if (this.letzteAntwort) {
          return { ...this.letzteAntwort, sprich: this.letzteAntwort.sprich };
        }
        return this.begruessung();
      case 'mensch':
        return this.anMenschen('Sie haben ausdrücklich nach einer Mitarbeiterin oder einem Mitarbeiter gefragt.');
      case 'hilfe':
        return this.hilfe();
      case 'alles':
        if (this.leistungId) return this.zeigeVollauskunft(this.leistungId);
        return null;
      case 'beenden':
        return this.verabschiedung();
      case 'langsamer':
      case 'schneller':
        return null; // wird von der Oberflaeche behandelt
      default:
        return null;
    }
  }

  eineEbeneZurueck() {
    if (this.zustand === ZUSTAND.ASPEKT && this.leistungId) {
      return this.zeigeLeistung(this.leistungId, { kurz: true });
    }
    if (this.zustand === ZUSTAND.LEISTUNG && this.clusterId) {
      this.leistungId = null;
      return this.zeigeCluster(this.clusterId, null, { kurz: true });
    }
    this.clusterId = null;
    this.leistungId = null;
    return this.begruessung();
  }

  // -------------------------------------------------------------------------
  // Stufe 1: Bereichswahl bei Mehrdeutigkeit
  // -------------------------------------------------------------------------

  zeigeBereichswahl(clusterIds) {
    const cluster = clusterIds.map((id) => CLUSTER_BY_ID[id]).filter(Boolean).slice(0, 3);
    this.vorschlagCluster = cluster.map((c) => c.id);

    const optionen = cluster.map((c, i) => ({
      ziffer: i + 1,
      label: c.name,
      sprechLabel: c.sprechName,
      ziel: { art: 'cluster', clusterId: c.id },
    }));
    optionen.push({
      ziffer: 0,
      label: 'Nichts davon - Anliegen neu beschreiben',
      sprechLabel: 'nichts davon',
      ziel: { art: 'neu' },
    });

    const sprich = [
      'Ihr Anliegen kann in mehrere Bereiche fallen.',
      ziffernansage(optionen.slice(0, 3)),
      'Oder beschreiben Sie es noch einmal mit anderen Worten.',
    ].join(' ');

    return {
      stufe: 1,
      zustand: ZUSTAND.BEREICHSWAHL,
      sprich,
      anzeige: {
        titel: 'Welcher Bereich passt?',
        absaetze: ['Ihre Beschreibung passt zu mehreren Bereichen. Wählen Sie den passenden aus - danach nenne ich Ihnen zuerst, was dort allgemein gilt.'],
        listen: [{
          titel: 'Mögliche Bereiche',
          eintraege: cluster.map((c, i) => `${i + 1}. ${c.name} - ${c.lebenslagen.join(', ')}`),
        }],
        hinweis: this.disclaimerHinweis(),
      },
      optionen,
      pfad: [],
      quelle: { stufe: 1, clusterIds: this.vorschlagCluster },
    };
  }

  // -------------------------------------------------------------------------
  // Stufe 1: Bereich erkannt - grobes Bereichswissen ausgeben
  // -------------------------------------------------------------------------

  zeigeCluster(clusterId, analyse = null, { kurz = false } = {}) {
    const c = CLUSTER_BY_ID[clusterId];
    if (!c) return this.nichtVerstanden();
    this.clusterId = clusterId;
    this.leistungId = null;
    this.aspektId = null;
    this.gehoerteAspekte = new Set();

    const g = c.grundsatzwissen;

    // Wenn die Frage bereits auf bestimmte Leistungen zeigte, diese bevorzugt
    // anbieten - sonst die haeufigsten des Bereichs.
    let vorschlaege = [];
    if (analyse?.leistungTreffer?.length) {
      vorschlaege = analyse.leistungTreffer
        .filter((t) => t.cluster === clusterId)
        .slice(0, 3)
        .map((t) => LEISTUNG_BY_ID[t.id]);
    }
    if (vorschlaege.length < 3) {
      for (const l of topLeistungen(clusterId, 6)) {
        if (vorschlaege.length >= 3) break;
        if (!vorschlaege.some((v) => v.id === l.id)) vorschlaege.push(l);
      }
    }

    const optionen = vorschlaege.map((l, i) => ({
      ziffer: i + 1,
      label: l.name,
      sprechLabel: l.sprechName,
      ziel: { art: 'leistung', leistungId: l.id },
    }));
    const weitere = leistungenImCluster(clusterId).filter((l) => !vorschlaege.some((v) => v.id === l.id));
    if (weitere.length) {
      optionen.push({
        ziffer: 4,
        label: `Etwas anderes aus diesem Bereich (${weitere.length} weitere)`,
        sprechLabel: 'etwas anderes aus diesem Bereich',
        ziel: { art: 'clusterAlle', clusterId },
      });
    }
    optionen.push({ ziffer: 0, label: 'Anderer Bereich', sprechLabel: 'einen anderen Bereich', ziel: { art: 'neu' } });

    // Gesprochen: Einordnung, ein bis zwei Faustregeln, dann das Ziffernmenue.
    const sprichTeile = [
      kurz
        ? `Zurück zum Bereich ${c.sprechName}.`
        : this.varianten.waehle('clusterEinstieg', [
            `Verstanden, es geht um ${c.sprechName}.`,
            `Alles klar - ${c.sprechName}.`,
            `${c.sprechName}, gut.`,
            `Das gehört zu ${c.sprechName}.`,
          ]),
    ];
    if (!kurz) {
      sprichTeile.push(satzEnde(g.kurz));
      sprichTeile.push(`Grob gilt hier: ${satzEnde(g.faustregeln[0])}`);
      if (g.faustregeln[1]) sprichTeile.push(satzEnde(g.faustregeln[1]));
    }
    sprichTeile.push(this.varianten.waehle('clusterMenue', ['Damit ich genauer werden kann:', 'Um das einzugrenzen:', 'Sagen Sie mir, worum genau es geht:']));
    sprichTeile.push(ziffernansage(optionen.filter((o) => o.ziffer >= 1 && o.ziffer <= 3)));

    return {
      stufe: 1,
      zustand: ZUSTAND.CLUSTER,
      sprich: sprichTeile.filter(Boolean).join(' '),
      anzeige: {
        titel: c.name,
        untertitel: `Bereichswissen - was hier allgemein gilt`,
        absaetze: [g.kurz],
        listen: [
          { titel: 'Faustregeln in diesem Bereich', eintraege: g.faustregeln },
          { titel: 'Wer ist zuständig', eintraege: [g.zustaendigkeit] },
          { titel: 'Was Sie meistens brauchen', eintraege: g.typischeUnterlagen },
          { titel: 'Typische Fristen', eintraege: g.typischeFristen },
          { titel: 'Was es meistens kostet', eintraege: [g.typischeKosten] },
          { titel: 'Online-Wege', eintraege: g.onlineWege },
          { titel: 'Häufige Irrtümer', eintraege: g.haeufigeIrrtuemer },
          { titel: 'Rechtsrahmen', eintraege: g.rechtsrahmen },
        ],
        hinweis: this.disclaimerHinweis(),
      },
      optionen,
      pfad: [{ ebene: 'Bereich', label: c.name }],
      quelle: { stufe: 1, clusterId },
    };
  }

  /**
   * Vollstaendige Leistungsliste eines Bereichs als Ziffernmenue.
   * Da ein Telefonmenue nur die Ziffern 0 bis 9 kennt, wird bei mehr als acht
   * Leistungen geblaettert: Ziffer 9 fuehrt zur naechsten Seite. So bleibt
   * jede Leistung per Sprache erreichbar.
   */
  zeigeClusterAlle(clusterId, seite = 0) {
    const c = CLUSTER_BY_ID[clusterId];
    const alle = leistungenImCluster(clusterId);
    const proSeite = 8;
    const seiten = Math.max(1, Math.ceil(alle.length / proSeite));
    const aktuelleSeite = ((seite % seiten) + seiten) % seiten;
    const ausschnitt = alle.slice(aktuelleSeite * proSeite, (aktuelleSeite + 1) * proSeite);

    const optionen = ausschnitt.map((l, i) => ({
      ziffer: i + 1,
      label: l.name,
      sprechLabel: l.sprechName,
      ziel: { art: 'leistung', leistungId: l.id },
    }));
    if (seiten > 1) {
      optionen.push({
        ziffer: 9,
        label: `Weitere Leistungen (Seite ${((aktuelleSeite + 1) % seiten) + 1} von ${seiten})`,
        sprechLabel: 'weitere Leistungen',
        ziel: { art: 'clusterAlle', clusterId, seite: aktuelleSeite + 1 },
      });
    }
    optionen.push({ ziffer: 0, label: 'Zurück zum Bereich', sprechLabel: 'zurück', ziel: { art: 'cluster', clusterId } });

    const seitenhinweis = seiten > 1 ? ` Das ist Seite ${aktuelleSeite + 1} von ${seiten}; für die weiteren sagen Sie 9.` : '';

    return {
      stufe: 1,
      zustand: ZUSTAND.CLUSTER,
      sprich: `Im Bereich ${c.sprechName} kann ich zu ${alle.length} Leistungen Auskunft geben.${seitenhinweis} ${ziffernansage(optionen.slice(0, 3))} Sie können den Namen auch einfach sagen.`,
      anzeige: {
        titel: `Alle Leistungen: ${c.name}`,
        absaetze: ['Sagen Sie die Ziffer oder den Namen der Leistung.'],
        listen: [{
          titel: `Leistungen in diesem Bereich (${alle.length})`,
          eintraege: alle.map((l, i) => {
            const aufSeite = Math.floor(i / proSeite) === aktuelleSeite;
            return aufSeite ? `${(i % proSeite) + 1}. ${l.name}` : `— ${l.name} (Seite ${Math.floor(i / proSeite) + 1})`;
          }),
        }],
        hinweis: this.disclaimerHinweis(),
      },
      optionen,
      pfad: [{ ebene: 'Bereich', label: c.name }],
      quelle: { stufe: 1, clusterId },
    };
  }

  // -------------------------------------------------------------------------
  // Stufe 2: Leistung
  // -------------------------------------------------------------------------

  zeigeLeistung(leistungId, { kurz = false } = {}) {
    const l = LEISTUNG_BY_ID[leistungId];
    if (!l) return this.nichtVerstanden();
    const c = CLUSTER_BY_ID[l.cluster];
    this.clusterId = l.cluster;
    this.leistungId = leistungId;
    this.aspektId = null;

    const optionen = ASPEKT_MENUE.map((aid, i) => {
      const a = ASPEKT_BY_ID[aid];
      return {
        ziffer: i + 1,
        label: a.name,
        sprechLabel: a.sprechName,
        ziel: { art: 'aspekt', leistungId, aspektId: aid },
        gehoert: this.gehoerteAspekte.has(aid),
      };
    });
    optionen.push({ ziffer: 7, label: 'Alles am Stück', sprechLabel: 'die vollständige Auskunft', ziel: { art: 'vollauskunft', leistungId } });
    optionen.push({ ziffer: 0, label: 'Zurück zum Bereich', sprechLabel: 'zurück zum Bereich', ziel: { art: 'cluster', clusterId: l.cluster } });

    const pflichtUnterlagen = l.unterlagen.filter((u) => u.pflicht);
    const hauptgebuehr = l.gebuehren[0];

    const regionalL = this.regionalTeile(leistungId);
    const angebot = this.landAngebot(l);

    const sprichTeile = [];
    if (!kurz) {
      sprichTeile.push(`${l.sprechName}.`);
      sprichTeile.push(satzEnde(l.kurzbeschreibung));
      sprichTeile.push(`Zuständig: ${satzEnde(l.zustaendigkeit.stelle)}`);
      if (hauptgebuehr) sprichTeile.push(`${hauptgebuehr.position}: ${satzEnde(hauptgebuehr.betrag)}`);
    } else {
      sprichTeile.push(`Zurück zu ${l.sprechName}.`);
    }
    if (regionalL?.sprichSatz) sprichTeile.push(regionalL.sprichSatz);
    if (angebot) sprichTeile.push(angebot);
    sprichTeile.push(this.varianten.waehle('leistungFrage', ['Was möchten Sie wissen?', 'Womit kann ich weiterhelfen?', 'Was davon brauchen Sie?', 'Wo soll ich einsteigen?']));
    sprichTeile.push(ziffernansage(optionen.slice(0, 3)));
    sprichTeile.push('Für Fristen, Voraussetzungen oder Online-Wege sagen Sie 4, 5 oder 6.');

    return {
      stufe: 2,
      zustand: ZUSTAND.LEISTUNG,
      sprich: sprichTeile.filter(Boolean).join(' '),
      anzeige: {
        titel: l.name,
        untertitel: `${c.name} · ${l.leikaBezug}`,
        absaetze: [l.kurzbeschreibung],
        listen: [
          { titel: 'Zuständig', eintraege: [l.zustaendigkeit.stelle, l.zustaendigkeit.hinweis].filter(Boolean) },
          { titel: 'Kurzüberblick', eintraege: [
            `Pflichtunterlagen: ${pflichtUnterlagen.length}`,
            `Kosten: ${hauptgebuehr ? `${hauptgebuehr.position} ${hauptgebuehr.betrag}` : 'keine Angabe'}`,
            `Bearbeitungsdauer: ${l.bearbeitungsdauer}`,
            `Online möglich: ${l.online.moeglich ? 'ja' : 'nein'}`,
            `Prozessschritte: ${l.ablauf.length}`,
            `Rechtsebene: ${rechtsebene(l.id)?.ebene.name ?? 'unbestimmt'}${rechtsebene(l.id)?.ortsabhaengig ? ' — Details hängen vom Ort ab' : ''}`,
          ] },
          ...(regionalL ? [regionalL.liste] : []),
        ],
        hinweis: this.belastbarkeitHinweis(l),
      },
      optionen,
      pfad: [{ ebene: 'Bereich', label: c.name }, { ebene: 'Leistung', label: l.name }],
      quelle: { stufe: 2, clusterId: l.cluster, leistungId },
    };
  }

  // -------------------------------------------------------------------------
  // Stufe 3: Detailaspekt
  // -------------------------------------------------------------------------

  zeigeAspekt(leistungId, aspektId, { mitEinordnung = false } = {}) {
    const l = LEISTUNG_BY_ID[leistungId];
    const a = ASPEKT_BY_ID[aspektId];
    if (!l || !a) return this.nichtVerstanden();

    // Haengt die Antwort vom Ort ab und ist keiner bekannt, kommt zuerst die
    // gezielte Rueckfrage - das ist die Rechtsebenen-Klaerung.
    const klaerung = this.ortsklaerungNoetig(leistungId, aspektId);
    if (klaerung) {
      this.clusterId = l.cluster;
      this.leistungId = leistungId;
      return this.frageNachOrt(leistungId, aspektId, klaerung);
    }
    const c = CLUSTER_BY_ID[l.cluster];
    this.clusterId = l.cluster;
    this.leistungId = leistungId;
    this.aspektId = aspektId;
    this.gehoerteAspekte.add(aspektId);

    const inhalt = aspektInhalt(l, aspektId);
    const regionalA = this.regionalTeile(leistungId, aspektId);
    const angebotA = this.landAngebot(l);

    const naechste = ASPEKT_MENUE.filter((id) => id !== aspektId && !this.gehoerteAspekte.has(id)).slice(0, 3);
    const optionen = naechste.map((id, i) => ({
      ziffer: i + 1,
      label: ASPEKT_BY_ID[id].name,
      sprechLabel: ASPEKT_BY_ID[id].sprechName,
      ziel: { art: 'aspekt', leistungId, aspektId: id },
    }));
    optionen.push({ ziffer: 7, label: 'Alles am Stück', sprechLabel: 'die vollständige Auskunft', ziel: { art: 'vollauskunft', leistungId } });
    optionen.push({ ziffer: 8, label: 'Zurück zur Leistung', sprechLabel: 'zurück zur Leistung', ziel: { art: 'leistung', leistungId } });
    optionen.push({ ziffer: 0, label: 'Neues Anliegen', sprechLabel: 'ein neues Anliegen', ziel: { art: 'neu' } });

    const sprichTeile = [];
    if (mitEinordnung) sprichTeile.push(`Es geht um ${l.sprechName}.`);
    sprichTeile.push(inhalt.sprich);
    if (regionalA?.sprichSatz) sprichTeile.push(regionalA.sprichSatz);
    else if (this.ortsfrageAbgelehnt || this.land) {
      const ansage = ebenenAnsage(leistungId, aspektId);
      if (ansage && rechtsebene(leistungId, aspektId)?.ortsabhaengig) sprichTeile.push(ansage);
    }
    if (angebotA) sprichTeile.push(angebotA);
    if (naechste.length) {
      sprichTeile.push(this.varianten.waehle('aspektWeiter', ['Wenn Sie mehr brauchen:', 'Weiter im Thema?', 'Dazu passt noch:', 'Falls noch etwas offen ist:']));
      sprichTeile.push(ziffernansage(optionen.slice(0, naechste.length)));
    } else {
      sprichTeile.push('Sagen Sie 7 für die vollständige Auskunft oder beschreiben Sie ein neues Anliegen.');
    }

    return {
      stufe: 3,
      zustand: ZUSTAND.ASPEKT,
      sprich: sprichTeile.filter(Boolean).join(' '),
      anzeige: {
        titel: `${a.name}: ${l.name}`,
        untertitel: c.name,
        absaetze: inhalt.absaetze,
        listen: [...inhalt.listen, ...(regionalA ? [regionalA.liste] : [])],
        hinweis: this.belastbarkeitHinweis(l),
      },
      optionen,
      pfad: [
        { ebene: 'Bereich', label: c.name },
        { ebene: 'Leistung', label: l.name },
        { ebene: 'Detail', label: a.name },
      ],
      quelle: { stufe: 3, clusterId: l.cluster, leistungId, aspektId },
    };
  }

  /** Vollstaendige Auskunft zu einer Leistung - fuer den Bildschirm gedacht. */
  zeigeVollauskunft(leistungId) {
    const l = LEISTUNG_BY_ID[leistungId];
    const c = CLUSTER_BY_ID[l.cluster];
    this.clusterId = l.cluster;
    this.leistungId = leistungId;
    for (const id of ASPEKT_MENUE) this.gehoerteAspekte.add(id);

    const regionalV = this.regionalTeile(leistungId);
    const listen = [
      ...(regionalV ? [regionalV.liste] : []),
      { titel: 'Voraussetzungen', eintraege: l.voraussetzungen },
      { titel: 'Benötigte Unterlagen', eintraege: l.unterlagen.map(formatUnterlage) },
      { titel: 'Kosten', eintraege: l.gebuehren.map(formatGebuehr) },
      { titel: 'Fristen', eintraege: l.fristen },
      { titel: 'Bearbeitungsdauer', eintraege: [l.bearbeitungsdauer] },
      { titel: 'Ablauf Schritt für Schritt', eintraege: l.ablauf.map(formatSchritt) },
      { titel: 'Zuständige Stelle', eintraege: [l.zustaendigkeit.stelle, l.zustaendigkeit.hinweis].filter(Boolean) },
      { titel: 'Online-Erledigung', eintraege: [l.online.moeglich ? 'Online möglich.' : 'Nicht vollständig online möglich.', l.online.hinweis, ...(l.online.voraussetzungen ?? []).map((v) => `Voraussetzung: ${v}`)] },
      { titel: 'Häufige Fehler', eintraege: l.haeufigeFehler },
      { titel: 'Häufige Fragen', eintraege: l.faq.map((f) => `${f.frage} — ${f.antwort}`) },
      { titel: 'Rechtsgrundlagen', eintraege: l.rechtsgrundlagen },
      { titel: 'Verwandte Leistungen', eintraege: l.verwandt.map((v) => LEISTUNG_BY_ID[v]?.name ?? v) },
    ];

    const optionen = [
      { ziffer: 1, label: 'Zurück zur Leistung', sprechLabel: 'zurück zur Leistung', ziel: { art: 'leistung', leistungId } },
      { ziffer: 2, label: 'Mit einem Menschen sprechen', sprechLabel: 'einen Menschen', ziel: { art: 'mensch' } },
      { ziffer: 0, label: 'Neues Anliegen', sprechLabel: 'ein neues Anliegen', ziel: { art: 'neu' } },
    ];

    const pflicht = l.unterlagen.filter((u) => u.pflicht).map((u) => u.was);
    const sprich = [
      `Die vollständige Auskunft zu ${l.sprechName} steht jetzt auf dem Bildschirm.`,
      regionalV?.sprichSatz ?? '',
      `Das Wichtigste in Kürze: Sie brauchen ${sprichListe(pflicht, 3)}.`,
      l.gebuehren[0] ? `${l.gebuehren[0].position} kostet ${satzEnde(l.gebuehren[0].betrag)}` : '',
      `Zur Dauer: ${satzEnde(l.bearbeitungsdauer)}`,
      `Der Ablauf hat ${l.ablauf.length} Schritte.`,
    ].filter(Boolean).join(' ');

    return {
      stufe: 3,
      zustand: ZUSTAND.ASPEKT,
      sprich,
      anzeige: {
        titel: `Vollständige Auskunft: ${l.name}`,
        untertitel: `${c.name} · Stand ${l.stand} · ${l.leikaBezug}`,
        absaetze: [l.kurzbeschreibung],
        listen,
        hinweis: this.belastbarkeitHinweis(l),
      },
      optionen,
      pfad: [{ ebene: 'Bereich', label: c.name }, { ebene: 'Leistung', label: l.name }, { ebene: 'Detail', label: 'Vollauskunft' }],
      quelle: { stufe: 3, clusterId: l.cluster, leistungId, aspektId: 'alles' },
    };
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  folgeOption(option) {
    const z = option.ziel;
    switch (z.art) {
      case 'cluster': return this.zeigeCluster(z.clusterId, null, { kurz: this.zustand !== ZUSTAND.BEREICHSWAHL });
      case 'clusterAlle': return this.zeigeClusterAlle(z.clusterId, z.seite ?? 0);
      case 'leistung': return this.zeigeLeistung(z.leistungId);
      case 'aspekt': return this.zeigeAspekt(z.leistungId, z.aspektId);
      case 'vollauskunft': return this.zeigeVollauskunft(z.leistungId);
      case 'ort': {
        const offen = this.ausstehend;
        this.ausstehend = null;
        if (z.land) {
          this.landSetzen(z.land);
          if (offen) {
            const a = this.zeigeAspekt(offen.leistungId, offen.aspektId);
            return { ...a, sprich: `${LAENDER[z.land].name}, verstanden. ${a.sprich}` };
          }
          return this.landBestaetigen();
        }
        this.ortsfrageAbgelehnt = true;
        if (offen) {
          const a = this.zeigeAspekt(offen.leistungId, offen.aspektId);
          return { ...a, sprich: `Gut, dann bundesweit. ${a.sprich}` };
        }
        return this.letzteAntwort ?? this.begruessung();
      }
      case 'mensch': return this.anMenschen('Sie haben die Weiterleitung gewählt.');
      case 'neu': {
        this.clusterId = null;
        this.leistungId = null;
        this.aspektId = null;
        this.gehoerteAspekte = new Set();
        const a = this.begruessung();
        return { ...a, sprich: 'Gut. Worum geht es?' };
      }
      default: return this.nichtVerstanden();
    }
  }

  // -------------------------------------------------------------------------
  // Sonderfaelle
  // -------------------------------------------------------------------------

  zifferUnbekannt(ziffer) {
    const gueltig = this.optionen.map((o) => o.ziffer).sort((a, b) => a - b);
    return {
      ...this.letzteAntwort,
      sprich: `Die ${ziffer} steht hier nicht zur Auswahl. Möglich sind ${sprichListe(gueltig.map(String), 5)}. ${ziffernansage(this.optionen.slice(0, 3))}`,
      optionen: this.optionen,
    };
  }

  nichtVerstanden() {
    this.missverstaendnisse += 1;

    if (this.missverstaendnisse >= 3) {
      return this.anMenschen('Ich konnte Ihr Anliegen dreimal nicht zuordnen.');
    }

    // Beim zweiten Versuch die Bereiche als Ziffernmenue anbieten - das ist
    // verlaesslicher als eine weitere offene Frage.
    if (this.missverstaendnisse === 2) {
      const bereiche = ['melde-ausweis', 'kfz-verkehr', 'familie-kinder', 'arbeit-soziales', 'gewerbe-wirtschaft', 'bauen-wohnen', 'auslaender-einbuergerung', 'ordnung-bussgeld', 'umwelt-abfall-tiere'];
      const optionen = bereiche.slice(0, 9).map((id, i) => ({
        ziffer: i + 1,
        label: CLUSTER_BY_ID[id].name,
        sprechLabel: CLUSTER_BY_ID[id].sprechName,
        ziel: { art: 'cluster', clusterId: id },
      }));
      return {
        stufe: 1,
        zustand: ZUSTAND.BEREICHSWAHL,
        sprich: `Ich konnte das noch nicht zuordnen. Ich nenne Ihnen die häufigsten Bereiche. ${ziffernansage(optionen.slice(0, 3))} Weitere Bereiche stehen auf dem Bildschirm.`,
        anzeige: {
          titel: 'Wählen Sie einen Bereich',
          absaetze: ['Sagen Sie die Ziffer des Bereichs, der am ehesten passt.'],
          listen: [{ titel: 'Bereiche', eintraege: optionen.map((o) => `${o.ziffer}. ${o.label}`) }],
          hinweis: this.disclaimerHinweis(),
        },
        optionen,
        pfad: [],
        quelle: { stufe: 1, clusterIds: bereiche },
      };
    }

    return {
      stufe: 0,
      zustand: this.zustand === ZUSTAND.START ? ZUSTAND.START : this.zustand,
      sprich: 'Das habe ich nicht sicher verstanden. Sagen Sie es bitte in einem kurzen Satz - zum Beispiel: Ich bin umgezogen. Oder: Ich brauche einen neuen Ausweis.',
      anzeige: {
        titel: 'Noch einmal, bitte',
        absaetze: [
          'Ich konnte Ihr Anliegen keinem Bereich zuordnen. Kurze, konkrete Sätze funktionieren am besten.',
        ],
        listen: [{
          titel: 'Formulierungen, die gut funktionieren',
          eintraege: [
            'Ich bin umgezogen',
            'Mein Ausweis ist abgelaufen',
            'Ich habe ein Auto gekauft',
            'Ich möchte ein Gewerbe anmelden',
            'Wir haben ein Kind bekommen',
            'Ich habe einen Bußgeldbescheid bekommen',
          ],
        }],
        hinweis: this.disclaimerHinweis(),
      },
      optionen: this.optionen,
      pfad: [],
      quelle: null,
    };
  }

  anMenschen(grund) {
    const l = this.leistungId ? LEISTUNG_BY_ID[this.leistungId] : null;
    const c = this.clusterId ? CLUSTER_BY_ID[this.clusterId] : null;
    const stelle = l?.zustaendigkeit.stelle ?? c?.grundsatzwissen.zustaendigkeit ?? 'die Behördennummer 115';

    const uebergabe = [
      `Grund: ${grund}`,
      c ? `Bereich: ${c.name}` : 'Bereich: nicht bestimmt',
      l ? `Leistung: ${l.name}` : 'Leistung: nicht bestimmt',
      l ? `Empfohlene Stelle: ${l.zustaendigkeit.stelle}` : `Empfohlene Stelle: ${stelle}`,
      l?.eskalation ? `Hinweis für die Weiterleitung: ${l.eskalation}` : null,
      `Bisherige Äußerungen: ${this.verlauf.filter((v) => v.rolle === 'nutzer').map((v) => `"${v.text}"`).join(', ') || 'keine'}`,
    ].filter(Boolean);

    return {
      stufe: 2,
      zustand: ZUSTAND.MENSCH,
      sprich: `Ich verbinde Sie weiter. Zuständig: ${satzEnde(stelle)} Ich übergebe dabei, worum es bisher ging, damit Sie nichts wiederholen müssen.`,
      anzeige: {
        titel: 'Weiterleitung an eine Mitarbeiterin oder einen Mitarbeiter',
        absaetze: ['Der Bot übergibt den bisherigen Gesprächskontext. In einem echten Betrieb würde hier die Vermittlung in die Fachabteilung erfolgen.'],
        listen: [{ titel: 'Übergabeprotokoll', eintraege: uebergabe }],
        hinweis: this.disclaimerHinweis(),
      },
      optionen: [
        { ziffer: 1, label: 'Doch weiter mit dem Assistenten', sprechLabel: 'weiter mit mir', ziel: this.leistungId ? { art: 'leistung', leistungId: this.leistungId } : { art: 'neu' } },
        { ziffer: 0, label: 'Neues Anliegen', sprechLabel: 'ein neues Anliegen', ziel: { art: 'neu' } },
      ],
      pfad: [{ ebene: 'Status', label: 'Weiterleitung' }],
      quelle: { stufe: 2, clusterId: this.clusterId, leistungId: this.leistungId },
    };
  }

  hilfe() {
    return {
      stufe: 0,
      zustand: this.zustand,
      sprich: 'Ich beantworte Fragen zu Verwaltungsleistungen. Sie können Ihr Anliegen frei beschreiben, eine Ziffer sagen, mit zurück eine Ebene zurückgehen, mit neues Anliegen von vorn beginnen oder mit Mitarbeiter eine Weiterleitung verlangen.',
      anzeige: {
        titel: 'Was ich kann',
        absaetze: [
          'Ich ordne Ihr Anliegen einem von zwölf Verwaltungsbereichen zu, nenne Ihnen das allgemeine Bereichswissen und führe Sie dann per Ziffernwahl zur konkreten Leistung und zum gewünschten Detail.',
        ],
        listen: [{
          titel: 'Sprachbefehle, die immer gelten',
          eintraege: [
            '"zurück" - eine Ebene zurück',
            '"neues Anliegen" - von vorn beginnen',
            '"wiederholen" - letzte Antwort noch einmal',
            '"alles" - vollständige Auskunft zur aktuellen Leistung',
            '"Mitarbeiter" - Weiterleitung an einen Menschen',
            '"beenden" - Gespräch beenden',
          ],
        }],
        hinweis: this.disclaimerHinweis(),
      },
      optionen: this.optionen,
      pfad: [],
      quelle: null,
    };
  }

  verabschiedung() {
    return {
      stufe: 0,
      zustand: ZUSTAND.ENDE,
      sprich: 'Gerne. Wenn Sie weitere Fragen haben, erreichen Sie die Verwaltung auch unter der Behördennummer 115. Auf Wiederhören.',
      anzeige: {
        titel: 'Gespräch beendet',
        absaetze: ['Sie können jederzeit ein neues Anliegen beschreiben.'],
        listen: [],
        hinweis: DISCLAIMER,
      },
      optionen: [{ ziffer: 1, label: 'Neues Anliegen', sprechLabel: 'ein neues Anliegen', ziel: { art: 'neu' } }],
      pfad: [],
      quelle: null,
    };
  }

  // -------------------------------------------------------------------------
  // Hinweise
  // -------------------------------------------------------------------------

  disclaimerHinweis() {
    if (this.disclaimerGesagt) return null;
    this.disclaimerGesagt = true;
    return DISCLAIMER;
  }

  belastbarkeitHinweis(l) {
    if (l.belastbarkeit.quelle === 'bundesrecht') return l.belastbarkeit.hinweis;
    return `${l.belastbarkeit.hinweis} ${DISCLAIMER}`;
  }
}

// ---------------------------------------------------------------------------
// Aufbereitung der Detailaspekte
// ---------------------------------------------------------------------------

function formatUnterlage(u) {
  const kennzeichen = u.pflicht ? 'Pflicht' : 'wenn zutreffend';
  return `${u.was} (${kennzeichen})${u.hinweis ? ` — ${u.hinweis}` : ''}`;
}

function formatGebuehr(g) {
  const art = {
    bundeseinheitlich: 'bundesweit gleich',
    landesrecht: 'nach Landesrecht',
    kommunal: 'kommunal unterschiedlich',
    einkommensabhaengig: 'einkommensabhängig',
    keine: 'keine Gebühr',
    sonstige: 'nicht behördlich',
  }[g.art] ?? g.art;
  return `${g.position}: ${g.betrag} (${art})${g.hinweis ? ` — ${g.hinweis}` : ''}`;
}

function formatSchritt(s) {
  return `Schritt ${s.nr} — ${s.titel}: ${s.detail}${s.akteur ? ` [${s.akteur}]` : ''}`;
}

/** Welche Regionalfelder zu welchem Detailaspekt gehoeren. */
export const ASPEKT_REGIONALFELDER = {
  unterlagen: ['besonderheiten'],
  kosten: ['gebuehren', 'besonderheiten'],
  ablauf: ['besonderheiten', 'online'],
  voraussetzungen: ['besonderheiten'],
  fristen: ['fristen', 'besonderheiten'],
  zustaendigkeit: ['zustaendigkeit', 'besonderheiten'],
  online: ['online', 'besonderheiten'],
  rechtsgrundlagen: ['rechtsgrundlagen'],
  fehler: ['besonderheiten'],
  faq: ['besonderheiten'],
};

/**
 * Erzeugt fuer einen Aspekt sowohl den kurzen Sprechtext als auch die
 * ausfuehrliche Bildschirmdarstellung.
 */
export function aspektInhalt(l, aspektId) {
  switch (aspektId) {
    case 'unterlagen': {
      const pflicht = l.unterlagen.filter((u) => u.pflicht);
      const optional = l.unterlagen.filter((u) => !u.pflicht);
      return {
        sprich: `Sie brauchen ${pflicht.length} Unterlagen zwingend: ${sprichListe(pflicht.map((u) => u.was), 4)}.`
          + (pflicht.length > 4 ? ' Die weiteren stehen auf dem Bildschirm.' : '')
          + (optional.length ? ` Dazu kommen je nach Fall ${optional.length} weitere Nachweise.` : ''),
        absaetze: [`Für ${l.name} verlangt ${l.zustaendigkeit.stelle} die folgenden Unterlagen. Bringen Sie Originale mit, Kopien werden meist nicht akzeptiert.`],
        listen: [
          { titel: `Pflichtunterlagen (${pflicht.length})`, eintraege: pflicht.map(formatUnterlage) },
          ...(optional.length ? [{ titel: `Je nach Fall zusätzlich (${optional.length})`, eintraege: optional.map(formatUnterlage) }] : []),
        ],
      };
    }
    case 'kosten': {
      const echte = l.gebuehren.filter((g) => g.art !== 'keine');
      const kommunal = l.gebuehren.some((g) => g.art === 'kommunal');
      return {
        sprich: `${l.gebuehren[0].position}: ${satzEnde(l.gebuehren[0].betrag)}`
          + (l.gebuehren.length > 1 ? ` Es gibt ${l.gebuehren.length} Gebührenpositionen insgesamt.` : '')
          + ` Zur Dauer: ${satzEnde(l.bearbeitungsdauer)}`
          + (kommunal ? ' Die genauen Beträge legt Ihre Gemeinde fest.' : ''),
        absaetze: [`Kosten und Dauer für ${l.name}.`],
        listen: [
          { titel: 'Gebührenpositionen', eintraege: l.gebuehren.map(formatGebuehr) },
          { titel: 'Bearbeitungsdauer', eintraege: [l.bearbeitungsdauer] },
        ],
      };
    }
    case 'ablauf':
      return {
        sprich: `Der Ablauf hat ${l.ablauf.length} Schritte. Erstens: ${satzEnde(l.ablauf[0].titel)} Zweitens: ${satzEnde(l.ablauf[1].titel)} Drittens: ${satzEnde(l.ablauf[2].titel)}`
          + (l.ablauf.length > 3 ? ` Die restlichen ${l.ablauf.length - 3} Schritte stehen auf dem Bildschirm.` : ''),
        absaetze: [`So läuft ${l.name} ab.`],
        listen: [{ titel: `Ablauf in ${l.ablauf.length} Schritten`, eintraege: l.ablauf.map(formatSchritt) }],
      };
    case 'voraussetzungen':
      return {
        sprich: `Wichtigste Voraussetzung: ${satzEnde(l.voraussetzungen[0])}`
          + (l.voraussetzungen.length > 1 ? ` Insgesamt sind ${l.voraussetzungen.length} Voraussetzungen zu erfüllen; sie stehen auf dem Bildschirm.` : ''),
        absaetze: [`Diese Voraussetzungen müssen für ${l.name} erfüllt sein.`],
        listen: [{ titel: 'Voraussetzungen', eintraege: l.voraussetzungen }],
      };
    case 'fristen':
      return {
        sprich: `${satzEnde(l.fristen[0])}`
          + (l.fristen.length > 1 ? ` Es gibt ${l.fristen.length} Fristen insgesamt.` : '')
          + ` Zur Dauer: ${satzEnde(l.bearbeitungsdauer)}`,
        absaetze: [`Fristen bei ${l.name}. Fristversäumnisse sind der häufigste Grund für Ablehnungen.`],
        listen: [
          { titel: 'Fristen', eintraege: l.fristen },
          { titel: 'Bearbeitungsdauer', eintraege: [l.bearbeitungsdauer] },
        ],
      };
    case 'zustaendigkeit':
      return {
        sprich: `Zuständig: ${satzEnde(l.zustaendigkeit.stelle)} ${satzEnde(l.zustaendigkeit.hinweis ?? '')}`,
        absaetze: [l.zustaendigkeit.stelle],
        listen: [
          { titel: 'Verwaltungsebene', eintraege: [({ kommunal: 'Kommune - Stadt, Gemeinde oder Kreis', land: 'Bundesland', bund: 'Bund', sonstige: 'nicht behördlich' })[l.zustaendigkeit.ebene]] },
          ...(l.zustaendigkeit.hinweis ? [{ titel: 'Besonderheit', eintraege: [l.zustaendigkeit.hinweis] }] : []),
          { titel: 'Wann an einen Menschen weiterleiten', eintraege: [l.eskalation] },
        ],
      };
    case 'online':
      return {
        sprich: l.online.moeglich
          ? `Ja, das geht ganz oder teilweise online. ${satzEnde(l.online.hinweis)}`
          : `Nein, hier ist persönliches Erscheinen nötig. ${satzEnde(l.online.hinweis)}`,
        absaetze: [l.online.hinweis],
        listen: l.online.voraussetzungen?.length
          ? [{ titel: 'Voraussetzungen für den Online-Weg', eintraege: l.online.voraussetzungen }]
          : [],
      };
    case 'rechtsgrundlagen':
      return {
        sprich: `Wichtigste Rechtsgrundlage: ${satzEnde(l.rechtsgrundlagen[0])} Insgesamt sind ${l.rechtsgrundlagen.length} Vorschriften einschlägig.`,
        absaetze: [`Rechtsgrundlagen für ${l.name}.`],
        listen: [{ titel: 'Rechtsgrundlagen', eintraege: l.rechtsgrundlagen }],
      };
    case 'fehler':
      return {
        sprich: `Der häufigste Fehler: ${satzEnde(l.haeufigeFehler[0])} Es gibt ${l.haeufigeFehler.length} typische Stolperfallen.`,
        absaetze: [`Das geht bei ${l.name} am häufigsten schief.`],
        listen: [{ titel: 'Häufige Fehler', eintraege: l.haeufigeFehler }],
      };
    case 'faq':
      return {
        sprich: `${l.faq[0].frage} ${satzEnde(l.faq[0].antwort)} Weitere ${l.faq.length - 1} Fragen stehen auf dem Bildschirm.`,
        absaetze: [`Häufige Fragen zu ${l.name}.`],
        listen: [{ titel: 'Fragen und Antworten', eintraege: l.faq.map((f) => `${f.frage} — ${f.antwort}`) }],
      };
    default:
      return { sprich: 'Dazu habe ich keine Angaben.', absaetze: [], listen: [] };
  }
}
