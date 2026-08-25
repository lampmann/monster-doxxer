/* ============================================================
   Bounds from dice you actually rolled.

   The single best piece of evidence a party has about a hidden number is not what
   anyone remembers — it is the rolls. "16 hits, 13 misses" pins Armour Class to
   exactly (13, 16]. Nobody has to estimate anything, and the DM cannot have
   misremembered it, because the table watched it happen.

   THE SAME SHAPE THREE TIMES, which is why this is one module and not three:

     ARMOUR CLASS   an attack hits when the roll is at least the AC.
                    hit at 16  -> AC <= 16      miss at 13 -> AC > 13
     SAVE DC        a save succeeds when the roll is at least the DC.
                    passed on 18 -> DC <= 18    failed on 12 -> DC > 12
     HIT POINTS     it drops when cumulative damage reaches its total.
                    survived 40 -> HP > 40      died at 55 -> HP <= 55

   In all three the successes give an INCLUSIVE upper bound and the failures give an
   EXCLUSIVE lower bound, so `bounds()` is written once and used for all of them.

   WHAT THIS IS NOT. It is not a filter. A monster outside the range is not removed,
   it is scored by how far outside it sits — see scoreNumerics. The bounds are only
   as true as the assumption that every roll was against the same target with the
   same modifiers, and real tables break that constantly: someone had bless up, the
   DM applied cover, the rogue's total included sneak attack on a different target.
   Which is why "rank, never filter" applies here more than anywhere.

   THE NATURAL 20 AND 1 PROBLEM, unsolved on purpose. A 20 always hits and a 1
   always misses regardless of AC, so a roll that was a natural 20 tells you nothing
   — but the player types a TOTAL and the die is not recoverable from it. Detecting
   this would mean asking for the die and the modifier separately, which is more
   typing than the evidence is worth. The UI warns instead.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* "4, 9, 13 8" -> [4, 9, 13, 8]. Deliberately permissive about separators: people
     type commas, spaces, or both, and a tool that rejects "16 8 13" for want of commas
     is a tool nobody uses mid-fight. Non-numbers are dropped rather than erroring. */
  function parseRolls(text) {
    return String(text == null ? "" : text)
      .split(/[^0-9-]+/)
      .map(s => parseInt(s, 10))
      .filter(n => Number.isFinite(n));
  }

  /* successes -> inclusive upper bound, failures -> exclusive lower bound.

     Returns { lo, hi, contradiction } where the target sits in (lo, hi]. Either end
     may be null, meaning unbounded on that side — one miss and no hits still tells
     you something real, and should be usable. */
  function bounds(successes, failures) {
    const s = (successes || []).filter(Number.isFinite);
    const f = (failures || []).filter(Number.isFinite);
    if (!s.length && !f.length) return null;

    const hi = s.length ? Math.min.apply(null, s) : null;      // inclusive
    const lo = f.length ? Math.max.apply(null, f) : null;      // exclusive

    /* A lower bound at or above the upper bound is impossible for one target with
       constant modifiers, so something the tool was told is not true: different
       attackers with different bonuses, cover, bless, a DM being merciful, or a
       number typed in the wrong box. Reported rather than silently reconciled —
       guessing which end to trust would be inventing evidence. */
    const contradiction = lo != null && hi != null && lo >= hi;
    return { lo, hi, contradiction };
  }

  /* How far a candidate's number sits outside the range. Zero when inside, which is
     the whole point: every value the evidence permits is equally good, and there is
     no reason to prefer the middle of the interval over its edges. */
  function distance(value, range) {
    if (!range || typeof value !== "number" || !Number.isFinite(value)) return null;
    if (range.contradiction) return null;                       // refuse to score on it
    // (lo, hi] — lo is exclusive, so lo itself is outside by the smallest step there is.
    if (range.lo != null && value <= range.lo) return range.lo - value + 1;
    if (range.hi != null && value > range.hi) return value - range.hi;
    return 0;
  }

  const inside = (value, range) => distance(value, range) === 0;

  /* How many integers the range admits, or null when it is open-ended. Used to tell
     the user how much their rolls actually narrowed things, and nothing else — a
     range's SCORING weight does not depend on its width, because a narrow range
     already discriminates more by excluding more candidates. Weighting it twice
     would double-count the same fact. */
  function width(range) {
    if (!range || range.contradiction) return null;
    if (range.lo == null || range.hi == null) return null;
    return range.hi - range.lo;
  }

  /* Plain English, for the UI to echo back so a mistyped number is visible before it
     quietly skews a ranking. */
  function describe(range, noun) {
    const n = noun || "it";
    if (!range) return "";
    if (range.contradiction) {
      /* Both shapes contradict for the same underlying reason — one target, one set of
         modifiers, and the numbers say otherwise — but they are contradicted by
         different things, and a message about hits and misses is nonsense when the
         user never mentioned either. */
      if (range.kind === "spread") {
        return `Those can't all be one attack — ${range.spread} apart is more than a ` +
               `d20 can swing. Two different attacks, or a typo?`;
      }
      return `Those can't both be true — something at ${range.lo} failed but ` +
             `something at ${range.hi} succeeded. Different attackers, cover, or a typo?`;
    }
    if (range.lo != null && range.hi != null) {
      const w = range.hi - range.lo;
      return w === 1 ? `${n} is exactly ${range.hi}.`
                     : `${n} is between ${range.lo + 1} and ${range.hi}.`;
    }
    if (range.hi != null) return `${n} is at most ${range.hi}.`;
    return `${n} is at least ${range.lo + 1}.`;
  }

  /* BOUNDS FROM A SPREAD, not from successes and failures.

     The other three numbers here are read off which rolls beat a target. An attack
     BONUS is read off the totals themselves, with no target involved: a d20 total is
     the bonus plus something in 1..20, so

         total - 20 <= bonus <= total - 1

     for every total, and n totals intersect to

         max(totals) - 20 <= bonus <= min(totals) - 1.

     One roll leaves a 20-wide window, which is honest rather than useful. Two rolls
     eleven apart leave nine. It narrows fast because it is driven by the SPREAD, and a
     party that reports "it rolled a 22 and a 9 at us" has pinned the bonus to +2..+8
     without anyone having noticed a number they weren't told.

     Reported in the same (lo, hi] shape as everything else so one distance function
     covers all four, hence the extra -1 on the lower bound: bonus > max-21 is the same
     claim as bonus >= max-20, and keeping the convention matters more than saving a
     subtraction.

     A spread of 20 or more on one d20 with a constant modifier is impossible, so it is
     reported as a contradiction — usually two different attacks with different bonuses
     typed into one box, which is worth saying out loud. */
  function spreadBounds(totals, sides) {
    const t = (totals || []).filter(Number.isFinite);
    if (!t.length) return null;
    const d = sides || 20;
    const lo = Math.max.apply(null, t) - d - 1;   // exclusive
    const hi = Math.min.apply(null, t) - 1;       // inclusive
    return { lo, hi, contradiction: lo >= hi, kind: "spread", spread: Math.max.apply(null, t) - Math.min.apply(null, t) };
  }

  /* The two text boxes a user fills in, straight to a range. Kept here rather than in
     the app so the parsing and the arithmetic are tested together. */
  function fromFields(successText, failText) {
    const s = parseRolls(successText), f = parseRolls(failText);
    return bounds(s, f);
  }

  /* NAMESPACED ON PURPOSE. These land on `window` in the browser, flattened alongside
     every other module's exports, so a name like `describe` or `width` is a collision
     waiting to happen — `describe` already clashed with appearance.js's, and whichever
     script tag loaded last would have won. The internal names stay short; only the
     public keys carry the prefix. */
  return {
    parseRolls,
    rollBounds: bounds,
    rangeDistance: distance,
    inRange: inside,
    rangeWidth: width,
    describeRange: describe,
    spreadBounds,
    fromFields,
  };
});
