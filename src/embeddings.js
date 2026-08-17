/* ============================================================
   F9 / F10's second half — semantic appearance matching.

   BM25 matches words. A player says a beholder is "a floating orb covered in
   eyestalks"; the Monster Manual says its body is "spheroid" and never once says
   orb. Lexical matching cannot cross that gap, and `eval/appearance.js` measures
   exactly how often it fails to: 8 of 16 hand-written descriptions land in the
   top five.

   CLIP closes it from both sides at once, which is why it is worth a build step
   where a text-only model would not be:

     TEXT   the description document, embedded. "Orb" and "spheroid" land near
            each other whether or not they ever co-occur.
     IMAGE  the monster's official ARTWORK, embedded into the SAME space. This is
            the part that matters most and the part a text model cannot do: a
            player describes what the thing looked like, and the artwork is what
            it looked like. The books' prose is often about ecology and attitude
            rather than shape, so the picture is frequently the better document.

   And because image and text share the space, the same index answers a VTT token
   screenshot — see DESIGN.md on why the perceptual-hash version of that failed.

   WHAT RUNS WHERE. Embedding is a build step (build/embed.py); this file only
   consumes its output. That split is the architecture the handoff specifies, and
   it is what keeps the tool a static page with no server and no install.

   THE QUERY-SIDE PROBLEM, and the compromise. Ranking a query needs the query
   embedded, and the query only exists at runtime — which naively means shipping
   the text encoder to the browser. Instead the build step also emits vectors for
   a VOCABULARY, and a query is the mean of its words' vectors. That is an
   approximation of encoding the sentence, not the same thing: it loses word order
   and composition. It is chosen because it keeps the page dependency-free, and
   `build/embed.py --queries` exists so the approximation can be measured against
   properly-encoded sentences rather than assumed to be fine.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Vectors ship as int8. Every vector is L2-normalised before quantising, so all
     components live in [-1,1] and one global scale of 127 does the job — no per-vector
     scale to store, and a dot product of the raw int8s is proportional to cosine.
     At 512 dimensions that is 512 bytes per monster: about 2.3 MB for the corpus,
     against 9 MB as float32. */
  const SCALE = 127;

  function dequantise(int8, offset, dim) {
    const v = new Float32Array(dim);
    for (let i = 0; i < dim; i++) v[i] = int8[offset + i] / SCALE;
    return v;
  }

  function normalise(v) {
    let n = 0;
    for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n);
    if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
  }

  /* manifest: { model, dim, keys: [...], vocab: [...] }
     monsterBytes / vocabBytes: Int8Array, row-major, `dim` values per entry. */
  function buildEmbeddingIndex(manifest, monsterBytes, vocabBytes) {
    if (!manifest || !manifest.dim || !monsterBytes) return null;
    const dim = manifest.dim;
    const keys = manifest.keys || [];
    if (monsterBytes.length < keys.length * dim) return null;      // truncated download

    const vocab = Object.create(null);
    (manifest.vocab || []).forEach((w, i) => { vocab[w] = i; });

    return {
      model: manifest.model || "unknown",
      dim, keys, vocab,
      withImages: !!manifest.withImages,
      centred: !!manifest.centred,
      vocabCount: (manifest.vocab || []).length,
      monsterBytes, vocabBytes: vocabBytes || null,
      monsterAt(i) { return dequantise(monsterBytes, i * dim, dim); },
      vocabAt(i) { return dequantise(vocabBytes, i * dim, dim); },
    };
  }

  /* The mean of the query's known words, renormalised. Unknown words are skipped
     rather than treated as zero — a zero vector would drag the mean toward nothing
     and quietly weaken every other word in the sentence. */
  function embedQuery(text, index, weightOf) {
    if (!index || !index.vocabBytes || !index.vocabCount) return null;
    const words = String(text || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/);
    const acc = new Float32Array(index.dim);
    let used = 0;
    words.forEach(w => {
      const at = index.vocab[w];
      if (at == null) return;
      /* WHY WEIGHTS. A flat mean gives "covered" and "eyestalks" an equal say, and since
         most words in a sentence are unremarkable the mean drifts toward the centroid of
         the whole vocabulary — which is in the same place for every query. That is a
         mechanism that would produce exactly what the benchmark measured: semantic-only
         retrieval at 0/16, indistinguishable from ranking at random, while the very same
         index queried with a properly encoded sentence reaches 7/16.

         Weighting by rarity is the same correction BM25 already applies on the lexical
         side (F12): let the word that identifies the monster dominate the words that
         merely hold the sentence together. Costs nothing at runtime and needs no
         re-encoding, which is why it is worth trying before anything more drastic. */
      const w8 = weightOf ? weightOf(w) : 1;
      if (!(w8 > 0)) return;
      const v = index.vocabAt(at);
      for (let i = 0; i < index.dim; i++) acc[i] += v[i] * w8;
      used++;
    });
    if (!used) return null;
    return normalise(acc);
  }

  /* Cosine of every monster against the query. Returns a Map of key -> [0,1], scaled
     by the best hit so it reads as a fraction, exactly like the BM25 scorer it blends
     with. Negative cosines are clamped away: "the opposite of this description" is not
     evidence against a monster, it is just no evidence (F3, tier 3). */
  function embeddingScore(query, index, weightOf) {
    const out = new Map();
    const q = typeof query === "string" ? embedQuery(query, index, weightOf) : query;
    if (!q || !index) return out;

    const { dim, keys, monsterBytes } = index;
    let best = 0;
    for (let k = 0; k < keys.length; k++) {
      let dot = 0;
      const off = k * dim;
      for (let i = 0; i < dim; i++) dot += q[i] * monsterBytes[off + i];
      dot /= SCALE;                                 // int8 back to the unit sphere
      if (dot > 0) {
        out.set(keys[k], dot);
        if (dot > best) best = dot;
      }
    }
    if (best > 0) out.forEach((v, k) => out.set(k, v / best));
    return out;
  }

  /* F10 asks for the two scorers to be BLENDED, not for one to replace the other, and
     the reason is visible in the benchmark: BM25 is excellent on distinctive nouns it
     happens to share with the book ("carapace", "tentacles") and helpless on paraphrase;
     embeddings are the reverse. Keeping both means a query that hits either way wins.

     `weight` is the embedding's share. Not guessed at a default here — `eval/appearance.js`
     sweeps it once an index exists, which is the only honest way to set it. */
  function blend(lexical, semantic, weight) {
    const w = Math.max(0, Math.min(1, weight == null ? 0.5 : weight));
    if (!semantic || !semantic.size) return lexical || new Map();
    if (!lexical || !lexical.size) {
      // Positives only, same as every other path. At weight 0 this branch used to emit a
      // map of zeroes, which ranks every monster in the corpus for a query BM25 found
      // nothing for — it made "lexical only" look like it had found things it hadn't.
      const only = new Map();
      semantic.forEach((v, k) => { const x = v * w; if (x > 0) only.set(k, x); });
      return only;
    }
    const out = new Map();
    lexical.forEach((v, k) => { const x = v * (1 - w); if (x > 0) out.set(k, x); });
    semantic.forEach((v, k) => {
      const x = (out.get(k) || 0) + v * w;
      // Only positives, matching every other scorer: an entry of exactly zero says
      // "this monster scored", and it didn't.
      if (x > 0) out.set(k, x); else out.delete(k);
    });
    // Rescale so the blend still reads as a fraction of the best available match.
    let best = 0;
    out.forEach(v => { if (v > best) best = v; });
    if (best > 0) out.forEach((v, k) => out.set(k, v / best));
    return out;
  }

  return { SCALE, normalise, dequantise, buildEmbeddingIndex, embedQuery, embeddingScore, blend };
});
