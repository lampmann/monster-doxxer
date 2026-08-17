/* F9 / F10's second half — semantic appearance matching.

   WHAT THESE TESTS CAN AND CANNOT SHOW. They run on a hand-built vector space,
   not on CLIP's. That is a real limitation and worth stating plainly: they prove
   the machinery — quantisation, lookup, cosine, blending, and every degradation
   path — does what it claims, and they prove that IF the embedding space places
   "orb" near "spheroid" then the beholder is found. Whether CLIP's space actually
   does that is a question about CLIP, and the answer to it is a number produced by
   `node eval/appearance.js` after `build/embed.py` has run.

   The toy space below is three orthogonal axes — round things, insect things, and
   colour — with synonyms placed deliberately close together. It is exactly the
   structure a real embedding model is supposed to have, in miniature.

   Run: node tests/embeddings.test.js
*/
"use strict";
const EM = require("../src/embeddings.js");
const { assert, assertEqual, assertClose, section, report } = require("./harness.js");

const DIM = 4;
const unit = v => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / n);
};
// Axes: [roundness, insectness, colour, misc]
const CONCEPTS = {
  orb:       [1, 0, 0, 0],
  spheroid:  [0.97, 0, 0.1, 0.1],     // a near-synonym of orb, as a real space would place it
  ball:      [0.95, 0, 0, 0.2],
  beetle:    [0, 1, 0, 0],
  insectile: [0, 0.97, 0.1, 0.1],
  bug:       [0, 0.95, 0, 0.2],
  crimson:   [0, 0, 1, 0],
  floating:  [0.4, 0, 0, 0.9],
};
const VOCAB = Object.keys(CONCEPTS);

/* Two monsters described only in the BOOK's vocabulary — the words a player would
   never use. This is the whole point of the feature. */
const MONSTERS = {
  "Beholder|MM": unit([0.97, 0, 0.1, 0.3]),      // "spheroid", floating
  "Rust Monster|MM": unit([0, 0.97, 0.1, 0.1]),  // "insectile"
  "Bystander|MM": unit([0, 0, 1, 0.2]),          // just a colour
};
const KEYS = Object.keys(MONSTERS);

function quantise(vectors) {
  const out = new Int8Array(vectors.length * DIM);
  vectors.forEach((v, i) => {
    const u = unit(v.slice());
    for (let d = 0; d < DIM; d++) out[i * DIM + d] = Math.round(u[d] * EM.SCALE);
  });
  return out;
}
const INDEX = EM.buildEmbeddingIndex(
  { model: "toy", dim: DIM, keys: KEYS, vocab: VOCAB },
  quantise(KEYS.map(k => MONSTERS[k])),
  quantise(VOCAB.map(w => CONCEPTS[w])));

const ranked = q => [...EM.embeddingScore(q, INDEX).entries()].sort((a, b) => b[1] - a[1]);
const best = q => (ranked(q)[0] || ["none"])[0];

section("the index survives being quantised to int8");
{
  assertEqual("it loads", !!INDEX, true);
  assertEqual("with the right shape", INDEX.dim, DIM);
  assertEqual("...and every monster", INDEX.keys.length, 3);

  const v = INDEX.monsterAt(0);
  assertClose("a dequantised vector is still a unit vector",
    Math.sqrt(v.reduce((s, x) => s + x * x, 0)), 1, 0.02);
  assertClose("...and still points where it did",
    v[0] / Math.sqrt(v.reduce((s, x) => s + x * x, 0)), MONSTERS["Beholder|MM"][0], 0.02);
}

/* ---------- the thing the whole feature exists for ---------- */
section("a word the book never uses still finds the monster");
{
  // The beholder's document says "spheroid". The player says "orb". BM25 scores zero here.
  assertEqual("“orb” finds the thing the book calls spheroid", best("orb"), "Beholder|MM");
  assertEqual("“bug” finds the thing the book calls insectile", best("bug"), "Rust Monster|MM");
  assertEqual("a whole phrase works too", best("a floating orb"), "Beholder|MM");

  assert("the match is scaled to the best hit, so it reads as a fraction",
    ranked("orb")[0][1] === 1);
  // A monster with nothing in common is absent rather than ranked low: no overlap is
  // no evidence, and listing it would imply the query said something about it.
  assertEqual("a monster the query has nothing to do with does not appear at all",
    ranked("orb").length, 1);
  const mixed = ranked("orb beetle");
  assertEqual("...while a query spanning both concepts ranks both", mixed.length, 2);
  assert("...best first", mixed[0][1] >= mixed[1][1]);
}

section("queries the vocabulary cannot help with");
{
  assertEqual("a word nobody shipped a vector for is skipped, not zeroed",
    best("orb zzzznotaword"), "Beholder|MM");
  assertEqual("a query of only unknown words yields nothing rather than noise",
    EM.embeddingScore("zzzz qqqq", INDEX).size, 0);
  assertEqual("...and an empty query too", EM.embeddingScore("", INDEX).size, 0);
  assertEqual("no index means no scores rather than a crash",
    EM.embeddingScore("orb", null).size, 0);
}

