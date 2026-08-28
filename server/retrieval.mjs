/**
 * Retrieval ueber das RAG-Korpus.
 *
 * BM25 mit Metadatenfiltern - die lexikalische Haelfte eines hybriden
 * Retrievals. Fuer die Wissensbasis dieses Projekts (736 kuratierte Chunks
 * mit dichten Synonymlisten) traegt BM25 allein bereits sehr weit; die
 * Embedding-Haelfte ist als zweiter Ranker vorgesehen und in
 * docs/llm-rag-architektur.md beschrieben. Wichtiger als das Ranking ist
 * hier die Filterung: ebene, land und leistung machen aus "aehnlich" ein
 * "zustaendig".
 */
import { readFile } from 'node:fs/promises';
import { tokenisieren } from '../src/nlu.js';

const K1 = 1.4;
const B = 0.75;

export class Index {
  constructor(chunks) {
    this.chunks = chunks;
    this.df = new Map();
    this.dokumente = chunks.map((c) => {
      const alleTexte = [c.text, ...(c.meta.synonyme ?? [])].join(' ');
      const tokens = tokenisieren(alleTexte);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { tf, laenge: tokens.length };
    });
    this.avgLaenge = this.dokumente.reduce((s, d) => s + d.laenge, 0) / Math.max(1, this.dokumente.length);
  }

  idf(term) {
    const n = this.chunks.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /**
   * @param {string} frage
   * @param {object} filter  { land, leistung, ebene, registerbereich, typ }
   *   land: 'nw'|'rp' - liefert landesspezifische UND landesneutrale Chunks
   */
  suche(frage, { filter = {}, topK = 5 } = {}) {
    const anfrage = tokenisieren(frage);
    const treffer = [];
    for (let i = 0; i < this.chunks.length; i += 1) {
      const c = this.chunks[i];
      if (filter.land !== undefined && c.meta.land !== null && c.meta.land !== filter.land) continue;
      if (filter.leistung && c.meta.leistung !== filter.leistung) continue;
      if (filter.ebene && c.meta.ebene !== filter.ebene) continue;
      if (filter.registerbereich && c.meta.registerbereich !== filter.registerbereich) continue;
      if (filter.typ && c.typ !== filter.typ) continue;

      const d = this.dokumente[i];
      let score = 0;
      for (const term of anfrage) {
        const tf = d.tf.get(term);
        if (!tf) continue;
        score += this.idf(term) * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (d.laenge / this.avgLaenge))));
      }
      // Landeschunks zum gesetzten Land leicht bevorzugen - sie sind die
      // spezifischere Quelle fuer dieselbe Frage.
      if (filter.land && c.meta.land === filter.land) score *= 1.35;
      if (score > 0) treffer.push({ chunk: c, score });
    }
    treffer.sort((a, b) => b.score - a.score);
    return treffer.slice(0, topK);
  }
}

let indexPromise = null;

/** Laedt das Korpus einmalig aus dist/chunks.jsonl. */
export function ladeIndex(pfad = new URL('../dist/chunks.jsonl', import.meta.url)) {
  indexPromise ??= readFile(pfad, 'utf8')
    .then((inhalt) => new Index(inhalt.trim().split('\n').map((z) => JSON.parse(z))))
    .catch((fehler) => {
      indexPromise = null;
      throw new Error(`RAG-Korpus fehlt (${fehler.message}). Erst "node scripts/build-chunks.mjs" ausführen.`);
    });
  return indexPromise;
}
