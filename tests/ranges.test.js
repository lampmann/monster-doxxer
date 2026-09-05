/* Bounds from dice the party actually rolled.

   The arithmetic here is the whole feature, and it is the kind that is easy to get
   off by one in a way nobody notices until a ranking is quietly wrong. So the
   boundaries are pinned explicitly: the value AT an exclusive bound is outside, the
   value AT an inclusive bound is inside.

   Run: node tests/ranges.test.js
*/
"use strict";
const R = require("../src/ranges.js");
const { assert, assertEqual, section, report } = require("./harness.js");

section("reading what somebody typed");
{
  assertEqual("commas", R.parseRolls("4,9,13,8"), [4, 9, 13, 8]);
  assertEqual("commas and spaces", R.parseRolls("16, 8, 13"), [16, 8, 13]);
  assertEqual("just spaces — people type this constantly", R.parseRolls("16 8 13"), [16, 8, 13]);
  assertEqual("trailing junk is dropped, not an error", R.parseRolls("16, 8,"), [16, 8]);
  assertEqual("prose around the numbers still works", R.parseRolls("16 and 8"), [16, 8]);
  assertEqual("nothing typed", R.parseRolls(""), []);
  assertEqual("null", R.parseRolls(null), []);
  assertEqual("no numbers at all", R.parseRolls("dunno"), []);
}

section("the transcript's own example");
{
  // "16, 8, 13, which hit?" / "16 hits, the rest miss"
  const ac = R.rollBounds([16], [8, 13]);
  assertEqual("the tightest lower bound is the HIGHEST miss", ac.lo, 13);
  assertEqual("the tightest upper bound is the LOWEST hit", ac.hi, 16);
  assertEqual("...and it is not a contradiction", ac.contradiction, false);
  assertEqual("which reads back as a range a person can check",
    R.describeRange(ac, "Its AC"), "Its AC is between 14 and 16.");
}

section("the bounds are (lo, hi] and the ends matter");
{
  const r = R.rollBounds([16], [13]);
  assertEqual("a value below the range is outside", R.inRange(12, r), false);
  assertEqual("the exclusive lower bound itself is OUTSIDE", R.inRange(13, r), false);
  assertEqual("one above it is the first legal value", R.inRange(14, r), true);
  assertEqual("the inclusive upper bound is INSIDE", R.inRange(16, r), true);
  assertEqual("one above the top is outside", R.inRange(17, r), false);

  assertEqual("distance is zero anywhere inside, not just at the middle", R.rangeDistance(15, r), 0);
  assertEqual("...at the top too", R.rangeDistance(16, r), 0);
  assertEqual("above the top, distance counts up from it", R.rangeDistance(18, r), 2);
  assertEqual("at the exclusive bound, distance is the smallest possible step",
    R.rangeDistance(13, r), 1);
  assertEqual("below it, distance grows", R.rangeDistance(11, r), 3);
}

section("one-sided evidence is still evidence");
{
  const onlyMiss = R.rollBounds([], [13]);
  assertEqual("misses alone give a lower bound", onlyMiss.lo, 13);
  assertEqual("...and no upper bound", onlyMiss.hi, null);
  assertEqual("anything above it fits", R.inRange(30, onlyMiss), true);
  assertEqual("anything at or below does not", R.inRange(13, onlyMiss), false);
  assertEqual("and it says so plainly", R.describeRange(onlyMiss, "Its AC"), "Its AC is at least 14.");

  const onlyHit = R.rollBounds([16], []);
  assertEqual("hits alone give an upper bound", onlyHit.hi, 16);
  assertEqual("...and no lower bound", onlyHit.lo, null);
  assertEqual("anything at or below fits", R.inRange(3, onlyHit), true);
  assertEqual("above does not", R.inRange(17, onlyHit), false);
  assertEqual("width is unknowable when one end is open", R.rangeWidth(onlyHit), null);

  assertEqual("nothing typed at all is not a range", R.rollBounds([], []), null);
  assertEqual("...and scoring against nothing is null, not zero", R.rangeDistance(15, null), null);
}

section("a single roll pins the number exactly");
{
  const exact = R.rollBounds([14], [13]);
  assertEqual("width 1 means one possible value", R.rangeWidth(exact), 1);
  assertEqual("and the tool says so rather than making you work it out",
    R.describeRange(exact, "Its AC"), "Its AC is exactly 14.");
  assertEqual("only that value is inside", R.inRange(14, exact), true);
  assertEqual("...really only that one", R.inRange(15, exact), false);
}

