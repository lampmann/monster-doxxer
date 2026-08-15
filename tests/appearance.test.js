/* F10, F11, F12 — appearance.

   Tested on synthetic monsters with hand-written "fluff", the same way the rest of
   the suite works: no sourcebook prose in this repository. Whether the BM25 index
   finds a beholder from a real player's description is a question about WotC's text
   and lives in `node eval/appearance.js` against the user's own data/.

   The property that matters most is the one F3 demands: appearance can only ever
   ADD. A player who describes a purple owlbear must not push the owlbear down the
   list, because reflavouring is exactly the case where the description is wrong and
   the monster is right.

   Run: node tests/appearance.test.js
*/
"use strict";
const A = require("../src/appearance.js");
const S = require("../src/score.js");
const { assert, assertEqual, assertClose, section, report } = require("./harness.js");

function mon(name, over) {
  return Object.assign({
    name, source: "T", key: name + "|T",
    type: "monstrosity", typeAlt: [], typeTags: [], size: ["large"], speeds: { walk: 30 },
    senseTags: [], conditionImmune: [], traitTags: [], actionTags: [], damageTags: [],
    resist: [], immune: [], vulnerable: [], symptoms: [], partial: false,
    traits: [], actions: [],
  }, over);
}
const fluff = (name, text) => ({ name, source: "T", entries: [text] });

const LONG = " It is a creature of the wild places and is much feared by those who dwell there.";
const CORPUS = [
  mon("Snowbeast"), mon("Shellcrab"), mon("Glowworm"), mon("Plainbeast"),
];
const FLUFF = A.fluffMap([[
  fluff("Snowbeast", "A hulking white-furred ape with shaggy hair and cold black eyes." + LONG),
  fluff("Shellcrab", "An armoured crab with a thick carapace, heavy pincers and stalked eyes." + LONG),
  fluff("Glowworm", "A luminous segmented worm whose pale hide glows in the dark." + LONG),
]]);
const INDEX = A.buildAppearanceIndex(CORPUS, FLUFF);
const rank = q => [...A.appearanceScore(q, INDEX).entries()].sort((a, b) => b[1] - a[1]);
const best = q => (rank(q)[0] || ["none"])[0].split("|")[0];

/* ---------- F10 ---------- */
section("F10 — distinctive nouns find the monster");
{
  assertEqual("a carapace and pincers find the crab", best("armoured thing with a carapace and pincers"), "Shellcrab");
  assertEqual("shaggy fur finds the ape", best("big shaggy ape covered in fur"), "Snowbeast");
  assertEqual("a glowing segmented body finds the worm", best("a glowing segmented worm"), "Glowworm");

  assert("scores are scaled to the best hit, so they read as a fraction", rank("carapace")[0][1] === 1);
  assert("a monster the words don't describe scores nothing at all",
    !A.appearanceScore("carapace pincers", INDEX).has("Snowbeast|T"));
  assertEqual("an empty description matches nothing rather than everything",
    A.appearanceScore("", INDEX).size, 0);
  assertEqual("...and so does one made only of stop words", A.appearanceScore("it was the a of", INDEX).size, 0);

  // Every monster gets a document, with or without prose — name, size, type, trait names.
  assert("a monster with no fluff at all is still indexed", INDEX.docs.some(d => d.key === "Plainbeast|T"));
  assertEqual("...and the index reports how many actually had prose", INDEX.withProse, 3);
}

section("F10 — trait and action names are part of the description");
{
  const withTrait = [mon("Webspinner", { traits: [{ name: "Web Sense", text: "" }], actions: [{ name: "Web", text: "" }] })];
  const idx = A.buildAppearanceIndex(withTrait, {});
  assert("a player who saw it shoot webs can find it by that, with no fluff involved",
    A.appearanceScore("it shot webs at us", idx).has("Webspinner|T"));
}

/* ---------- F11 ---------- */
section("F11 — size out of prose");
{
  assertEqual("an explicit size word is read", A.extractSize("a huge slimy thing").size, "huge");
  assertEqual("a comparison is read", A.extractSize("about horse-sized").size, "large");
  assertEqual("...however it is phrased", A.extractSize("it was the size of a cat").size, "tiny");
  assertEqual("...including 'as big as'", A.extractSize("as big as an elephant").size, "huge");
  assertEqual("a height in numerals is read", A.extractSize("roughly 15 feet tall").size, "huge");
  assertEqual("...and in words", A.extractSize("about ten feet tall").size, "large");
  assertEqual("a descriptor is read when nothing better is there", A.extractSize("a towering figure").size, "huge");
  assertEqual("a description with no size in it yields nothing, rather than guessing",
    A.extractSize("green and angry"), null);
  assertEqual("...and neither does an empty one", A.extractSize(""), null);

  assert("it says WHY, because it inferred a tier 1 fact on the user's behalf",
    /horse/.test(A.extractSize("about horse-sized").via));

  /* The bug the handoff warns about by saying "parse size out BEFORE you score it":
     leave the phrase in and BM25 matches actual horses. */
  assertEqual("the size phrase is removed from what gets matched",
    A.withoutSize("a big hairy ape, about horse-sized").includes("horse"), false);
  assert("...while the rest of the description survives intact",
    /hairy/.test(A.withoutSize("a big hairy ape, about horse-sized")));
  assertEqual("text with no size in it is passed through untouched",
    A.withoutSize("green and angry"), "green and angry");

  const horses = [mon("Draft Horse"), mon("Snowbeast")];
  const hidx = A.buildAppearanceIndex(horses, A.fluffMap([[
    fluff("Draft Horse", "A sturdy horse bred to pull carts and ploughs." + LONG),
    fluff("Snowbeast", "A hulking white-furred ape with shaggy hair." + LONG),
  ]]));
  const top = [...A.appearanceScore("a shaggy ape about horse-sized", hidx).entries()]
    .sort((a, b) => b[1] - a[1])[0][0];
  assertEqual("so 'horse-sized' no longer finds horses", top, "Snowbeast|T");
}

