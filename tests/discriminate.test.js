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
    resist: [], immune: [], vulnerable: [], traitNames: [],
  }, over);
}
// A result as rank() emits it, with the monster kept.
const res = (m, score) => ({ key: m.key, name: m.name, source: m.source, score, monster: m });

/* A stand-in for src/traits.js's TRAIT_ALL — every catalogued trait is a candidate
   test, unlike the old symptom ontology, which needed a `testable` flag because some
   symptoms describe things a party cannot watch for mid-fight (a rejuvenation that
   takes three days). A trait is always something you can watch for, so there is
   nothing to filter here. */
const TRAITS = [
  { key: "regeneration", name: "Regeneration", desc: "closed its own wounds every round" },
  { key: "misty escape", name: "Misty Escape", desc: "turned to mist when badly hurt" },
];

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
  const out = D.suggest(PAIR, { traits: TRAITS });
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
  const out = D.suggest(PAIR, { traits: TRAITS });
  assert("a damage type both candidates answer the same way is absent",
    !out.some(t => t.kind === "damage" && t.value === "cold"));
  assert("every suggestion carries real information", out.every(t => t.gain > 0));

  const identical = [res(mon("A"), 0.5), res(mon("B"), 0.5)];
  assertEqual("two indistinguishable candidates yield no advice at all",
    D.suggest(identical, { traits: TRAITS }).length, 0);
}

section("F13 — only tests a party can actually run");
{
  const flyer = mon("Wyvern", { speeds: { walk: 20, fly: 80 }, senseTags: ["Darkvision"] });
  const walker = mon("Zombie", {});
  const out = D.suggest([res(flyer, 0.7), res(walker, 0.7)], { traits: TRAITS });

  // A fly speed splits these perfectly and is useless advice: you cannot make it fly.
  assert("movement is never suggested, however well it would split the field",
    !out.some(t => t.kind === "movement" || /\bfly\b/i.test(t.label)));
  assert("neither are senses", !out.some(t => /darkvision|blindsight/i.test(t.label)));
  assert("every suggestion is one of the three kinds a party can perform",
    out.every(t => ["damage", "condition", "trait"].includes(t.kind)));
}

section("F13 — every catalogued trait is a candidate, none need a testable flag");
{
  const healer = mon("Troll", { traitNames: ["regeneration"] });
  const plain = mon("Ogre", {});
  const out = D.suggest([res(healer, 0.7), res(plain, 0.7)], { traits: TRAITS });

  assert("a trait that splits the pair is offered",
    out.some(t => t.kind === "trait" && t.value === "regeneration"));
  const t = out.find(x => x.kind === "trait");
  assert("the label leads with the gloss, quoted, and names the trait after it",
    /^Watch for: “closed its own wounds every round” \(Regeneration\)$/.test(t.label));
}

section("F13 — don't ask what the party already told you");
{
  const asked = { damage: { radiant: "vulnerable" }, traits: [], condImmune: [] };
  const out = D.suggest(PAIR, { traits: TRAITS, observation: asked });
  assert("a damage type already reported is not suggested again",
    !out.some(t => t.kind === "damage" && t.value === "radiant"));

  const withTrait = { traits: ["regeneration"], damage: {}, condImmune: [] };
  const healer = mon("Troll", { traitNames: ["regeneration"] });
  assert("nor is a trait already reported",
    !D.suggest([res(healer, 0.7), res(mon("Ogre"), 0.7)], { traits: TRAITS, observation: withTrait })
      .some(t => t.kind === "trait" && t.value === "regeneration"));

  const withCond = { condImmune: ["poisoned"], damage: {}, traits: [] };
  assert("nor a condition already reported",
    !D.suggest(PAIR, { traits: TRAITS, observation: withCond })
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
  assertEqual("...and for traits",
    D.answerFor({ kind: "trait", value: "regeneration" }, mon("T", { traitNames: ["regeneration"] })), "yes");

  const obs = { traits: [], condImmune: [], damage: {} };
  const after = D.applyAnswer(obs, { kind: "damage", value: "radiant" }, "vulnerable");
  assertEqual("a damage answer lands in the damage map", after.damage.radiant, "vulnerable");
  assertEqual("...without mutating what it was given", Object.keys(obs.damage).length, 0);

  const cond = D.applyAnswer(obs, { kind: "condition", value: "poisoned" }, "immune");
  assertEqual("an immunity is recorded", cond.condImmune, ["poisoned"]);
  const notCond = D.applyAnswer(obs, { kind: "condition", value: "poisoned" }, "affected");
  assertEqual("...but 'it could be poisoned' is what most things do, and isn't evidence",
    notCond.condImmune, []);

  const trait = D.applyAnswer(obs, { kind: "trait", value: "regeneration" }, "yes");
  assertEqual("a trait seen is recorded", trait.traits, ["regeneration"]);
  assertEqual("...and one that didn't happen is not asserted as absent",
    D.applyAnswer(obs, { kind: "trait", value: "regeneration" }, "no").traits, []);
}

section("robustness");
{
  assertEqual("no candidates, no advice", D.suggest([], { traits: TRAITS }), []);
  assertEqual("one candidate needs no test to tell it from itself",
    D.suggest([res(WIGHT, 0.9)], { traits: TRAITS }), []);
  assertEqual("results with no monster attached are skipped rather than crashing",
    D.suggest([{ name: "X", score: 0.5 }, { name: "Y", score: 0.5 }], { traits: TRAITS }), []);
  assert("a missing trait list only costs the trait tests",
    D.suggest(PAIR, {}).every(t => t.kind !== "trait"));
  assert("...and the damage tests still work", D.suggest(PAIR, {}).some(t => t.kind === "damage"));
  assert("the limit is honoured", D.suggest(PAIR, { traits: TRAITS, limit: 2 }).length <= 2);
}

report("discriminate");
