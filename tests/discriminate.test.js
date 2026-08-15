/* F13 — discriminating tests.

   "Hit it with radiant damage to separate wight from ghoul."

   The properties worth pinning are about what must NEVER be suggested, because a
   bad suggestion is worse than none: it costs the party a turn mid-fight and
   teaches them to ignore the feature. A test every candidate answers identically
   carries no information and must score zero. A test the party has already run
   must not come back. And a test nobody can actually perform — "does it have a
   burrow speed" — must never be on the menu at all, however well it would split
   the field.

   Run: node tests/discriminate.test.js
*/
"use strict";
const D = require("../src/discriminate.js");
const { assert, assertEqual, assertClose, section, report } = require("./harness.js");

function mon(name, over) {
  return Object.assign({
    name, source: "T", key: name + "|T",
    type: "undead", typeAlt: [], typeTags: [], size: ["medium"], speeds: { walk: 30 },
    senseTags: [], conditionImmune: [], traitTags: [], actionTags: [], damageTags: [],
    resist: [], immune: [], vulnerable: [], symptoms: [],
  }, over);
}
// A result as rank() emits it, with the monster kept.
const res = (m, score) => ({ key: m.key, name: m.name, source: m.source, score, monster: m });

const ONTOLOGY = {
  byId: {
    "it-healed-between-rounds": { id: "it-healed-between-rounds", player: "It healed between rounds", testable: true },
    "i-couldnt-move-at-all": { id: "i-couldnt-move-at-all", player: "I couldn't move or act at all", testable: true },
    "it-came-back-later": { id: "it-came-back-later", player: "We killed it and it came back later", testable: false },
  },
  symptoms: [
    { id: "it-healed-between-rounds", player: "It healed between rounds", testable: true },
    { id: "i-couldnt-move-at-all", player: "I couldn't move or act at all", testable: true },
    { id: "it-came-back-later", player: "We killed it and it came back later", testable: false },
  ],
};

/* Two candidates the evidence cannot separate, differing in exactly one testable way. */
const WIGHT = mon("Wight", { immune: ["poison"], conditionImmune: ["poisoned"] });
const GHOUL = mon("Ghoul", { vulnerable: ["radiant"] });
const PAIR = [res(WIGHT, 0.8), res(GHOUL, 0.8)];

/* ---------- the maths ---------- */
section("F13 — information, measured");
{
  assertClose("a fair coin is one bit", D.entropy([0.5, 0.5]), 1, 1e-9);
  assertClose("a certainty is no bits", D.entropy([1]), 0, 1e-9);
  assertClose("four equal candidates are two bits", D.entropy([0.25, 0.25, 0.25, 0.25]), 2, 1e-9);

  const p = D.probabilities(PAIR);
  assertClose("tied candidates come out equally likely", p[0], 0.5, 1e-9);
  assert("...and the distribution sums to one", Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);

  const withNegative = D.probabilities([res(WIGHT, 0.9), res(GHOUL, -0.4)]);
  assertEqual("a candidate the evidence contradicts carries no weight", withNegative[1], 0);

  const allZero = D.probabilities([res(WIGHT, 0), res(GHOUL, 0)]);
  assertClose("when nothing scores, the honest reading is uniform", allZero[0], 0.5, 1e-9);
}

/* ---------- what gets suggested ---------- */
section("F13 — a test that splits the field is suggested");
{
  const out = D.suggest(PAIR, { ontology: ONTOLOGY });
  assert("there is something to suggest", out.length > 0);

  const radiant = out.find(t => t.kind === "damage" && t.value === "radiant");
  assert("hitting it with radiant separates these two", !!radiant);
  assertClose("...and a clean two-way split of two tied candidates is worth a whole bit",
    radiant.gain, 1, 1e-9);
  assert("the suggestion names the split, not just the test", /Ghoul|Wight/.test(radiant.split));
  assert("...and reads as an instruction", /^Hit it with radiant damage/.test(radiant.label));

  assert("suggestions are ordered by what they are worth",
    out.every((t, i, a) => i === 0 || a[i - 1].score >= t.score));
}

section("F13 — a test that tells you nothing is never suggested");
{
  // Neither has any interaction with cold, so hitting it with cold splits nothing.
  const out = D.suggest(PAIR, { ontology: ONTOLOGY });
  assert("a damage type both candidates answer the same way is absent",
    !out.some(t => t.kind === "damage" && t.value === "cold"));
  assert("every suggestion carries real information", out.every(t => t.gain > 0));

  const identical = [res(mon("A"), 0.5), res(mon("B"), 0.5)];
  assertEqual("two indistinguishable candidates yield no advice at all",
    D.suggest(identical, { ontology: ONTOLOGY }).length, 0);
}

section("F13 — only tests a party can actually run");
{
  const flyer = mon("Wyvern", { speeds: { walk: 20, fly: 80 }, senseTags: ["Darkvision"] });
  const walker = mon("Zombie", {});
  const out = D.suggest([res(flyer, 0.7), res(walker, 0.7)], { ontology: ONTOLOGY });

  // A fly speed splits these perfectly and is useless advice: you cannot make it fly.
  assert("movement is never suggested, however well it would split the field",
    !out.some(t => t.kind === "movement" || /\bfly\b/i.test(t.label)));
  assert("neither are senses", !out.some(t => /darkvision|blindsight/i.test(t.label)));
  assert("every suggestion is one of the three kinds a party can perform",
    out.every(t => ["damage", "condition", "symptom"].includes(t.kind)));
}

