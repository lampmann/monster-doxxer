/* Scorer tests — F1, F2, F3, F7.

   These pin BEHAVIOUR, not constants. The numbers in TUNING are provisional
   until the evaluation harness picks them, so asserting "this scores 0.62"
   would just freeze a guess. What must stay true regardless of tuning:
   rare evidence outranks common evidence, an unmentioned feature is free, a
   contradiction is not, and query size doesn't change the scale.

   Run: node tests/score.test.js
*/
"use strict";
const S = require("../src/score.js");
const { assert, assertEqual, section, report } = require("./harness.js");

/* A small synthetic corpus. Deliberately hand-built rather than sampled from real data:
   the rarity maths is what's under test, and it's only checkable when you know the counts.
   99 mundane beasts with darkvision, one thing with tremorsense + burrow. */
function corpus() {
  const beasts = [];
  for (let i = 0; i < 99; i++) {
    beasts.push({
      key: "Beast " + i + "|T", name: "Beast " + i, source: "T",
      type: "beast", typeTags: [], size: ["medium"], speeds: { walk: 30 }, hover: false,
      senseTags: ["Darkvision"], conditionImmune: [], traitTags: [], actionTags: [], damageTags: [],
      resist: [], immune: [], vulnerable: [], symptoms: [], partial: false, crNum: 1, ac: 12, hpAvg: 20,
    });
  }
  beasts.push({
    key: "Delver|T", name: "Delver", source: "T",
    type: "aberration", typeTags: [], size: ["huge"], speeds: { walk: 30, burrow: 30 }, hover: false,
    senseTags: ["Tremorsense", "Darkvision"], conditionImmune: [], traitTags: ["Regeneration"],
    actionTags: [], damageTags: [], resist: [], immune: ["acid"], vulnerable: [],
    symptoms: ["healed-between-rounds"], partial: false, crNum: 9, ac: 18, hpAvg: 200,
  });
  return beasts;
}

const MONS = corpus();
const R = S.buildRarity(MONS);

/* ---------- F1: rarity ---------- */
section("F1 — rarity weighting");
{
  assertEqual("the corpus size is what the table normalises against", R.total, 100);
  const common = R.weight(S.featureKey("sense", "darkvision"));   // all 100 have it
  const rare = R.weight(S.featureKey("sense", "tremorsense"));    // 1 of 100
  assertEqual("a feature EVERY monster has is worth exactly nothing, which is the point of F1", common, 0);
  assert("a feature one monster in a hundred has is worth a lot", rare > 4);
  assert("...and no weight is ever negative", common >= 0 && rare >= 0);

  const unseen = R.weight(S.featureKey("sense", "blindsight"));
  assert("a feature NOTHING has is finite rather than infinite", Number.isFinite(unseen));
  assert("...and is capped so one freak tag can't outvote the rest", unseen <= S.TUNING.maxWeight);

  // A monster listing the same feature twice must not make it look commoner than it is.
  const dupCorpus = MONS.concat([{
    key: "Dup|T", name: "Dup", source: "T", type: "beast", typeTags: [], size: ["medium", "medium"],
    speeds: {}, senseTags: ["Darkvision", "Darkvision"], conditionImmune: [], traitTags: [],
    actionTags: [], damageTags: [], resist: [], immune: [], vulnerable: [], symptoms: [], partial: false,
  }]);
  // 100 monsters already have darkvision; Dup lists it twice and must still add exactly 1.
  assertEqual("a feature listed twice on one monster adds one to its count, not two",
    S.buildRarity(dupCorpus).counts[S.featureKey("sense", "darkvision")], 101);
}

/* ---------- F2: asymmetry ---------- */
section("F2 — asymmetry: unmentioned is free, contradiction is not");
{
  // The Delver has Regeneration, acid immunity, huge size and a burrow speed. Report only ONE
  // of them: the four the player never mentioned must not count against it.
  const justBurrow = S.rank(MONS, { movement: ["burrow"] }, R, { limit: 1 })[0];
  assertEqual("one rare observation is enough to surface the right monster", justBurrow.name, "Delver");
  assertEqual("...and nothing it has but the player didn't mention counts against it", justBurrow.against.length, 0);

  // Now contradict it. Same query plus a damage interaction the Delver gets wrong.
  const contradicted = S.rank(MONS, { movement: ["burrow"], damage: { acid: "vulnerable" } }, R, { limit: 1 })[0];
  assert("a contradiction is recorded against the candidate", contradicted.against.length > 0);
  assert("...and drags the score below the clean match", contradicted.score < justBurrow.score);
  assert("...naming what the statblock actually says", /immune/.test(contradicted.against[0].why));
}

