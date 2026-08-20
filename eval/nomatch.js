/* ============================================================
   The no-match confidence floor — handoff §7, first open question:

     "How should the tool handle a monster the GM built from scratch, where the
      correct answer is 'no match'? A confidence floor is needed, and the
      threshold must come from the harness."

   WHAT WAS THERE BEFORE. app.js flagged "nothing explains this" only when the top
   candidate scored at or below 1e-9 — the floor for "explains literally zero
   features". A homebrewed monster that happens to breathe fire, fly, and sit
   around CR 5 will match plenty of ordinary features by coincidence and sail
   past that floor while being answered with total confidence. The floor caught
   an almost-impossible case and missed the real one.

   THE ACTUAL QUESTION is comparative: does the top score we're seeing look like
   what a real match produces, or like what unrelated monsters produce when
   asked to explain observations that describe something not in the collection
   at all? That needs both distributions, not a hardcoded epsilon.

   THE EXPERIMENT. For each sampled monster M:

     PRESENT  Corrupt M into a party's observations, exactly as eval/run.js does,
              then rank the FULL corpus (M included) and keep the top score.
              This is "what a real match's winning score looks like."

     ABSENT   Rank the SAME observations against the corpus with M and every one
              of its reprints removed by name, and keep the top score. This is
              "what the best a coincidence can do, when the true answer is not
              in the book at all" — the direct simulation of a GM homebrew.

   F7 already normalises score to a comparable scale regardless of how much
   evidence a query carries (raw / supplied), which is what makes a single
   global threshold meaningful across queries of very different sizes rather
   than a number that would need recalibrating per query.

   Run:

     node eval/nomatch.js                measure the current threshold
     node eval/nomatch.js --n 800        bigger sample
     node eval/nomatch.js --show         print the score distributions in full
   ============================================================ */
"use strict";
const { load } = require("./corpus.js");
const CORRUPT = require("./corrupt.js");
const S = require("../src/score.js");
const APP = require("../src/appearance.js");
const NAMES = require("../src/names.js");

function parseArgs(argv) {
  const out = { n: 300, seed: 1, show: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n") out.n = Number(argv[++i]);
    else if (a === "--seed") out.seed = Number(argv[++i]);
    else if (a === "--show") out.show = true;
    else if (a === "--help" || a === "-h") { console.log(HELP); process.exit(0); }
  }
  return out;
}
const HELP = `eval/nomatch.js — calibrate the no-match confidence floor

  --n <count>   monsters to sample, each scored twice (default 300)
  --seed <int>  RNG seed
  --show        print the full sorted score lists, not just percentiles`;

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/* THE STRUCTURAL LIMIT ON THIS EXPERIMENT. Leave-one-out can only remove the exact
   monster, not "anything similar enough to be a reasonable answer" — that would be
   circular, since similarity is what the tool computes. A close cousin (Wolf's
   observations, Wolf removed, Dire Wolf still present) often explains the query
   nearly as well as the truth did, and correctly so: that is the tool finding the
   next-best real answer, not a calibration failure. Every "absent" observation in
   this file is drawn from a REAL monster, so something in the corpus can usually
   half-explain it — there is no way to synthesise "nothing like this exists at all"
   from a corpus of things that exist. So the ABSENT distribution's upper tail is
   expected to run high, and a threshold chosen purely to separate the two
   distributions is chasing that artifact as much as it is chasing genuine
   homebrew detection. */
function conservativeThreshold(present) {
  const sorted = [...present].sort((a, b) => a - b);
  // The 5th percentile of PRESENT: by construction, ~95% of genuine matches stay
  // above it. Costs real answers far less often than the separation-maximising cut,
  // in exchange for catching less of the (already dubious) absent tail.
  return percentile(sorted, 0.05);
}

/* Youden's J (TPR - FPR) at every candidate cut, over the pooled, sorted scores.
   Ties are broken toward the candidate that KEEPS more true matches confident —
   between two thresholds with equal separation, hiding fewer real answers behind
   the warning is the safer failure mode (F2's whole ethos: a miss should never
   cost more than it has to). */
function bestThreshold(present, absent) {
  const candidates = Array.from(new Set([...present, ...absent])).sort((a, b) => a - b);
  let best = { t: candidates[0] ?? 0, j: -Infinity, tpr: 0, fpr: 1 };
  candidates.forEach(t => {
    const tp = present.filter(s => s >= t).length;
    const fp = absent.filter(s => s >= t).length;
    const tpr = present.length ? tp / present.length : 0;
    const fpr = absent.length ? fp / absent.length : 0;
    const j = tpr - fpr;
    if (j > best.j || (j === best.j && tpr > best.tpr)) best = { t, j, tpr, fpr };
  });
  return best;
}