/* ---------- F12 ---------- */
section("F12 — colour counts for little, shape counts for more");
{
  assert("a colour is worth a fraction of an ordinary word", A.termWeight(A.stem("green")) < A.WEIGHTS.plain);
  assert("...and much less than a body part", A.termWeight(A.stem("green")) < A.termWeight(A.stem("tentacles")));
  assert("morphology is worth more than an ordinary word", A.termWeight(A.stem("carapace")) > A.WEIGHTS.plain);
  assert("so is texture", A.termWeight(A.stem("slimy")) > A.WEIGHTS.plain);

  /* The case F12 exists for: the DM repainted it. Shape should still win. */
  const repainted = best("a crimson shaggy ape with fur");     // Snowbeast's fluff says white
  assertEqual("a recoloured description still finds the monster by its shape", repainted, "Snowbeast");

  // And colour alone should not be able to drag a wrong monster to the top.
  const byColourOnly = rank("white");
  const byShape = rank("carapace pincers");
  assert("shape produces a stronger signal than colour does", byShape[0][1] >= byColourOnly[0][1]);
}

/* ---------- integration: the capped bonus ---------- */
section("F3 — appearance can only ever add");
{
  const R = S.buildRarity(CORPUS);
  const obs = { type: "monstrosity" };
  const plain = S.rank(CORPUS, obs, R);
  const scoreOf = (list, name) => list.find(r => r.name === name).score;

  const scores = A.appearanceScore("carapace pincers", INDEX);
  const withLook = S.rank(CORPUS, obs, R, { appearanceScores: scores });

  assert("a monster the description fits scores higher than it did",
    scoreOf(withLook, "Shellcrab") > scoreOf(plain, "Shellcrab"));
  CORPUS.forEach(m => {
    assert(`...and ${m.name}, which it doesn't fit, is not pushed DOWN`,
      scoreOf(withLook, m.name) >= scoreOf(plain, m.name) - 1e-9);
  });

  assert("the bonus is capped, so appearance can never outweigh the mechanics",
    scoreOf(withLook, "Shellcrab") - scoreOf(plain, "Shellcrab") <= S.TUNING.appearanceCap + 1e-9);

  // It must not enter the F7 denominator: that would be a penalty wearing a bonus's clothes.
  const supplied = withLook.find(r => r.name === "Plainbeast").supplied;
  assertEqual("a description does not change how much evidence was supplied",
    supplied, plain.find(r => r.name === "Plainbeast").supplied);

  assert("a description on its own is enough to rank on", S.hasEvidence({ appearance: "shaggy ape" }));
  assertEqual("...but an empty one is not", S.hasEvidence({ appearance: "   " }), false);
}

section("robustness");
{
  assertEqual("no index means no scores rather than a crash", A.appearanceScore("carapace", null).size, 0);
  assertEqual("an empty corpus builds an empty index", A.buildAppearanceIndex([], {}).docs, []);
  assert("a monster whose fluff is missing is still scoreable by name and type",
    A.appearanceScore("plainbeast", INDEX).has("Plainbeast|T"));

  assertEqual("fluff _copy is resolved, or a quarter of the corpus would look undescribed",
    A.fluffMap([[fluff("Base", "A shaggy ape."), { name: "Derived", source: "T", _copy: { name: "Base", source: "T" } }]])
      ["derived|t"].entries, ["A shaggy ape."]);

  assert("tables and stat insets are not treated as description",
    !/1d6/.test(A.fluffProse([{ type: "table", colLabels: ["1d6"], rows: [] }, "A long enough sentence about a shaggy ape to count as prose."], 2)));
  assertEqual("short fragments are skipped in favour of real sentences",
    A.fluffProse(["Short.", "A long enough sentence about a shaggy white ape to count as prose."], 1),
    "A long enough sentence about a shaggy white ape to count as prose.");
}

report("appearance");
