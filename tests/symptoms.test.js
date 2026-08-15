/* Symptom ontology tests — F8.

   Two things are under test and they are different in kind.

   The INTERPRETER (src/symptoms.js) is ordinary code and is tested on synthetic
   statblocks, the same way the rest of the suite works: no sourcebook content in
   the repository, so the fixtures are hand-written shapes.

   The ONTOLOGY (ontology/symptoms.json) is data, and the thing worth asserting
   about data is that it is well formed and internally coherent — every symptom
   reachable, every candidate able to match something, no duplicate ids, every
   likelihood in range. Whether its regexes actually fire against real prose is a
   question about WotC's text, which lives in `node eval/coverage.js` against the
   user's own data/ rather than in a unit test that cannot see it.

   Run: node tests/symptoms.test.js
*/
"use strict";
const SY = require("../src/symptoms.js");
const ONT = require("../ontology/symptoms.json");
const { assert, assertEqual, section, report } = require("./harness.js");

/* A statblock in the shape the normaliser emits. Only the fields the tagger reads. */
function mon(over) {
  return Object.assign({
    name: "Test", source: "T", key: "Test|T",
    type: "monstrosity", typeTags: [], size: ["medium"],
    speeds: { walk: 30 }, hover: false, senseTags: [], conditionImmune: [],
    traitTags: [], actionTags: [], damageTags: [],
    resist: [], immune: [], vulnerable: [],
    resistText: "", immuneText: "", vulnerableText: "",
    languages: [], hasLair: false,
    traits: [], actions: [], bonusActions: [], reactions: [], legendary: [], spellcasting: [],
  }, over);
}
const entry = (name, text) => ({ name, text });

const C = SY.compile(ONT);

/* ---------- the ontology as data ---------- */
section("F8 — the ontology is well formed");
{
  assert("the ontology carries a usable number of symptoms", C.symptoms.length >= 100);
  assertEqual("every candidate has at least one matcher, so none is dead on arrival", C.problems, []);

  const ids = C.symptoms.map(s => s.id);
  assertEqual("symptom ids are unique", ids.length, new Set(ids).size);
  assert("ids are kebab-case, since they end up as feature keys", ids.every(i => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(i)));
  // Phrasing, not length: "It flew" is a perfectly good thing to say at a table. What must
  // hold is that it reads as a player's sentence rather than as a mechanic's name.
  assert("every symptom is phrased as a sentence a player would say, not a rules term",
    C.symptoms.every(s => /^[A-Z]/.test(s.player) && /\s/.test(s.player)));
  assert("...and every symptom offers at least one alternate phrasing for lookup to match",
    C.symptoms.every(s => s.aka.length >= 1));
  assert("every likelihood is a probability", C.symptoms.every(s => s.candidates.every(c => c.p > 0 && c.p <= 1)));

  // The whole premise of F8 is that an observation has several possible causes. A file
  // where most symptoms name one mechanic has quietly turned back into a lookup table.
  const ambiguous = C.symptoms.filter(s => s.candidates.length > 1).length;
  assert("most symptoms admit more than one explanation, which is the point of F8",
    ambiguous / C.symptoms.length > 0.6);

  assert("some symptoms are marked as testable in one round, for F13 to prefer",
    C.symptoms.filter(s => s.testable).length >= 10);
}

/* ---------- the two matching layers ---------- */
section("F8 — curated tags and prose both attach symptoms");
{
  const byTag = SY.tagMonster(mon({ traitTags: ["Regeneration"] }), C);
  assert("a 5e.tools trait tag attaches its symptom", byTag.symptoms.includes("it-healed-between-rounds"));
  assertEqual("...at full confidence, because the label is curated and exact",
    byTag.symptomConf["it-healed-between-rounds"], 1);

  const byProse = SY.tagMonster(mon({
    traits: [entry("Unholy Vigour", "The creature regains 10 hit points at the start of its turn.")],
  }), C);
  assert("prose with no tag still attaches the symptom, which is the long tail F8 exists for",
    byProse.symptoms.includes("it-healed-between-rounds"));
  assert("...but at lower confidence than the curated tag",
    byProse.symptomConf["it-healed-between-rounds"] < byTag.symptomConf["it-healed-between-rounds"]);

  const none = SY.tagMonster(mon({ traits: [entry("Keen Hearing", "It has advantage on Perception checks.")] }), C);
  assert("a monster with no bearing on a symptom simply doesn't get it",
    !none.symptoms.includes("it-healed-between-rounds"));
}

section("F8 — structural facts are evidence too, not just prose");
{
  const b = SY.tagMonster(mon({ speeds: { walk: 30, burrow: 30 } }), C);
  assert("a burrow speed attaches the burrowing symptom with no prose involved", b.symptoms.includes("it-burrowed-away"));
  const t = SY.tagMonster(mon({ senseTags: ["Tremorsense"] }), C);
  assert("tremorsense is a sense entry, and the symptom for it reads that field", t.symptoms.includes("it-felt-me-through-the-floor"));
  assert("a monster without the sense doesn't get the symptom", !SY.tagMonster(mon({}), C).symptoms.includes("it-felt-me-through-the-floor"));
}