function rateAt(present, absent, t) {
  const tp = present.filter(s => s >= t).length;
  const fp = absent.filter(s => s >= t).length;
  return {
    tpr: present.length ? tp / present.length : 0,   // real matches kept confident
    fpr: absent.length ? fp / absent.length : 0,      // homebrew wrongly called confident
  };
}

function measure(monsters, rarity, opts) {
  const o = opts || {};
  const r = CORRUPT.rng(o.seed || 1);
  const pool = CORRUPT.shuffled(r, monsters);
  const n = Math.min(o.n || 300, pool.length);

  const present = [], absent = [];
  let unusable = 0;

  for (let i = 0; i < n; i++) {
    const m = pool[i];
    const c = CORRUPT.corruptViable(m, r, { vocab: o.vocab }, S.hasEvidence);
    if (!c) { unusable++; continue; }

    let scoreOpts = {};
    if (c.obs.appearance && o.appearanceIndex) {
      scoreOpts.appearanceScores = APP.appearanceScore(c.obs.appearance, o.appearanceIndex);
    }
    if (c.obs.heardName && o.nameIndex) {
      scoreOpts.nameScores = NAMES.nameScore(c.obs.heardName, o.nameIndex);
    }

    const rankedIn = S.rank(monsters, c.obs, rarity, scoreOpts);
    present.push(rankedIn.length ? rankedIn[0].score : 0);

    const nameWanted = m.name.toLowerCase();
    const withoutIt = monsters.filter(x => x.name.toLowerCase() !== nameWanted);
    const rankedOut = S.rank(withoutIt, c.obs, rarity, scoreOpts);
    absent.push(rankedOut.length ? rankedOut[0].score : 0);
  }

  return { present, absent, scored: present.length, unusable };
}

function main() {
  const args = parseArgs(process.argv);
  const { monsters, appearanceIndex, nameIndex } = load({});
  const rarity = S.buildRarity(monsters);

  console.log(`sampling ${args.n} monsters, scoring each twice (present / absent)...`);
  const { present, absent, scored, unusable } = measure(monsters, rarity,
    Object.assign({}, args, { appearanceIndex, nameIndex }));
  console.log(`scored ${scored}, ${unusable} unusable (no viable observation)\n`);

  const sp = [...present].sort((a, b) => a - b);
  const sa = [...absent].sort((a, b) => a - b);
  const row = (label, arr) => console.log(`  ${label.padEnd(9)}` +
    [0, 0.25, 0.5, 0.75, 1].map(p => percentile(arr, p).toFixed(3).padStart(8)).join(""));

  console.log("  score distribution           min      p25      p50      p75      max");
  row("present", sp);
  row("absent", sa);
  console.log();

  const old = rateAt(present, absent, 1e-9);
  console.log(`  the old floor (score > 1e-9):`);
  console.log(`    real matches still called confident:        ${(old.tpr * 100).toFixed(1)}%`);
  console.log(`    homebrew wrongly called confident:          ${(old.fpr * 100).toFixed(1)}%  <- the actual bug`);
  console.log();

  const best = bestThreshold(present, absent);
  console.log(`  separation-maximising floor (Youden's J): ${best.t.toFixed(4)}`);
  console.log(`    real matches still called confident:        ${(best.tpr * 100).toFixed(1)}%`);
  console.log(`    homebrew correctly called out as unsure:     ${((1 - best.fpr) * 100).toFixed(1)}%`);
  console.log(`    separation (J):                              ${best.j.toFixed(3)}`);
  console.log();

  const cons = conservativeThreshold(present);
  const cr = rateAt(present, absent, cons);
  console.log(`  conservative floor (5th pct of real matches): ${cons.toFixed(4)}`);
  console.log(`    real matches still called confident:        ${(cr.tpr * 100).toFixed(1)}%`);
  console.log(`    homebrew correctly called out as unsure:     ${((1 - cr.fpr) * 100).toFixed(1)}%`);
  console.log();

  console.log(`  HOW TO READ THIS. J of ${best.j.toFixed(2)} is weak separation, and much of the`);
  console.log(`  overlap is structural rather than a scoring fault: removing one monster`);
  console.log(`  leaves its cousins, which explain the query legitimately. So the`);
  console.log(`  separation-maximising cut is partly fitted to that artifact. The`);
  console.log(`  conservative floor is the defensible one — it is calibrated only against`);
  console.log(`  the PRESENT distribution, which has no such problem, and it answers a`);
  console.log(`  question this data can actually settle: "is this score unusually low for`);
  console.log(`  a genuine match?" rather than "is this monster homebrew?".`);

  if (args.show) {
    console.log("\n  present (sorted):", sp.map(x => x.toFixed(3)).join(", "));
    console.log("\n  absent  (sorted):", sa.map(x => x.toFixed(3)).join(", "));
  }
}

if (require.main === module) main();
module.exports = { measure, bestThreshold, rateAt };