section("F2 — the damage cost matrix is graded, not boolean");
{
  const w = st => S.rank(MONS, { movement: ["burrow"], damage: { acid: st } }, R, { limit: 1 })[0].score;
  const exact = w("immune"), near = w("resistant"), far = w("vulnerable");
  assert("reporting the exact interaction scores highest", exact > near);
  assert("...an adjacent one costs a little", near > far);
  assert("...and the opposite one costs the most", far < near);
  assertEqual("every state in the matrix has a cost for every other state",
    S.DMG_STATES.every(a => S.DMG_STATES.every(b => typeof S.DMG_COST[a][b] === "number")), true);
  assertEqual("...and matching itself is always free", S.DMG_STATES.every(a => S.DMG_COST[a][a] === 0), true);
  assert("the matrix is symmetric — being wrong costs the same in either direction",
    S.DMG_STATES.every(a => S.DMG_STATES.every(b => S.DMG_COST[a][b] === S.DMG_COST[b][a])));
}

/* ---------- F7: normalisation ---------- */
section("F7 — evidence normalisation");
{
  const one = S.rank(MONS, { movement: ["burrow"] }, R, { limit: 1 })[0];
  const many = S.rank(MONS, {
    movement: ["burrow"], senses: ["tremorsense"], size: "huge",
    type: "aberration", symptoms: ["healed-between-rounds"],
  }, R, { limit: 1 })[0];
  assertEqual("both queries find the same monster", one.name, many.name);
  assert("a perfect 1-field match and a perfect 5-field match score alike", Math.abs(one.score - many.score) < 1e-9);
  assert("...both at the ceiling, since nothing contradicted", Math.abs(many.score - 1) < 1e-9);
  assert("the raw scores differ — it's the normalisation doing the work", many.raw > one.raw);
}

/* ---------- ranking behaviour ---------- */
section("ranking");
{
  const all = S.rank(MONS, { movement: ["burrow"] }, R);
  assertEqual("every monster is ranked — nothing is filtered out", all.length, MONS.length);
  assert("...scores descend", all.every((r, i) => i === 0 || all[i - 1].score >= r.score));
  assert("a monster with no bearing on the query still scores, rather than being dropped",
    all.some(r => r.name === "Beast 0"));

  const srcFiltered = S.rank(MONS.concat([Object.assign({}, MONS[0], { key: "X|OTHER", name: "X", source: "OTHER" })]),
    { movement: ["burrow"] }, R, { sources: ["T"] });
  assert("source filtering is the one legitimate filter (F16)", !srcFiltered.some(r => r.source === "OTHER"));

  assert("a query with nothing in it is reported as such rather than ranked", !S.hasEvidence({}));
  assert("...and one with a single field is not", S.hasEvidence({ movement: ["burrow"] }));
  assert("...nor is one with only a damage interaction", S.hasEvidence({ damage: { fire: "immune" } }));
}

section("explanation (F14)");
{
  const r = S.rank(MONS, { movement: ["burrow"], senses: ["tremorsense"], damage: { acid: "normal" } }, R, { limit: 1 })[0];
  assert("the result lists what argued for it", r.for.length >= 2);
  assert("...strongest first", r.for.every((x, i) => i === 0 || r.for[i - 1].weight >= x.weight));
  assert("...and what argued against", r.against.length >= 1);
  assert("...with a reason a human can check", r.against.every(x => typeof x.why === "string" && x.why.length > 5));
  assert("every contribution names the facet it came from", r.for.every(x => S.FACET_KEYS.includes(x.facet) || x.facet === "damage"));
}

