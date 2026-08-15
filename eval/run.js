/* ============================================================
   The evaluation harness — handoff §6.

     node eval/run.js                        measure the current constants
     node eval/run.js --n 800 --seed 7       bigger sample, different draw
     node eval/run.js --show 10              print the worst failures
     node eval/run.js --sweep missFactor     try values of one constant
     node eval/run.js --ablate               how much each facet is worth

   WHAT IS BEING MEASURED. Sample N monsters, corrupt each into the observations a
   party would plausibly have, rank the whole corpus, and ask where the true answer
   landed. Top-5 recall is the headline because a ranked shortlist of five is what
   the tool actually shows.

   ON DUPLICATES. The corpus holds ~4,500 records for far fewer distinct creatures:
   the same monster is reprinted across sourcebooks, and "Goblin (MM)" and
   "Goblin (XMM)" are the same answer to a player. Scoring those as misses would
   measure 5e.tools' reprint policy rather than the ranker, so recall is reported
   BY NAME. The strict by-key number is printed alongside, and the gap between them
   is the reprint rate, not an error bar.

   ON WHAT THE NUMBER IS WORTH. Every observation the harness generates is true of
   the statblock it came from, and the true answer is always somewhere in the corpus.
   Real players misremember, and real DMs write monsters that are in no book. See
   corrupt.js's `unmodelled` list. These figures are an upper bound; the ordering
   between two tunings is the trustworthy part, not the absolute value.
   ============================================================ */
"use strict";
const { load } = require("./corpus.js");
const CORRUPT = require("./corrupt.js");
const S = require("../src/score.js");

/* ---------- args ---------- */
function parseArgs(argv) {
  const out = { n: 400, seed: 1, show: 0, sweep: "", ablate: false, quiet: false, stray: 0, swap: 1, crShift: 0, mode: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--n") out.n = Number(next());
    else if (a === "--seed") out.seed = Number(next());
    else if (a === "--show") out.show = Number(next());
    else if (a === "--sweep") out.sweep = next();
    else if (a === "--ablate") out.ablate = true;
    else if (a === "--stray") out.stray = Number(next());
    else if (a === "--swap") out.swap = Number(next());
    else if (a === "--cr-shift") out.crShift = Number(next());
    else if (a === "--numeric") out.mode = next();
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--help" || a === "-h") { console.log(HELP); process.exit(0); }
  }
  return out;
}
const HELP = `eval/run.js — corrupt real statblocks, measure top-5 recall

  --n <count>       monsters to sample (default 400)
  --seed <int>      RNG seed; same seed is the same sample (default 1)
  --show <count>    print the worst failures, with what argued against the truth
  --sweep <const>   sweep one TUNING constant and print recall at each value
  --ablate          drop one observation facet at a time to price each one
  --stray <0..1>    rate at which the party misremembers a feature it never saw
  --swap <0..1>     rate at which a query carries a wrong damage interaction
  --cr-shift <n>    CR steps the DM rebuilt the monster by (tests F5)
  --numeric <mode>  hybrid | raw | residual | off
  --quiet           results only`;

/* ---------- one measurement ----------
   The sample is drawn from a fresh RNG per run so that changing a tuning constant
   compares like with like: same monsters, same corruptions, different scorer. */