section("F13 — symptoms only when the ontology says they're testable");
{
  const healer = mon("Troll", { symptoms: ["it-healed-between-rounds", "it-came-back-later"] });
  const plain = mon("Ogre", {});
  const out = D.suggest([res(healer, 0.7), res(plain, 0.7)], { ontology: ONTOLOGY });

  assert("a testable symptom is offered", out.some(t => t.kind === "symptom" && t.value === "it-healed-between-rounds"));
  // You cannot check whether it rejuvenates in three days during a fight.
  assert("an untestable one is not, however well it splits",
    !out.some(t => t.kind === "symptom" && t.value === "it-came-back-later"));
  const s = out.find(t => t.kind === "symptom");
  assert("a first-person symptom is quoted rather than mangled into a clause",
    /^Watch for: /.test(s.label));
}

section("F13 — don't ask what the party already told you");
{
  const asked = { damage: { radiant: "vulnerable" }, symptoms: [], condImmune: [] };
  const out = D.suggest(PAIR, { ontology: ONTOLOGY, observation: asked });
  assert("a damage type already reported is not suggested again",
    !out.some(t => t.kind === "damage" && t.value === "radiant"));

  const withSymptom = { symptoms: ["it-healed-between-rounds"], damage: {}, condImmune: [] };
  const healer = mon("Troll", { symptoms: ["it-healed-between-rounds"] });
  assert("nor is a symptom already reported",
    !D.suggest([res(healer, 0.7), res(mon("Ogre"), 0.7)], { ontology: ONTOLOGY, observation: withSymptom })
      .some(t => t.kind === "symptom" && t.value === "it-healed-between-rounds"));

  const withCond = { condImmune: ["poisoned"], damage: {}, symptoms: [] };
  assert("nor a condition already reported",
    !D.suggest(PAIR, { ontology: ONTOLOGY, observation: withCond })
      .some(t => t.kind === "condition" && t.value === "poisoned"));
}

/* ---------- the answer goes back in ---------- */
section("F13 — running the test and folding the answer back");
{
  assertEqual("the oracle reads the truth off the statblock",
    D.answerFor({ kind: "damage", value: "radiant" }, GHOUL), "vulnerable");
  assertEqual("...including 'nothing special happened'",
    D.answerFor({ kind: "damage", value: "fire" }, GHOUL), "normal");
  assertEqual("...for conditions", D.answerFor({ kind: "condition", value: "poisoned" }, WIGHT), "immune");
  assertEqual("...and for symptoms",
    D.answerFor({ kind: "symptom", value: "it-healed-between-rounds" }, mon("T", { symptoms: ["it-healed-between-rounds"] })), "yes");

  const obs = { symptoms: [], condImmune: [], damage: {} };
  const after = D.applyAnswer(obs, { kind: "damage", value: "radiant" }, "vulnerable");
  assertEqual("a damage answer lands in the damage map", after.damage.radiant, "vulnerable");
  assertEqual("...without mutating what it was given", Object.keys(obs.damage).length, 0);

  const cond = D.applyAnswer(obs, { kind: "condition", value: "poisoned" }, "immune");
  assertEqual("an immunity is recorded", cond.condImmune, ["poisoned"]);
  const notCond = D.applyAnswer(obs, { kind: "condition", value: "poisoned" }, "affected");
  assertEqual("...but 'it could be poisoned' is what most things do, and isn't evidence",
    notCond.condImmune, []);

  const sym = D.applyAnswer(obs, { kind: "symptom", value: "it-healed-between-rounds" }, "yes");
  assertEqual("a symptom seen is recorded", sym.symptoms, ["it-healed-between-rounds"]);
  assertEqual("...and one that didn't happen is not asserted as absent",
    D.applyAnswer(obs, { kind: "symptom", value: "it-healed-between-rounds" }, "no").symptoms, []);
}

section("robustness");
{
  assertEqual("no candidates, no advice", D.suggest([], { ontology: ONTOLOGY }), []);
  assertEqual("one candidate needs no test to tell it from itself",
    D.suggest([res(WIGHT, 0.9)], { ontology: ONTOLOGY }), []);
  assertEqual("results with no monster attached are skipped rather than crashing",
    D.suggest([{ name: "X", score: 0.5 }, { name: "Y", score: 0.5 }], { ontology: ONTOLOGY }), []);
  assert("a missing ontology only costs the symptom tests",
    D.suggest(PAIR, {}).every(t => t.kind !== "symptom"));
  assert("...and the damage tests still work", D.suggest(PAIR, {}).some(t => t.kind === "damage"));
  assert("the limit is honoured", D.suggest(PAIR, { ontology: ONTOLOGY, limit: 2 }).length <= 2);
}

report("discriminate");
