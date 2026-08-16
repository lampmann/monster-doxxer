/* ============================================================
   How plausible is this monster, for this party?

   A level 3 party is not fighting an ancient red dragon, and a level 17 party is
   not being menaced by a giant rat. Telling the tool who is at the table rules
   nothing out but shifts a lot of weight, and it costs the user two numbers.

   IT IS A PRIOR, NOT AN OBSERVATION. The user is not claiming anything about the
   monster — they are describing their own party. And it turns out a prior this
   broad has to be applied as a TIEBREAK rather than as a score, which the harness
   settled rather than taste: as a capped score bonus it was worth +0.4 points of
   top-5 when the DM had built the encounter by the book, and cost EIGHT when they
   had not. A band wide enough to be fair boosts thousands of monsters equally, so
   it carries almost no information once the evidence has spoken; narrowing it to a
   peak did not rescue it. As a tiebreak it only orders candidates the evidence has
   already declared identical, which is both common and free. See rank() in score.js
   and DESIGN.md.

   Nothing here ever rules anything out. DMs throw wildly out-of-band monsters at
   parties on purpose — the unwinnable fight is a classic move, and so is the trivial
   one that exists to make the party feel strong — and those are exactly the fights
   memorable enough that somebody goes looking them up afterwards.

   The band comes from the DMG's own encounter-building maths (p.82): XP thresholds
   per character by level, multiplied by the party, then read back through the
   XP-by-CR table. That is what a DM building an encounter is actually working
   from, so it is the right thing to invert.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* DMG p.82, XP thresholds per character: [easy, medium, hard, deadly]. */
  const THRESHOLDS = {
    1: [25, 50, 75, 100], 2: [50, 100, 150, 200], 3: [75, 150, 225, 400],
    4: [125, 250, 375, 500], 5: [250, 500, 750, 1100], 6: [300, 600, 900, 1400],
    7: [350, 750, 1100, 1700], 8: [450, 900, 1400, 2100], 9: [550, 1100, 1600, 2400],
    10: [600, 1200, 1900, 2800], 11: [800, 1600, 2400, 3600], 12: [1000, 2000, 3000, 4500],
    13: [1100, 2200, 3400, 5100], 14: [1250, 2500, 3800, 5700], 15: [1400, 2800, 4300, 6400],
    16: [1600, 3200, 4800, 7200], 17: [2000, 3900, 5900, 8800], 18: [2100, 4200, 6300, 9500],
    19: [2400, 4900, 7300, 10900], 20: [2800, 5700, 8500, 12700],
  };

  /* XP by challenge rating, DMG p.274. */
  const XP_BY_CR = [
    [0, 10], [0.125, 25], [0.25, 50], [0.5, 100], [1, 200], [2, 450], [3, 700], [4, 1100],
    [5, 1800], [6, 2300], [7, 2900], [8, 3900], [9, 5000], [10, 5900], [11, 7200], [12, 8400],
    [13, 10000], [14, 11500], [15, 13000], [16, 15000], [17, 18000], [18, 20000], [19, 22000],
    [20, 25000], [21, 33000], [22, 41000], [23, 50000], [24, 62000], [25, 75000], [26, 90000],
    [27, 105000], [28, 120000], [29, 135000], [30, 155000],
  ];

  const clampLevel = l => Math.max(1, Math.min(20, Math.round(Number(l) || 1)));

  function xpForCr(cr) {
    const n = Number(cr);
    if (!Number.isFinite(n)) return null;
    for (let i = 0; i < XP_BY_CR.length; i++) if (XP_BY_CR[i][0] >= n) return XP_BY_CR[i][1];
    return XP_BY_CR[XP_BY_CR.length - 1][1];
  }
  /* XP back to a CR, interpolated, so a budget lands between the table's rows rather
     than snapping to one. */
  function crForXp(xp) {
    if (!(xp > 0)) return 0;
    if (xp <= XP_BY_CR[0][1]) return 0;
    for (let i = 1; i < XP_BY_CR.length; i++) {
      const [c0, x0] = XP_BY_CR[i - 1], [c1, x1] = XP_BY_CR[i];
      if (xp <= x1) return c0 + (c1 - c0) * ((xp - x0) / ((x1 - x0) || 1));
    }
    return 30;
  }

  /* DMG p.82 again: several monsters are harder than their XP suggests, so the encounter's
     XP is multiplied before being compared to the budget. Inverted here — the multiplier
     divides the budget, which is what pushes each individual monster's plausible CR down
     as the fight gets more crowded. */
  function crowdMultiplier(count) {
    const n = Math.max(1, Math.round(Number(count) || 1));
    if (n === 1) return 1;
    if (n === 2) return 1.5;
    if (n <= 6) return 2;
    if (n <= 10) return 2.5;
    if (n <= 14) return 3;
    return 4;
  }

  /* `count` is how many creatures are in the whole fight, across every monster in the
     encounter. One ogre is a very different CR from one of eight ogres, and without this
     the tool would rank a lone-boss band against a horde and get both wrong.

     WHAT THIS DOES NOT KNOW is which of them is the boss. A fight of "one ogre and six
     goblins" gets one band covering all seven, rather than a high band for the ogre and a
     low one for the goblins — the tool has no way to tell, before it has identified them,
     which tab is the dangerous one. The band is wide enough to cover both, and it is a
     prior that only ever adds, so the cost of that imprecision is bounded. */
  /* The CR band a DM building for this party would be working in.

     `lo` is the easy threshold: below it a creature is a speed bump rather than an
     encounter. `hi` is deadly doubled, because a boss is routinely built past "deadly" —
     the threshold assumes a fight's worth of XP spread over several creatures. */
  function band(level, partySize, count) {
    const lvl = clampLevel(level);
    const n = Math.max(1, Math.min(10, Math.round(Number(partySize) || 4)));
    const total = Math.max(1, Math.round(Number(count) || 1));
    const share = crowdMultiplier(total) * total;
    const [easy, medium, , deadly] = THRESHOLDS[lvl];
    return {
      level: lvl, partySize: n, count: total, multiplier: crowdMultiplier(total),
      lo: crForXp(easy * n / share),
      centre: crForXp(medium * n * 1.5 / share),
      hi: crForXp(deadly * n * 2 / share),
    };
  }

  /* How plausible a CR is for that band, in [0,1].

     Flat 1 across the band itself — inside it, the DMG's own maths says every CR is a
     reasonable choice and there is nothing to distinguish them. Outside, it falls away
     smoothly rather than cutting off, and it falls away GENTLY going up: a DM is far more
     likely to throw something over-levelled at a party than to waste a session on
     something trivial, and the over-levelled fight is the one players go looking up
     afterwards. */
  function plausibility(crNum, b) {
    if (crNum == null || !b) return 0;
    if (crNum >= b.lo && crNum <= b.hi) return 1;
    if (crNum < b.lo) {
      // Below the band, measured in XP ratio so CR 1/8 vs CR 1 is not "one apart".
      const ratio = (xpForCr(crNum) || 1) / (xpForCr(b.lo) || 1);
      return Math.max(0, Math.min(1, ratio));
    }
    const ratio = (xpForCr(b.hi) || 1) / (xpForCr(crNum) || 1);
    return Math.max(0, Math.min(1, Math.pow(ratio, 0.6)));
  }

  /* A Map of key -> plausibility, the same shape the other whole-corpus scorers hand to
     rank(). Monsters with no CR at all score 0 and simply miss the bonus. */
  function crPlausibility(monsters, level, partySize, count) {
    const b = band(level, partySize, count);
    const out = new Map();
    (monsters || []).forEach(m => {
      const p = plausibility(m.crNum, b);
      if (p > 0) out.set(m.key, p);
    });
    return out;
  }

  function describeBand(b) {
    const fmt = cr => (cr < 1 ? (cr <= 0.125 ? "1/8" : cr <= 0.25 ? "1/4" : cr <= 0.5 ? "1/2" : "1")
      : String(Math.round(cr)));
    return `CR ${fmt(b.lo)}–${fmt(b.hi)}`;
  }

  return { THRESHOLDS, XP_BY_CR, xpForCr, crForXp, band, crowdMultiplier,
           plausibility, crPlausibility, describeBand };
});