function measure(monsters, rarity, opts) {
  const o = opts || {};
  const r = CORRUPT.rng(o.seed || 1);
  const pool = CORRUPT.shuffled(r, monsters);
  const corruptOpts = Object.assign({ vocab: o.vocab }, o.corrupt);
  const n = Math.min(o.n || 400, pool.length);

  const byName = { 1: 0, 5: 0, 20: 0 };
  const byKey = { 1: 0, 5: 0, 20: 0 };
  let scored = 0, unusable = 0, mrr = 0;
  const ranks = [];
  const failures = [];

  for (let i = 0; i < n; i++) {
    const m = pool[i];
    const c = CORRUPT.corruptViable(m, r, corruptOpts, S.hasEvidence);
    if (!c) { unusable++; continue; }

    /* Ablation: withhold one facet from the query the party "has", to price it.
       Done after corruption rather than inside it so the RNG draw is identical
       across ablations — otherwise every run samples different monsters and the
       comparison measures the sampler. */
    if (o.drop) delete c.obs[o.drop];
    if (!S.hasEvidence(c.obs)) { unusable++; continue; }

    const ranked = S.rank(monsters, c.obs, rarity, o.score);
    const nameWanted = m.name.toLowerCase();
    let rankName = -1, rankKey = -1;
    for (let j = 0; j < ranked.length; j++) {
      if (rankName < 0 && ranked[j].name.toLowerCase() === nameWanted) rankName = j + 1;
      if (rankKey < 0 && ranked[j].key === m.key) rankKey = j + 1;
      if (rankName > 0 && rankKey > 0) break;
    }

    scored++;
    ranks.push(rankName);
    mrr += rankName > 0 ? 1 / rankName : 0;
    [1, 5, 20].forEach(k => {
      if (rankName > 0 && rankName <= k) byName[k]++;
      if (rankKey > 0 && rankKey <= k) byKey[k]++;
    });

    if (o.show && (rankName < 0 || rankName > 5)) {
      const truth = ranked.find(x => x.key === m.key);
      failures.push({
        name: m.name, source: m.source, rank: rankName, cr: m.cr,
        top: ranked.slice(0, 3).map(x => `${x.name} (${x.score.toFixed(3)})`),
        truthScore: truth ? truth.score : null,
        against: truth ? truth.against.slice(0, 3) : [],
        notes: c.notes,
        obs: c.obs,
      });
    }
  }

  ranks.sort((a, b) => (a < 0 ? Infinity : a) - (b < 0 ? Infinity : b));
  const pct = x => (scored ? (100 * x / scored) : 0);
  return {
    scored, unusable,
    top1: pct(byName[1]), top5: pct(byName[5]), top20: pct(byName[20]),
    keyTop1: pct(byKey[1]), keyTop5: pct(byKey[5]), keyTop20: pct(byKey[20]),
    mrr: scored ? mrr / scored : 0,
    medianRank: ranks.length ? ranks[Math.floor(ranks.length / 2)] : -1,
    failures: failures.sort((a, b) => (b.rank < 0 ? Infinity : b.rank) - (a.rank < 0 ? Infinity : a.rank)),
  };
}

const line = res =>
  `top-1 ${res.top1.toFixed(1)}%  top-5 ${res.top5.toFixed(1)}%  top-20 ${res.top20.toFixed(1)}%  ` +
  `MRR ${res.mrr.toFixed(3)}  median rank ${res.medianRank}`;

/* Every mode builds its options here, so a flag can never apply in one mode and be
   silently ignored in another. */
function opts(args, extra) {
  return Object.assign({
    n: args.n, seed: args.seed, vocab: args.vocab,
    corrupt: { strayRate: args.stray, swapRate: args.swap,
               crShift: args.crShift, numerics: args.numerics },
    numerics: args.numerics,
    score: { numerics: args.numerics, numericMode: args.mode || undefined },
  }, extra || {});
}

/* ---------- modes ---------- */

/* Sweep one constant. Same seed throughout, so every value sees the same sample and
   the same corruptions — the only thing that moves is the scorer. */
function sweep(monsters, rarity, args, key) {
  const GRIDS = {
    missFactor: [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.3],
    maxWeight: [4, 6, 8, 10, 12, 99],
    minSymptomConfidence: [0, 0.1, 0.25, 0.5, 0.75, 1],
    unmentionedFactor: [0, 0.02, 0.05, 0.1, 0.2],
    partialPenalty: [0.7, 0.8, 0.9, 1.0],
    damageCostFactor: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
  };
  const grid = GRIDS[key];
  if (!grid) {
    console.log(`no grid for "${key}". Sweepable: ${Object.keys(GRIDS).join(", ")}`);
    process.exit(1);
  }
  const original = S.TUNING[key];
  console.log(`\nsweeping ${key} (current ${original}), n=${args.n} seed=${args.seed}\n`);
  const rows = [];
  grid.forEach(v => {
    S.TUNING[key] = v;
    // maxWeight feeds the rarity table, which is built once — rebuild it or the sweep
    // measures nothing at all.
    const rr = key === "maxWeight" ? S.buildRarity(monsters) : rarity;
    const res = measure(monsters, rr, opts(args));
    rows.push({ v, res });
    console.log(`  ${key} = ${String(v).padEnd(6)}  ${line(res)}`);
  });
  S.TUNING[key] = original;
  const best = rows.slice().sort((a, b) => b.res.top5 - a.res.top5 || b.res.mrr - a.res.mrr)[0];
  console.log(`\n  best top-5 at ${key} = ${best.v} (${best.res.top5.toFixed(1)}%), currently ${original}`);
  const cur = rows.find(x => x.v === original);
  if (cur && Math.abs(cur.res.top5 - best.res.top5) < 0.5) {
    console.log("  the current value is within noise of the best — leave it alone.");
  }
}