section("impossible input is reported, never reconciled");
{
  /* One target with constant modifiers cannot miss on 16 and hit on 13. Something the
     tool was told is untrue — different attackers, cover, bless, or a typo — and
     picking an end to trust would be inventing evidence. */
  const bad = R.rollBounds([13], [16]);
  assertEqual("a lower bound above the upper bound is flagged", bad.contradiction, true);
  assertEqual("scoring refuses rather than guessing", R.rangeDistance(14, bad), null);
  assertEqual("width refuses too", R.rangeWidth(bad), null);
  assert("and the message names the two numbers that clash",
    /16/.test(R.describeRange(bad)) && /13/.test(R.describeRange(bad)));

  const touching = R.rollBounds([13], [13]);
  assertEqual("equal bounds are also impossible — (13,13] is empty",
    touching.contradiction, true);
}

section("the same maths for saving throws");
{
  // "What's the DC?" / "I'll only tell you if you pass or fail." Rolled 18, passed.
  const dc = R.rollBounds([18], []);
  assertEqual("a passed save caps the DC", dc.hi, 18);
  assertEqual("DC 18 is still possible — you pass ON the DC", R.inRange(18, dc), true);
  assertEqual("DC 19 is not", R.inRange(19, dc), false);

  const dc2 = R.rollBounds([18], [12]);
  assertEqual("a failed save floors it", dc2.lo, 12);
  assertEqual("DC 12 itself is excluded — you would have passed", R.inRange(12, dc2), false);
  assertEqual("DC 13 is the lowest it can be", R.inRange(13, dc2), true);
}

section("hit points, from a damage tally and how it looked (bloodiedBounds)");
{
  // Dead at a running total of 30: HP was at most 30.
  const dead = R.bloodiedBounds("10, 20", "dead");
  assertEqual("dead caps HP at the total dealt", dead.hi, 30);
  assertEqual("no floor — it could have had exactly 1 hp left", dead.lo, null);
  assertEqual("HP 30 is consistent with dying at 30", R.inRange(30, dead), true);
  assertEqual("HP 31 is not — that shouldn't have dropped it", R.inRange(31, dead), false);

  // Bloodied at 30 total: half its max is at most 30, and it still has at least 1 hp,
  // so its max is somewhere in (30, 60].
  const bloodied = R.bloodiedBounds("30", "bloodied");
  assertEqual("bloodied floors HP just above the total", bloodied.lo, 30);
  assertEqual("...and caps it at double the total", bloodied.hi, 60);
  assertEqual("HP 60 is consistent with being exactly half-dead at 30", R.inRange(60, bloodied), true);
  assertEqual("HP 30 is not — that would mean it's dead, not bloodied", R.inRange(30, bloodied), false);
  assertEqual("HP 61 is not — bloodied means at HALF or below", R.inRange(61, bloodied), false);

  // Still standing (not bloodied) at 15 total: more than half its max is still above 15.
  const alive = R.bloodiedBounds("15", "alive");
  assertEqual("still standing floors HP above double the total", alive.lo, 30);
  assertEqual("no cap — it could be nearly untouched", alive.hi, null);
  assertEqual("HP 31 fits — more than half its max is left", R.inRange(31, alive), true);
  assertEqual("HP 30 does not — that's exactly half, i.e. bloodied", R.inRange(30, alive), false);

  // Commas, spaces, or both — same tolerant parsing as every other roll box — and the
  // three numbers SUM rather than bound each other, since this is one running tally,
  // not independent hit/miss data points.
  assertEqual("commas and spaces both work, and the totals sum",
    R.bloodiedBounds("10,20 5", "dead").hi, 35);

  assertEqual("an empty box is no evidence, not a claim of zero damage",
    R.bloodiedBounds("", "dead"), null);
  assertEqual("a total with no state selected is no evidence either",
    R.bloodiedBounds("30", ""), null);
  assertEqual("junk with no numbers in it is no evidence",
    R.bloodiedBounds("no idea", "alive"), null);
}

section("straight from two text boxes");
{
  const r = R.fromFields("16", "8, 13");
  assertEqual("parses and bounds in one step", [r.lo, r.hi], [13, 16]);
  assertEqual("empty boxes are no range", R.fromFields("", ""), null);
  assertEqual("one empty box is one-sided", R.fromFields("16", "").lo, null);
}

report("ranges");
