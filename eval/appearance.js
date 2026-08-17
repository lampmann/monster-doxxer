/* ============================================================
   F10 — the paraphrase benchmark.

     node eval/appearance.js            run it
     node eval/appearance.js --show 5   print each case's top hits

   WHY THIS EXISTS SEPARATELY FROM eval/run.js.

   The main harness paraphrases a monster by sampling visual words out of its own
   fluff. That is a fair test of one thing — can BM25 find the monster when the
   player happens to use the book's vocabulary — and it says yes, worth about ten
   points of top-5 recall.

   It cannot test the other thing, and the other thing is the harder half. A real
   player says "a floating orb covered in eyestalks". The Monster Manual says the
   beholder's body is SPHEROID and never uses the word orb. No sampling procedure
   can generate that query from that document, because the words are not in it —
   producing genuine paraphrase needs a paraphraser.

   So the queries below are written by hand, in the words somebody would actually
   use, with the answer known. Small, biased by whoever wrote it, and not a
   substitute for the harness — but it is the only measurement that exercises the
   vocabulary gap at all, and that gap is precisely the case the embedding half of
   F10 exists to close. If embeddings ever get built, this is the number that has
   to move.
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const { load } = require("./corpus.js");
const APP = require("../src/appearance.js");
const EM = require("../src/embeddings.js");

/* Written as a player would say it, not as the book does. Each is a creature
   distinctive enough that a person who saw one could describe it, and iconic enough
   that being unable to find it is a real failure rather than a curiosity. */
const CASES = [
  ["a floating orb covered in eyestalks", "Beholder"],
  ["big hairy ape thing with white fur", "Yeti"],
  ["a transparent cube of jelly with bones floating in it", "Gelatinous Cube"],
  ["a treasure chest that turned out to have teeth", "Mimic"],
  ["armoured burrowing thing like a land shark", "Bulette"],
  ["a bug with antennae that ate my sword", "Rust Monster"],
  ["a lion with wings and a tail that shoots spikes", "Manticore"],
  ["a bear with the head and feathers of an owl", "Owlbear"],
  ["a floating jellyfish thing with dangling tentacles", "Flumph"],
  ["a suit of empty armour that moved on its own", "Helmed Horror"],
  ["a shambling pile of rotting vegetation", "Shambling Mound"],
  ["a horse with a single horn on its forehead", "Unicorn"],
  ["a snake woman with a bow", "Yuan-ti Malison"],
  ["a giant floating brain with legs", "Intellect Devourer"],
  ["a dog with two heads", "Death Dog"],
  ["a stone statue that came alive and attacked", "Stone Golem"],
];

function parseArgs(argv) {
  const out = { show: 0, sweep: false, weight: 0.5, dump: false, dumpFile: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--show") out.show = Number(argv[++i]);
    else if (argv[i] === "--sweep") out.sweep = true;
    else if (argv[i] === "--weight") out.weight = Number(argv[++i]);
    else if (argv[i] === "--dump-queries") {
      out.dump = true;
      // Optional filename. `node eval/appearance.js --dump-queries > queries.txt` works
      // on a POSIX shell, but PowerShell's `>` writes UTF-16LE by default — Python's
      // open(encoding="utf8") then rejects the BOM outright. Writing the file directly,
      // in UTF-8, with no shell redirection involved, sidesteps that on every platform.
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) out.dumpFile = argv[++i];
    }
  }
  return out;
}

/* Properly-encoded query sentences, if `build/embed.py --queries` has been run.

   THE POINT OF THESE. The browser has no text encoder, so a typed query is approximated
   as the MEAN of its words' shipped vectors — word order and composition thrown away.
   That approximation was chosen to keep the page dependency-free, and it was never
   measured. These vectors are the same sentences encoded properly, by the model, which
   makes the comparison possible: if the true sentences rank well and the means do not,
   the fault is the shortcut and not CLIP. If both fail, it is not the shortcut. */
