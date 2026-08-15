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
const { load } = require("./corpus.js");
const APP = require("../src/appearance.js");

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
  const out = { show: 0 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--show") out.show = Number(argv[++i]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const { monsters, appearanceIndex } = load({});

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
  console.log(`\n  BM25 matches words. Where these fail it is because the player's word and the`);
  console.log(`  book's word for the same thing are different — orb against spheroid, bug against`);
  console.log(`  insectile. That is the gap the embedding half of F10 would close.`);
}

if (require.main === module) main();
module.exports = { CASES };