/* Price each facet by removing it. A facet whose removal costs nothing is not
   earning its place in the query form. */
function ablate(monsters, rarity, args) {
  const FACETS = ["symptoms", "movement", "senses", "condImmune", "type", "size", "damage", "damageDealt", "typeTags"];
  const base = measure(monsters, rarity, opts(args));
  console.log(`\nablation, n=${args.n} seed=${args.seed}`);
  console.log(`  everything            ${line(base)}\n`);
  const rows = FACETS.map(f => {
    const res = measure(monsters, rarity, opts(args, { drop: f }));
    return { f, res, cost: base.top5 - res.top5 };
  });
  rows.sort((a, b) => b.cost - a.cost);
  rows.forEach(({ f, res, cost }) =>
    console.log(`  without ${f.padEnd(13)} ${line(res)}   (-${cost.toFixed(1)} pts)`));
  console.log("\n  a facet costing ~0 is not pulling its weight in the query form.");
}

/* ---------- main ---------- */
function main() {
  const args = parseArgs(process.argv);
  const { monsters } = load({ quiet: args.quiet });
  const rarity = S.buildRarity(monsters);
  args.vocab = CORRUPT.buildVocab(monsters);
  args.numerics = S.buildNumerics(monsters);

  if (args.sweep) return sweep(monsters, rarity, args, args.sweep);
  if (args.ablate) return ablate(monsters, rarity, args);

  const res = measure(monsters, rarity, opts(args, { show: args.show }));

  console.log(`\nsample ${res.scored} monsters, seed ${args.seed}` +
    (res.unusable ? `  (${res.unusable} too featureless to query)` : ""));
  console.log(`  by name  ${line(res)}`);
  console.log(`  by key   top-1 ${res.keyTop1.toFixed(1)}%  top-5 ${res.keyTop5.toFixed(1)}%  ` +
    `top-20 ${res.keyTop20.toFixed(1)}%   (same creature, different printing, counts as a miss)`);

  if (args.show) {
    console.log(`\nworst ${Math.min(args.show, res.failures.length)} failures:`);
    res.failures.slice(0, args.show).forEach(f => {
      console.log(`\n  ${f.name} (${f.source}, CR ${f.cr}) — ranked ${f.rank < 0 ? "nowhere" : "#" + f.rank}` +
        (f.truthScore != null ? `, score ${f.truthScore.toFixed(3)}` : ""));
      console.log(`    top: ${f.top.join(", ")}`);
      if (f.notes.length) console.log(`    corruption: ${f.notes.join("; ")}`);
      const o = f.obs;
      const shown = Object.keys(o).filter(k => k !== "damage")
        .map(k => `${k}=${JSON.stringify(o[k])}`).join(" ");
      console.log(`    observed: ${shown}${o.damage ? " damage=" + JSON.stringify(o.damage) : ""}`);
      f.against.forEach(a => console.log(`    against: ${a.facet} ${a.value} (${a.weight}) — ${a.why}`));
    });
  }

  if (!args.quiet) {
    console.log("\nnot modelled by this harness (so these numbers are an upper bound):");
    CORRUPT.UNMODELLED.forEach(u => console.log("  - " + u));
  }
}

if (require.main === module) main();
module.exports = { measure, parseArgs };