section("robustness");
{
  const weird = { movement: ["  BURROW  "], senses: [null, ""], type: "Aberration" };
  const r = S.rank(MONS, weird, R, { limit: 1 })[0];
  assertEqual("input is case- and whitespace-insensitive", r.name, "Delver");
  assert("...and empty values in a list are ignored rather than scored", r.for.length === 2);
  const bogus = S.rank(MONS, { damage: { fire: "sort of resistant?" } }, R, { limit: 1 })[0];
  assertEqual("an unrecognised damage state is skipped, not guessed at", bogus.for.length + bogus.against.length, 0);
}

/* ---------- F16 ---------- */
section("F16 — source filtering, the one legitimate filter");
{
  const withOther = MONS.concat([
    Object.assign({}, MONS[MONS.length - 1], { key: "Delver|OTHER", name: "Delver", source: "OTHER" }),
    Object.assign({}, MONS[0], { key: "Spoiler|ADV", name: "Spoiler", source: "ADV" }),
  ]);
  const obs = { movement: ["burrow"] };
  const sources = r => new Set(r.map(x => x.source));

  const all = S.rank(withOther, obs, R);
  assertEqual("with no filter every source is ranked", sources(all).size, 3);

  const inc = S.rank(withOther, obs, R, { sources: { include: ["T"] } });
  assertEqual("include keeps only the named sources", [...sources(inc)], ["T"]);
  assert("...and still ranks everything within them", inc.length === MONS.length);

  const exc = S.rank(withOther, obs, R, { sources: { exclude: ["ADV"] } });
  assert("exclude drops the named source", !sources(exc).has("ADV"));
  assert("...and leaves every other source alone — the spoiler case must not need you to list 106 books",
    sources(exc).has("T") && sources(exc).has("OTHER"));

  const both = S.rank(withOther, obs, R, { sources: { include: ["T", "ADV"], exclude: ["ADV"] } });
  assert("exclude beats include, because wrongly showing a monster spoils and wrongly hiding one doesn't",
    !sources(both).has("ADV") && sources(both).has("T"));

  assertEqual("a bare array still means include, as it did before",
    [...sources(S.rank(withOther, obs, R, { sources: ["T"] }))], ["T"]);
  assertEqual("an empty filter is no filter rather than an empty result",
    S.rank(withOther, obs, R, { sources: { include: [], exclude: [] } }).length, withOther.length);
  assertEqual("...and so is a missing one", S.rank(withOther, obs, R, {}).length, withOther.length);

  assert("source matching ignores case, since the user types these",
    S.rank(withOther, obs, R, { sources: { include: ["  t  "] } }).length === MONS.length);

  // Filtering must not change what the evidence is worth: two players who saw the same
  // monster should read the same score, whichever books they happen to own.
  const unfiltered = S.rank(withOther, obs, R, { limit: 1 })[0];
  const filtered = S.rank(withOther, obs, R, { sources: { include: ["T"] }, limit: 1 })[0];
  assertEqual("filtering the corpus does not re-price the evidence", unfiltered.score, filtered.score);

  assertEqual("a filter naming only unknown sources yields nothing, rather than silently ignoring itself",
    S.rank(withOther, obs, R, { sources: { include: ["NOPE"] } }).length, 0);
}

