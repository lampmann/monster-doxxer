/* The party-plausibility prior.

   A level 3 party is not fighting an ancient red dragon. Telling the tool who is
   at the table shifts a lot of weight for two numbers.

   The property that matters most is that it NEVER RULES ANYTHING OUT, and in fact
   never changes a score at all. DMs throw wildly out-of-band monsters at parties
   deliberately — the unwinnable fight and the trivially easy one are both moves —
   and those are exactly the fights memorable enough that someone looks them up
   afterwards. So it settles ties and nothing else, and the tests pin that as hard
   as they pin the arithmetic.

   Run: node tests/encounter.test.js
*/
"use strict";
const E = require("../src/encounter.js");
const S = require("../src/score.js");
const { assert, assertEqual, assertClose, section, report } = require("./harness.js");

const mon = (name, crNum) => ({
  name, source: "T", key: name + "|T", crNum, cr: String(crNum),
  type: "beast", typeAlt: [], typeTags: [], size: ["medium"], speeds: { walk: 30 },
  senseTags: [], conditionImmune: [], traitTags: [], actionTags: [], damageTags: [],
  resist: [], immune: [], vulnerable: [], symptoms: [], partial: false,
});
const CORPUS = [mon("Rat", 0.125), mon("Goblin", 0.25), mon("Ogre", 2), mon("Troll", 5),
  mon("Giant", 9), mon("Wyrm", 17), mon("Tarrasque", 30)];

section("the DMG's own tables, read both ways");
{
  assertEqual("XP for a CR comes off the table", E.xpForCr(5), 1800);
  assertEqual("...including the fractional CRs", E.xpForCr(0.25), 50);
  assertEqual("a CR above the table clamps rather than extrapolating", E.xpForCr(99), 155000);
  assertEqual("a CR that isn't a number yields nothing", E.xpForCr("what"), null);

  assertClose("XP converts back to a CR", E.crForXp(1800), 5, 0.01);
  assert("...interpolating between rows rather than snapping", E.crForXp(1450) > 4 && E.crForXp(1450) < 5);
  assertEqual("no XP is CR 0", E.crForXp(0), 0);
}

section("a crowd is harder than its XP suggests");
{
  assertEqual("one monster is unmultiplied", E.crowdMultiplier(1), 1);
  assertEqual("two are half again", E.crowdMultiplier(2), 1.5);
  assertEqual("a handful double", E.crowdMultiplier(5), 2);
  assertEqual("a horde quadruples", E.crowdMultiplier(20), 4);
  assert("the multiplier never decreases as the fight fills up",
    [1, 2, 3, 7, 11, 15, 30].every((n, i, a) => i === 0 || E.crowdMultiplier(a[i - 1]) <= E.crowdMultiplier(n)));
}

section("the band a DM would be building in");
{
  const solo3 = E.band(3, 4, 1);
  assert("a level 3 party's solo monster sits in the low single digits", solo3.lo >= 0.5 && solo3.hi <= 9);
  const solo17 = E.band(17, 4, 1);
  assert("a level 17 party's is far higher", solo17.lo > solo3.hi);

  // The point of counting the fight: eight of a thing are each much weaker than one of it.
  const horde3 = E.band(3, 4, 8);
  assert("eight monsters each sit well below one", horde3.hi < solo3.hi);
  assert("...and the band moves down, not just narrows", horde3.lo < solo3.lo);

  const big = E.band(3, 6, 1);
  assert("more adventurers can face more", big.hi > solo3.hi);

  assertEqual("an absurd level is clamped rather than crashing", E.band(99, 4, 1).level, 20);
  assertEqual("...as is a level below one", E.band(0, 4, 1).level, 1);
  assertEqual("a missing party size falls back to four", E.band(5, null, 1).partySize, 4);
  assertEqual("a missing count is one creature", E.band(5, 4, null).count, 1);
}