/* The bug this pins: "inflicts frightened" and "cannot be frightened" share a word.
   A symptom about being frightened must not match every creature immune to fear. */
section("F8 — inflicting a condition is not the same as being immune to it");
{
  const immune = SY.tagMonster(mon({
    conditionImmune: ["frightened", "charmed", "petrified"],
    traits: [entry("Stoic", "It is unmoved by the sight of blood.")],
  }), C);
  assert("a monster IMMUNE to frightened is not tagged as one that frightens you",
    !immune.symptoms.includes("i-was-terrified-and-couldnt-approach"));
  assert("...nor petrifying, just for being immune to petrification",
    !immune.symptoms.includes("i-started-turning-to-stone"));
  assert("...and its immunities are still read as immunities",
    immune.symptoms.includes("fear-and-charm-didnt-work-on-it"));

  const inflicts = SY.tagMonster(mon({
    actions: [entry("Gaze", "The target must succeed on a DC 15 save or be frightened until the end of its next turn.")],
  }), C);
  assert("a monster that actually inflicts it is tagged", inflicts.symptoms.includes("i-was-terrified-and-couldnt-approach"));
}

section("F8 — the defence block is still readable when that IS the evidence");
{
  const m = SY.tagMonster(mon({
    resistText: "bludgeoning, piercing, and slashing from nonmagical attacks",
    resist: ["bludgeoning", "piercing", "slashing"],
  }), C);
  assert("resistance to nonmagical attacks explains 'our swords bounced off'",
    m.symptoms.includes("only-magic-weapons-hurt-it"));
}

section("F8 — confidence is the strongest explanation, not the sum of weak ones");
{
  const many = SY.tagMonster(mon({
    traits: [entry("Slow Knitting", "It regains 1 hit point whenever it is struck.")],
    spellcasting: [{ name: "Spellcasting", text: "It can cast cure wounds at will." }],
  }), C);
  const one = SY.tagMonster(mon({ traitTags: ["Regeneration"] }), C);
  assert("several weak explanations do not add up past one strong one",
    many.symptomConf["it-healed-between-rounds"] < one.symptomConf["it-healed-between-rounds"]);
  assert("...and every explanation found is kept, for F14 to show",
    many.symptomWhy["it-healed-between-rounds"].length >= 2);
  assert("...strongest first", many.symptomWhy["it-healed-between-rounds"]
    .every((x, i, a) => i === 0 || a[i - 1].p >= x.p));
}

/* ---------- the ontology read backwards ---------- */
section("F8 — lookup, for a player typing what they saw");
{
  const hits = SY.lookup(C, "it healed itself between rounds", 5);
  assert("plain language finds the symptom", hits.length > 0);
  assertEqual("...and the obvious one ranks first", hits[0].id, "it-healed-between-rounds");

  assertEqual("an alternate phrasing finds it too, via the aka list",
    SY.lookup(C, "its wounds closed up", 1)[0].id, "it-healed-between-rounds");
  assertEqual("a query of nothing but stop words matches nothing rather than everything",
    SY.lookup(C, "it was the and of", 5).length, 0);
  assertEqual("an empty query is empty, not the whole ontology", SY.lookup(C, "", 5).length, 0);

  assert("results are ordered by how well they match",
    SY.lookup(C, "it turned invisible", 5).every((x, i, a) => i === 0 || a[i - 1].score >= x.score));
}

section("robustness");
{
  const broken = SY.compile({ symptoms: [
    { id: "bad-regex", player: "a broken one", candidates: [{ mechanic: "x", p: 1, text: "([unclosed" }] },
    { id: "no-matcher", player: "another broken one", candidates: [{ mechanic: "y", p: 1 }] },
    { player: "no id at all", candidates: [] },
  ] });
  assertEqual("a symptom with no id is dropped rather than crashing the compile", broken.symptoms.length, 2);
  assert("a candidate with no matcher is reported as a problem", broken.problems.some(p => /no-matcher/.test(p)));
  assertEqual("an uncompilable regex disables its candidate instead of the whole run",
    SY.tagMonster(mon({}), broken).symptoms, []);
  assertEqual("compiling nothing at all is empty, not an error", SY.compile(null).symptoms, []);
  assertEqual("...and tagging against it is empty too", SY.tagMonster(mon({}), SY.compile(null)).symptoms, []);

  assert("an unknown field predicate is false rather than a crash", !SY.testField(mon({}), "nonsense.thing"));
  assert("a probability outside 0..1 is clamped", SY.compile({ symptoms: [
    { id: "x", player: "xxxxxxxxxx", candidates: [{ mechanic: "m", p: 7, traitTag: "Regeneration" }] },
  ] }).symptoms[0].candidates[0].p === 1);
}

report("symptoms");