/* ---------- the tie-break ---------- */
section("the legacy prior — how a tie is settled");
{
  const dated = { mm: "2014-09-30", xmm: "2024-09-17", new1: "2023-01-01" };
  const base = { type: "beast", typeAlt: [], typeTags: [], size: ["medium"], speeds: { walk: 30 },
    senseTags: [], conditionImmune: [], traitTags: [], actionTags: [], damageTags: [],
    resist: [], immune: [], vulnerable: [], symptoms: [], partial: false };
  const mk = (name, source, srd) => Object.assign({ name, source, srd, key: name + "|" + source }, base);

  const corpus = [
    mk("Troll", "MM", true), mk("Troll", "XMM", false),
    mk("Zzz Newcomer", "NEW1", false), mk("Aaa Newcomer", "NEW1", false),
    mk("Beholder", "MM", false),
  ];
  const legacy = S.buildLegacy(corpus, dated);
  const order = arr => arr.slice().sort(legacy.compare).map(x => x.name + "/" + x.source);

  assertEqual("an SRD monster outranks everything else",
    order(corpus)[0], "Troll/MM");
  assert("an older creature outranks a newer one",
    order([mk("Zzz Newcomer", "NEW1", false), mk("Beholder", "MM", false)])[0] === "Beholder/MM");
  assertEqual("the oldest PRINTING of the same creature comes first, since this targets 5e 2014",
    order([mk("Troll", "XMM", false), mk("Troll", "MM", false)])[0], "Troll/MM");
  assert("...and it is deterministic when nothing else separates them",
    order([mk("Aaa Newcomer", "NEW1", false), mk("Zzz Newcomer", "NEW1", false)])[0] === "Aaa Newcomer/NEW1");

  assertEqual("a creature reprinted more often is counted as such", legacy.printings["troll"], 2);
  assertEqual("...and its legacy is the date it FIRST appeared, not this printing's",
    legacy.firstSeen["troll"], "2014-09-30");

  // Without the optional date files the prior still has to produce an order.
  const undated = S.buildLegacy(corpus, null);
  assertEqual("with no dates at all it still settles ties",
    corpus.slice().sort(undated.compare)[0].name, "Troll");

  // The load-bearing property: a prior must never outrank evidence.
  const R2 = S.buildRarity(corpus);
  const ranked = S.rank(corpus, { type: "beast", size: "medium" }, R2, { legacy });
  const scores = ranked.map(r => r.score);
  assert("results are still ordered by score first",
    scores.every((x, i) => i === 0 || scores[i - 1] >= x));
}

section("collapsing reprints");
{
  const base = { type: "beast", typeAlt: [], typeTags: [], size: ["medium"], speeds: { walk: 30 },
    senseTags: [], conditionImmune: [], traitTags: [], actionTags: [], damageTags: [],
    resist: [], immune: [], vulnerable: [], symptoms: [], partial: false };
  const mk = (name, source) => Object.assign({ name, source, key: name + "|" + source }, base);
  const corpus = [mk("Ghost", "MM"), mk("Ghost", "XMM"), mk("Wight", "MM")];
  const R2 = S.buildRarity(corpus);

  const loose = S.rank(corpus, { type: "beast" }, R2);
  assertEqual("uncollapsed, the same creature takes two slots", loose.length, 3);

  const tight = S.rank(corpus, { type: "beast" }, R2, { collapseByName: true });
  assertEqual("collapsed, it takes one", tight.length, 2);
  assertEqual("...the surviving row is the one the tie-break preferred", tight[0].name, "Ghost");
  assertEqual("...and the other printings are recorded rather than hidden", tight[0].alsoIn, ["XMM"]);
  assert("a creature with one printing gains no alsoIn",
    !tight.find(r => r.name === "Wight").alsoIn);
}


/* ---------- the no-match confidence floor (handoff §7) ---------- */
section("the no-match confidence floor");
{
  const r = s => [{ score: s, name: "X", key: "X|T" }];

  assertEqual("an empty ranking is 'none'", S.confidence([]), "none");
  assertEqual("...and so is a nonexistent one", S.confidence(null), "none");
  assertEqual("a leader explaining literally nothing is 'none'",
    S.confidence(r(0)), "none");

  /* The bug this feature exists for: the OLD check only caught a score of ~0, so a
     homebrew that coincidentally matches a few ordinary features was answered with
     full confidence. Measured at 99.5% of simulated homebrew (eval/nomatch.js). */
  assertEqual("a weak-but-nonzero leader is 'low', not confident",
    S.confidence(r(0.2)), "low");
  assertEqual("...right up to the floor", S.confidence(r(S.TUNING.noMatchThreshold - 1e-6)), "low");
  assertEqual("at the floor it is trusted", S.confidence(r(S.TUNING.noMatchThreshold)), "ok");
  assertEqual("a strong leader is 'ok'", S.confidence(r(0.9)), "ok");

  assert("the floor sits where genuine matches mostly are, not at zero",
    S.TUNING.noMatchThreshold > 0.1 && S.TUNING.noMatchThreshold < 1);
  // Only the leader decides; a long tail of weak candidates is the normal case.
  assertEqual("only the top score is consulted",
    S.confidence([{ score: 0.9 }, { score: 0.01 }]), "ok");
}

report("score");