function loadTrueQueries(dim) {
  const dir = path.join(__dirname, "..", "index");
  const manifest = path.join(dir, "appearance-queries.json");
  if (!fs.existsSync(manifest)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const buf = fs.readFileSync(path.join(dir, "appearance-queries.i8"));
    const bytes = new Int8Array(buf.buffer, buf.byteOffset, buf.length);
    if (meta.dim !== dim || bytes.length < meta.queries.length * dim) return null;
    const out = new Map();
    meta.queries.forEach((q, i) => out.set(q, EM.dequantise(bytes, i * dim, dim)));
    return out;
  } catch (e) {
    process.stderr.write("index/appearance-queries is unreadable: " + e.message + "\n");
    return null;
  }
}

/* Where the true answer landed, for one scorer. */
function rankOf(scores, want) {
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const i = sorted.findIndex(([key]) => key.split("|")[0].toLowerCase() === want.toLowerCase());
  return { rank: i < 0 ? Infinity : i + 1, top: sorted };
}
const summarise = ranks => ({
  top1: ranks.filter(r => r <= 1).length,
  top5: ranks.filter(r => r <= 5).length,
  top20: ranks.filter(r => r <= 20).length,
  lost: ranks.filter(r => r === Infinity).length,
});

function main() {
  const args = parseArgs(process.argv);
  if (args.dump) {                        // feed these to build/embed.py --queries
    const text = CASES.map(([query]) => query).join("\n") + "\n";
    if (args.dumpFile) {
      fs.writeFileSync(args.dumpFile, text, "utf8");
      console.log(`wrote ${CASES.length} queries to ${args.dumpFile}`);
    } else {
      process.stdout.write(text);
    }
    return;
  }
  const { monsters, appearanceIndex, embeddings } = load({});

  /* THE COMPARISON THIS FILE EXISTS FOR. Lexical alone is what shipped before CLIP;
     semantic alone is what CLIP contributes; the blend is what F10 actually asks for.
     Reporting all three keeps the embedding half honest — if it does not beat BM25 on
     the queries BM25 was failing, it has not earned its build step. */
  if (embeddings) {
    const weights = args.sweep ? [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1] : [args.weight];
    console.log(`\nindex: ${embeddings.model}, ${embeddings.dim} dims, ` +
      `${embeddings.keys.length} monsters, ${embeddings.vocabCount} vocabulary words` +
      (embeddings.withImages ? ", artwork mixed in" : ", text only") + "\n");

    const sweep = (label, queryFor) => {
      console.log(`  ${label}`);
      console.log("  blend weight   top-1   top-5   top-20   never found");
      weights.forEach(w => {
        const ranks = CASES.map(([query, want]) => {
          const lex = APP.appearanceScore(query, appearanceIndex);
          const sem = EM.embeddingScore(queryFor(query), embeddings);
          return rankOf(EM.blend(lex, sem, w), want).rank;
        });
        const r = summarise(ranks);
        const name = w === 0 ? "lexical only" : w === 1 ? "semantic only" : String(w);
        console.log(`  ${name.padEnd(13)}  ${String(r.top1).padStart(4)}/${CASES.length}` +
          `${String(r.top5).padStart(6)}/${CASES.length}${String(r.top20).padStart(7)}/${CASES.length}` +
          `${String(r.lost).padStart(12)}`);
      });
      console.log("");
    };

    sweep("query = flat mean of its words' vectors (what the page does)",
      q => APP.withoutSize(q));

    /* Same vectors, same index — the words are just no longer given equal say. If a flat
       mean is drifting to the vocabulary centroid, this is the cheap fix, and it needs no
       re-encoding to test. */
    /* A word the corpus never uses has df 0, which this IDF formula scores as MAXIMALLY
       rare — the same 9.11 it gives "eyestalks". For the lexical half that never matters,
       since a term with no postings scores nothing anyway. Here it would hand total
       control of the query vector to whichever plain-English word happens to be missing
       from the books. Treat unseen as neutral instead.

       Not obviously the right call: a word absent from the books can still carry real
       semantic weight, and refusing to privilege it is arguably backwards for an
       embedding. It is the defensible middle, and the point is to find out whether rarity
       weighting helps at all before tuning how. */
    const idfWeight = w => (appearanceIndex.df[w] ? Math.max(0, appearanceIndex.idf(w)) : 1);
    sweep("query = IDF-weighted mean, unseen words neutral",
      q => EM.embedQuery(APP.withoutSize(q), embeddings, idfWeight));

    /* The guard above has a visible cost: "eyestalks" appears in no description document,
       so df is 0, so it is weighted 1 — while "covered" gets 4.25. The single word that
       identifies a beholder is worth less than a filler word, in the query that feature
       exists to serve.
       Without the guard, df 0 scores MAXIMALLY rare instead, which is the right instinct
       for an embedding — a word the books never use is exactly what the semantic half is
       for — and the wrong one for a stopword that slipped through. Both are one line, so
       measure rather than argue. */
    const idfRaw = w => Math.max(0, appearanceIndex.idf(w));
    sweep("query = IDF-weighted mean, unseen words treated as rarest",
      q => EM.embedQuery(APP.withoutSize(q), embeddings, idfRaw));

    /* The controlled comparison. Same monsters, same blend, same everything — the only
       thing that changes is how the query got its vector. */
    const truth = loadTrueQueries(embeddings.dim);
    if (truth) {
      const missing = CASES.filter(([q]) => !truth.has(q)).length;
      if (missing) console.log(`  (${missing} of ${CASES.length} queries were not encoded)\n`);
      sweep("query = the sentence encoded properly by the model",
        q => truth.get(q) || APP.withoutSize(q));
    } else {
      console.log("  For the controlled comparison, encode the queries themselves:\n" +
        "    node eval/appearance.js --dump-queries > queries.txt\n" +
        "    python3 build/embed.py --queries queries.txt   (add --images if you have them)\n" +
        "  This table then gains a second half, and the mean-of-words shortcut stops being\n" +
        "  an assumption.\n");
    }
  }

  const ranks = [];
  console.log(`\n${CASES.length} hand-written paraphrase queries\n`);

  CASES.forEach(([query, want]) => {
    const scored = [...APP.appearanceScore(query, appearanceIndex).entries()]
      .sort((a, b) => b[1] - a[1]);
    const i = scored.findIndex(([key]) => key.split("|")[0].toLowerCase() === want.toLowerCase());
    const rank = i < 0 ? Infinity : i + 1;
    ranks.push(rank);

    const mark = rank <= 5 ? "  ok " : rank <= 20 ? "  ~  " : "  X  ";
    console.log(`${mark}${String(rank === Infinity ? "—" : rank).padStart(4)}  ${want.padEnd(20)} “${query}”`);

    const size = APP.extractSize(query);
    if (size) console.log(`            F11 read the size as ${size.size} (${size.via})`);

    if (args.show) {
      console.log("            top: " + scored.slice(0, args.show)
        .map(([k, v]) => `${k.split("|")[0]} ${v.toFixed(2)}`).join(", "));
    }
  });

  const within = k => ranks.filter(r => r <= k).length;
  const finite = ranks.filter(r => r < Infinity).sort((a, b) => a - b);
  console.log(`\n  top-1 ${within(1)}/${CASES.length}   top-5 ${within(5)}/${CASES.length}` +
    `   top-20 ${within(20)}/${CASES.length}   never found ${ranks.filter(r => r === Infinity).length}`);
  console.log(`  median rank ${finite.length ? finite[Math.floor(finite.length / 2)] : "—"}`);
  if (!embeddings) {
    console.log(`\n  BM25 matches words. Where these fail it is because the player's word and the`);
    console.log(`  book's word for the same thing are different — orb against spheroid, bug against`);
    console.log(`  insectile. That is the gap the embedding half of F10 closes — run`);
    console.log(`  build/embed.py to build the index, then this table gains three more rows.`);
  }
}

if (require.main === module) main();
module.exports = { CASES };
