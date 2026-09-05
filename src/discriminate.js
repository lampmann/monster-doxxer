/* ============================================================
   F13 — discriminating tests.

   "Hit it with radiant damage to separate wight from ghoul."

   This is the feature that turns the tool from a lookup into something usable
   mid-combat. Ranking alone tells a party what it probably fought; this tells
   them what to DO on their next turn to find out.

   It matters more than it looks, because ties are the normal case. Three or four
   observations routinely leave a dozen candidates on identical scores — the UI
   says so — and at that point the ranking has nothing left to offer. What it can
   still do is name the single cheapest question that splits the field.

   HOW IT WORKS. Take the leading candidates and treat their scores as a rough
   probability distribution. For each test the party could actually run, partition
   those candidates by the outcome the test would produce, and compute the expected
   reduction in entropy — standard information gain. A test that splits twelve
   candidates six/six is worth a whole bit; one that separates a single oddity from
   eleven others is worth almost nothing; one every candidate answers the same way
   is worth exactly zero and must never be suggested.

   WHAT COUNTS AS A TEST. Only things a party can do on purpose, in about a round.
   That constraint is doing real work: "does it have a burrow speed" splits the
   field beautifully and is useless advice, because you cannot make a monster
   burrow. You CAN hit it with radiant damage, try to frighten it, or watch to see
   whether it heals. So:

     damage      hit it with a given type. Four outcomes, always available.
     condition   try to charm/frighten/poison it. Two outcomes.
     trait       watch for a specific named trait from the catalogue in
                 src/traits.js — every entry there is something a party can
                 watch for, so none need a testable-style flag to filter them.

   ON THE PROBABILITIES. The scores are normalised evidence, not log-likelihoods,
   so turning them into a distribution is a judgement call. It is a small one: the
   ranking of TESTS is almost entirely driven by how candidates partition, not by
   their exact weights, and the case this feature exists for is the one where the
   candidates are tied and the distribution is uniform anyway.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const norm = v => String(v == null ? "" : v).trim().toLowerCase();

  const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning",
    "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
  const CONDITIONS = ["charmed", "frightened", "poisoned", "paralyzed", "petrified",
    "stunned", "grappled", "restrained", "prone", "exhaustion", "blinded", "deafened"];

  /* How practical each kind of test is at a table, as a multiplier on its information
     gain. Anyone can swing a weapon; landing a specific condition needs the right spell
     and a failed save; watching for an observable costs nothing but may take a round to
     show. These are ordering nudges between near-equal tests, not scoring. */
  const PRACTICALITY = { damage: 1.0, condition: 0.8, trait: 0.85 };

  const CONDITION_VERB = {
    charmed: "Charmed", frightened: "Frightened", poisoned: "Poisoned",
    paralyzed: "Paralyzed", petrified: "Petrified", stunned: "Stunned",
    grappled: "Grappled", restrained: "Restrained", prone: "Prone",
    exhaustion: "Exhaustion", blinded: "Blinded", deafened: "Deafened",
  };

  /* ---------- the candidate set ---------- */

  /* Scores to a distribution. Negative scores mean the candidate actively contradicts
     the evidence and should carry no weight; everything else is proportional. Falls back
     to uniform when nothing is positive, which is the honest reading of "we have no idea". */
  function probabilities(results) {
    const raw = results.map(r => Math.max(0, r.score));
    const total = raw.reduce((a, b) => a + b, 0);
    if (total <= 0) return raw.map(() => 1 / (raw.length || 1));
    return raw.map(x => x / total);
  }

  function entropy(ps) {
    let h = 0;
    ps.forEach(p => { if (p > 0) h -= p * Math.log2(p); });
    return h;
  }

  /* ---------- what each test would reveal ---------- */

  function damageOutcome(m, type) {
    const t = norm(type);
    if ((m.immune || []).some(d => norm(d) === t)) return "immune";
    if ((m.resist || []).some(d => norm(d) === t)) return "resistant";
    if ((m.vulnerable || []).some(d => norm(d) === t)) return "vulnerable";
    return "normal";
  }
  const conditionOutcome = (m, cond) =>
    (m.conditionImmune || []).some(c => norm(c) === norm(cond)) ? "immune" : "affected";
  const traitOutcome = (m, key) => ((m.traitNames || []).includes(key) ? "yes" : "no");

  function outcomeOf(test, m) {
    if (test.kind === "damage") return damageOutcome(m, test.value);
    if (test.kind === "condition") return conditionOutcome(m, test.value);
    return traitOutcome(m, test.value);
  }

  /* ---------- phrasing ---------- */

  /* Singular and plural, because "Baalzebul take half" is the kind of wrongness that
     makes a reader distrust the number next to it. */
  const DAMAGE_PHRASE = {
    immune: ["is immune", "are immune"],
    resistant: ["is resistant", "are resistant"],
    normal: ["takes it normally", "take it normally"],
    vulnerable: ["is vulnerable", "are vulnerable"],
  };
  const CONDITION_PHRASE = { immune: ["can't be", "can't be"], affected: ["can be", "can be"] };
  const TRAIT_PHRASE = { yes: ["has it", "have it"], no: ["doesn't", "don't"] };

  /* The gloss, then the name — same order the trait catalogue itself uses, and for the
     same reason: the gloss is the thing to actually watch for, the name is what to call
     it once you've seen it. `traitIndex` is a key -> {name, desc} lookup; the caller
     builds it once from src/traits.js's TRAIT_ALL rather than this file depending on
     that module directly. */
  function testLabel(test, traitIndex) {
    if (test.kind === "damage") return `Use ${test.value} damage`;
    if (test.kind === "condition") return `Try to apply ${CONDITION_VERB[test.value] || test.value}`;
    const t = traitIndex && traitIndex[test.value];
    return t ? `Watch for “${t.desc}” (${t.name})` : `Watch for ${test.value}`;
  }

  /* The sentence the handoff asks for: name the test, then name the split it produces.
     Names are capped because "…would separate Ghost, Wight, Ghast, Wraith, Spectre and
     nine others" is not advice, and the point is to be readable at a table. */
  function describeSplit(test, groups) {
    const named = (list, max) => {
      const names = list.slice(0, max).map(x => x.name);
      const rest = list.length - names.length;
      return names.join(", ") + (rest > 0 ? ` and ${rest} other${rest === 1 ? "" : "s"}` : "");
    };
    const table = test.kind === "damage" ? DAMAGE_PHRASE
      : test.kind === "condition" ? CONDITION_PHRASE : TRAIT_PHRASE;
    const phrase = (o, n) => {
      const pair = table[o];
      return pair ? pair[n === 1 ? 0 : 1] : o;
    };
    return Object.keys(groups)
      .sort((a, b) => groups[b].length - groups[a].length)
      .slice(0, 3)
      .map(o => `${named(groups[o], 2)} ${phrase(o, groups[o].length)}`)
      .join("; ") + ".";
  }

  /* ---------- the search ---------- */

  /* Every test worth considering in principle — damage types, conditions, and every
     trait in the catalogue. Whether a given test can actually split the CURRENT
     candidates (nobody interacts with this damage type, every candidate has this
     trait, ...) is decided in suggest() below, once outcomes are computed; this
     function doesn't know who the candidates are. */
  function candidateTests(traits, opts) {
    const o = opts || {};
    const tests = [];
    DAMAGE_TYPES.forEach(v => tests.push({ kind: "damage", value: v }));
    CONDITIONS.forEach(v => tests.push({ kind: "condition", value: v }));
    (traits || []).forEach(t => tests.push({ kind: "trait", value: t.key }));
    // Don't re-suggest something the party has already reported.
    const asked = o.asked || {};
    return tests.filter(t => !(asked[t.kind] && asked[t.kind][t.value]));
  }

  /* Rank the tests by expected information gain over the leading candidates. */
  function suggest(results, opts) {
    const o = opts || {};
    const top = results.slice(0, o.consider || 12).filter(r => r.monster);
    if (top.length < 2) return [];

    const probs = probabilities(top);
    const before = entropy(probs);
    if (before <= 0) return [];

    const asked = { damage: {}, condition: {}, trait: {} };
    if (o.observation) {
      Object.keys(o.observation.damage || {}).forEach(d => { asked.damage[norm(d)] = true; });
      (o.observation.condImmune || []).forEach(c => { asked.condition[norm(c)] = true; });
      (o.observation.traits || []).forEach(t => { asked.trait[t] = true; });
    }

    // key -> {name, desc}, for testLabel — built once per call rather than per test.
    const traitIndex = Object.create(null);
    (o.traits || []).forEach(t => { traitIndex[t.key] = t; });

    const out = [];
    candidateTests(o.traits, { asked })
      .forEach(test => {
        const groups = Object.create(null);
        const mass = Object.create(null);
        top.forEach((r, i) => {
          const outcome = outcomeOf(test, r.monster);
          (groups[outcome] = groups[outcome] || []).push(r);
          mass[outcome] = (mass[outcome] || 0) + probs[i];
        });

        const outcomes = Object.keys(groups);
        if (outcomes.length < 2) return;          // everyone answers the same: worthless

        /* Expected entropy after running the test: the weighted average of the entropy
           remaining inside each outcome's group. */
        let after = 0;
        outcomes.forEach(oc => {
          const p = mass[oc];
          if (p <= 0) return;
          const inner = groups[oc].map((r, j) => probs[top.indexOf(r)] / p);
          after += p * entropy(inner);
        });

        const gain = before - after;
        if (gain <= 1e-9) return;
        const practicality = PRACTICALITY[test.kind] || 0.5;
        out.push({
          kind: test.kind, value: test.value,
          gain, score: gain * practicality,
          label: testLabel(test, traitIndex),
          split: describeSplit(test, groups),
          outcomes: outcomes.map(oc => ({ outcome: oc, count: groups[oc].length,
                                          names: groups[oc].map(r => r.name) })),
        });
      });

    out.sort((a, b) => b.score - a.score
      || a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
    return o.limit ? out.slice(0, o.limit) : out;
  }

  /* Fold a test's answer back into an observation, so the caller doesn't have to know
     which field each kind of test writes to. Used by the UI and by the harness that
     measures whether following the advice actually helps. */
  function applyAnswer(obs, test, outcome) {
    const next = Object.assign({}, obs);
    if (test.kind === "damage") {
      next.damage = Object.assign({}, obs.damage);
      next.damage[test.value] = outcome;
    } else if (test.kind === "condition") {
      // Only immunity is evidence; "it can be frightened" is what most things do.
      if (outcome === "immune") next.condImmune = (obs.condImmune || []).concat([test.value]);
    } else if (test.kind === "trait" && outcome === "yes") {
      next.traits = (obs.traits || []).concat([test.value]);
    }
    return next;
  }

  /* What the truth actually is, for a known monster — the harness's oracle, and what
     the UI would use if the user says "we tried it, here's what happened". */
  const answerFor = (test, monster) => outcomeOf(test, monster);

  return { DAMAGE_TYPES, CONDITIONS, PRACTICALITY, probabilities, entropy,
           outcomeOf, answerFor, applyAnswer, suggest, testLabel, describeSplit };
});