section("plausibility falls away, and never cuts off");
{
  const b = E.band(3, 4, 1);
  assertEqual("a monster inside the band is fully plausible", E.plausibility(3, b), 1);
  assert("one far above it is not", E.plausibility(25, b) < 0.5);
  assert("...but is never zero, because DMs do that on purpose", E.plausibility(30, b) > 0);
  assert("one far below is implausible too", E.plausibility(0, b) < 0.2);

  /* Asymmetric on purpose: an over-levelled fight is likelier, and much likelier to be
     the one somebody looks up afterwards, than a session wasted on something trivial. */
  const over = E.plausibility(b.hi * 3, b);
  const under = E.plausibility(0.125, b);
  assert("being too strong is treated as likelier than being trivially weak", over > under);

  assert("plausibility never leaves [0,1]",
    [0, 0.125, 1, 5, 20, 30].every(cr => { const p = E.plausibility(cr, b); return p >= 0 && p <= 1; }));
  assertEqual("a monster with no CR at all scores nothing rather than NaN", E.plausibility(null, b), 0);
}

section("as a map over the corpus");
{
  const m = E.crPlausibility(CORPUS, 3, 4, 1);
  assertEqual("a monster in band is at full strength", m.get("Ogre|T"), 1);
  assert("the tarrasque is not", (m.get("Tarrasque|T") || 0) < 0.3);
  assert("...but is still present, not dropped", m.has("Tarrasque|T"));

  const horde = E.crPlausibility(CORPUS, 3, 4, 10);
  assert("with ten of them, the goblin becomes the plausible one", horde.get("Goblin|T") === 1);
  assert("...and the troll stops being", (horde.get("Troll|T") || 0) < 1);
}

/* ---------- the load-bearing property ----------

   Measured as a capped score bonus, this was worth +0.4 points of top-5 when the DM had
   built by the book and cost EIGHT when they had not. As a tiebreak it cannot cost that,
   because it only ever orders candidates the evidence has already called identical. The
   tests below pin the tiebreak shape, not the bonus that was tried and dropped. */
section("it is a tiebreak, not a score");
{
  const R = S.buildRarity(CORPUS);
  const obs = { type: "beast" };                       // every fixture is a beast: all tie
  const plaus = E.crPlausibility(CORPUS, 3, 4, 1);
  const plain = S.rank(CORPUS, obs, R);
  const withParty = S.rank(CORPUS, obs, R, { crPlausibility: plaus });
  const get = (list, n) => list.find(r => r.name === n).score;

  CORPUS.forEach(m => {
    assertClose(`${m.name}'s score is untouched by knowing the party`,
      get(withParty, m.name), get(plain, m.name), 1e-9);
  });
  assertEqual("everything is still ranked — the party never filters", withParty.length, CORPUS.length);

  // What it MAY do: arrange what the evidence could not distinguish.
  assert("among candidates the evidence cannot separate, the plausible one comes first",
    withParty.findIndex(r => r.name === "Ogre") < withParty.findIndex(r => r.name === "Tarrasque"));
  assert("...and a level 17 party reverses that, with no scores changing",
    S.rank(CORPUS, obs, R, { crPlausibility: E.crPlausibility(CORPUS, 17, 4, 1) })
      .findIndex(r => r.name === "Tarrasque") <
    S.rank(CORPUS, obs, R, { crPlausibility: E.crPlausibility(CORPUS, 17, 4, 1) })
      .findIndex(r => r.name === "Goblin"));

  // Evidence must still win outright: a prior may never reorder what the evidence separated.
  const mixed = CORPUS.concat([Object.assign(mon("Oddity", 30), { type: "aberration" })]);
  const evidenced = S.rank(mixed, { type: "aberration" }, S.buildRarity(mixed),
    { crPlausibility: E.crPlausibility(mixed, 3, 4, 1) });
  assertEqual("an implausible monster the evidence fits still comes first", evidenced[0].name, "Oddity");
}

report("encounter");