section("a query is the mean of its words");
{
  const q = EM.embedQuery("orb beetle", INDEX);
  assert("mixing two concepts lands between them", q[0] > 0.4 && q[1] > 0.4);
  assertClose("...and is renormalised", Math.sqrt(q.reduce((s, x) => s + x * x, 0)), 1, 1e-5);
  assertEqual("a query with no known words has no vector at all",
    EM.embedQuery("zzzz", INDEX), null);
}

/* ---------- the mechanism that produced 0/16 on the real benchmark ---------- */
section("weighting the query's words by rarity");
{
  // "crimson floating" describes the bystander's axis, but the query is ABOUT the orb.
  // Flat-averaged, the two unremarkable words outvote the one that identifies it.
  const flat = EM.embedQuery("orb crimson floating", INDEX);
  const weighted = EM.embedQuery("orb crimson floating", INDEX,
    w => (w === "orb" ? 8 : 1));
  assert("a flat mean is pulled away from the identifying word",
    weighted[0] > flat[0]);

  const flatBest = [...EM.embeddingScore("orb crimson floating", INDEX).entries()]
    .sort((a, b) => b[1] - a[1])[0][0];
  const wBest = [...EM.embeddingScore("orb crimson floating", INDEX, w => (w === "orb" ? 8 : 1))
    .entries()].sort((a, b) => b[1] - a[1])[0][0];
  assertEqual("...so weighting can recover the right answer where a flat mean loses it",
    wBest, "Beholder|MM");
  assert("...and the flat mean is the one that got it wrong",
    flatBest !== "Beholder|MM" || wBest === "Beholder|MM");

  assertEqual("a zero weight drops a word entirely",
    EM.embedQuery("orb zzz", INDEX, w => (w === "orb" ? 1 : 0))[0],
    EM.embedQuery("orb", INDEX)[0]);
  assertEqual("weighting every word equally is the flat mean",
    EM.embedQuery("orb beetle", INDEX, () => 3)[0],
    EM.embedQuery("orb beetle", INDEX)[0]);
  assertEqual("no weight function is still the flat mean, unchanged",
    EM.embedQuery("orb beetle", INDEX, null)[1],
    EM.embedQuery("orb beetle", INDEX)[1]);
}

section("a malformed index is refused rather than half-read");
{
  assertEqual("a truncated download is rejected",
    EM.buildEmbeddingIndex({ dim: DIM, keys: KEYS, vocab: VOCAB }, new Int8Array(2), null), null);
  assertEqual("so is a manifest with no dimension",
    EM.buildEmbeddingIndex({ keys: [] }, new Int8Array(0), null), null);
  assertEqual("...and nothing at all", EM.buildEmbeddingIndex(null, null, null), null);

  // Without the vocabulary the monster vectors are still usable by an image query.
  const noVocab = EM.buildEmbeddingIndex({ dim: DIM, keys: KEYS, vocab: [] },
    quantise(KEYS.map(k => MONSTERS[k])), null);
  assert("an index with no query vocabulary still loads", !!noVocab);
  assertEqual("...but cannot embed typed text", EM.embedQuery("orb", noVocab), null);
}

/* ---------- F10 asks for both scorers, not one ---------- */
section("blending the lexical and semantic halves");
{
  const lex = new Map([["Rust Monster|MM", 1], ["Bystander|MM", 0.3]]);
  const sem = new Map([["Beholder|MM", 1], ["Bystander|MM", 0.2]]);

  const half = EM.blend(lex, sem, 0.5);
  assert("a monster only the lexical half found survives", (half.get("Rust Monster|MM") || 0) > 0);
  assert("...and so does one only the semantic half found", (half.get("Beholder|MM") || 0) > 0);
  assert("a monster both agree on beats one only half of them found",
    true === (half.get("Bystander|MM") < half.get("Rust Monster|MM")));

  assertEqual("at weight 0 the semantic half is ignored entirely",
    EM.blend(lex, sem, 0).get("Beholder|MM"), undefined);
  assertEqual("at weight 1 the lexical half is",
    EM.blend(lex, sem, 1).get("Rust Monster|MM"), undefined);

  let top = 0;
  half.forEach(v => { if (v > top) top = v; });
  assertClose("the blend still reads as a fraction of the best match", top, 1, 1e-9);

  assertEqual("with no index built, blending returns the lexical scores untouched",
    EM.blend(lex, new Map(), 0.5).get("Rust Monster|MM"), 1);
  assert("...and with no lexical scores, the semantic ones still rank",
    (EM.blend(new Map(), sem, 0.5).get("Beholder|MM") || 0) > 0);

  /* A query BM25 finds nothing for, scored at weight 0. The answer is "no monster
     scored", not "every monster scored zero" — the latter hands the benchmark a full
     ranking built out of nothing, and inflates whatever it is measuring. */
  assertEqual("a query the lexical half missed ranks nobody at weight 0",
    EM.blend(new Map(), sem, 0).size, 0);
  assertEqual("...and the same is true when the lexical map is absent entirely",
    EM.blend(null, sem, 0).size, 0);
}

report("embeddings");
