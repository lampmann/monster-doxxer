/* ============================================================
   Evidence scoring — F1, F2, F3, F7.

   Core principle, from the design doc: RANK, NEVER FILTER. There is no
   `where ac = 15` anywhere in this file. A single hard constraint discards the
   right answer the moment the GM adjusts one number, and GMs adjust numbers.
   Every observation is soft evidence with a weight, and the output is a score
   over the entire corpus.

   Three ideas do the work:

   F1  Rarity weighting. A feature is worth -log(fraction of monsters that have
       it). Darkvision 60 ft is worth almost nothing; tremorsense plus a burrow
       speed plus acid immunity is very nearly a unique key. This falls out of
       the corpus with no hand-tuning, and it is why the tool works at all.

   F2  Asymmetry. A feature the statblock has and the player never mentioned
       costs nothing — players test maybe a fifth of what a monster can do, so
       absence of evidence is not evidence of absence. A feature the player
       DID report and the statblock lacks costs something. A direct
       contradiction (player saw fire immunity, statblock says vulnerability)
       costs a lot.

   F3  Trust tiers. Structural facts (type, movement, senses, condition
       immunities) get full weight — reflavouring rarely touches them. Numbers
       get tolerance curves, never equality. Appearance is a capped BONUS that
       can never subtract, because reflavouring is precisely the case where the
       description is wrong and the monster is right.

   F7  Normalise by the weight of evidence actually supplied, so a three-field
       query and a twelve-field query produce comparable scores.

   ON THE CONSTANTS: every number in TUNING below is a provisional guess. They
   are not defensible until the evaluation harness exists (corrupt real
   statblocks, measure top-5 recall) and picks them. Do not read them as
   considered values — read them as placeholders with the right shape.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TUNING = {
    /* What it costs when the player reported a feature and the candidate lacks it, as a
       fraction of that feature's rarity weight.

       Guessed at 0.6 on the theory that the player may have misread what they saw. The
       harness disagrees and the harness wins: recall climbs monotonically to ~1.3, and
       1.0 is within noise of the best. The reasoning behind the guess was double-counting
       — dropout already models the player failing to notice things, and it costs nothing
       by design (F2). A feature they positively DID report and the candidate lacks is a
       different and much stronger signal, and 1.0 says so: a miss costs exactly what a
       match earns. (n=400, stray 0.3, swap 0.5: 53.5% at 0.6 -> 55.0% at 1.0.) */
    missFactor: 1.0,
    // What a feature costs when the candidate has it and the player never mentioned it.
    // Deliberately zero: this is F2's whole point.
    unmentionedFactor: 0,
    // A rarity weight is capped so one freakishly rare tag can't outvote everything else.
    maxWeight: 8,
    // Records whose _copy only partially resolved are missing features they really have,
    // which would otherwise make them look like clean non-matches. Damp them slightly.
    partialPenalty: 0.9,
    /* Floor on a symptom's confidence multiplier (F8). A symptom attached by a loose prose
       regex is a weaker claim than one attached by a curated trait tag, and the credit
       should say so — but never all the way to zero.

       THE HARNESS CANNOT SETTLE THIS ONE, and the number is a judgement call as a result.
       It reports that discounting only hurts (55.0% at a floor of 1, i.e. no discount at
       all, against 53.5% at 0.25) — but its symptom observations are drawn from each
       monster's own tags, so every symptom it reports is true by construction. The case
       discounting exists for, where a loose regex attached a symptom the monster cannot
       actually produce, is precisely the case the harness never generates. 0.5 keeps the
       discount at half strength for ~0.7 points of measured cost. Revisit when there is a
       test set of real reports rather than synthesised ones. */
    minSymptomConfidence: 0.5,
    /* How hard a wrong damage interaction bites, scaling the DMG_COST matrix. Separate from
       missFactor because a contradiction ("I saw it shrug off fire, this thing burns") is a
       different claim from a plain absence.

       The harness says 0 — never penalise a contradiction — at every lie rate tested. That
       is a stronger claim than it can support: with only one true answer in 4,500, a
       penalty mostly lands on the true monster (which carries the one planted lie) rather
       than spreading over the wrong ones. 0.1 keeps F2's direction at a measured cost of
       ~0.5 points. If a later harness still says 0, delete the penalty rather than keeping
       a constant nothing supports. */
    damageCostFactor: 0.1,
  };

  /* Damage-interaction cost matrix (F2). Never compare these as booleans: "resistant" when the
     answer is "immune" is a near miss (the player watched their damage get halved and called it
     nothing), while "immune" when the answer is "vulnerable" is as wrong as the game allows.
     Rows are what the player reported, columns what the statblock says. */
  const DMG_STATES = ["immune", "resistant", "normal", "vulnerable"];
  const DMG_COST = {
    immune:     { immune:  0, resistant: 0.4, normal: 1.4, vulnerable: 2.4 },
    resistant:  { immune: 0.4, resistant: 0, normal: 1.0, vulnerable: 2.0 },
    normal:     { immune: 1.4, resistant: 1.0, normal: 0, vulnerable: 1.0 },
    vulnerable: { immune: 2.4, resistant: 2.0, normal: 1.0, vulnerable: 0 },
  };

  /* ============================================================
     Facets — the single place that says what counts as a feature.
     Used both to build the rarity table and to score a query, so the two can
     never drift apart and start counting different things.
     ============================================================ */
  /* Values are coerced with String() rather than assumed to be strings. The corpus is
     whatever the user dropped in data/, 5e.tools' shapes drift between releases, and a
     facet that throws takes down the whole ranking — a bad value should cost one
     feature, not the run. */
  const str = v => String(v == null ? "" : v).toLowerCase();
  const FACETS = {
    // An Empyrean is "celestial or fiend"; reporting either should credit it (see typeInfo).
    type:        m => [m.type].concat(m.typeAlt || []).filter(Boolean).map(str),
    typeTag:     m => (m.typeTags || []).map(str),
    size:        m => (m.size || []).map(str),
    movement:    m => Object.keys(m.speeds || {}).filter(k => k !== "walk" && m.speeds[k] > 0),
    hover:       m => (m.hover ? ["hover"] : []),
    sense:       m => (m.senseTags || []).map(str),
    condImmune:  m => (m.conditionImmune || []).map(str),
    traitTag:    m => (m.traitTags || []).map(str),
    actionTag:   m => (m.actionTags || []).map(str),
    damageDealt: m => (m.damageTags || []).map(str),
    symptom:     m => (m.symptoms || []),          // attached at index time by symptoms.js (F8)
    /* Damage interactions are facets so that the rarity table COUNTS them. They are
       scored through the cost matrix below rather than by set membership, but a weight
       is only meaningful if something counted the feature: an uncounted key falls to the
       floor and comes back worth maxWeight, i.e. rarer than anything real. Fire immunity
       is 7% of the corpus and must be priced like it. */
    immune:      m => (m.immune || []).map(str),
    resist:      m => (m.resist || []).map(str),
    vuln:        m => (m.vulnerable || []).map(str),
  };
  const FACET_KEYS = Object.keys(FACETS);

  const featureKey = (facet, value) => facet + ":" + value;

  /* ============================================================
     F1 — the rarity table
     ============================================================ */
  function buildRarity(monsters) {
    const counts = Object.create(null);
    const total = monsters.length || 1;
    monsters.forEach(m => {
      // A monster with the same feature twice must count once, or duplicates inflate rarity.
      const seen = new Set();
      FACET_KEYS.forEach(f => FACETS[f](m).forEach(v => {
        if (v == null || v === "") return;
        seen.add(featureKey(f, v));
      }));
      seen.forEach(k => { counts[k] = (counts[k] || 0) + 1; });
    });

    /* -log(fraction). A feature nothing has would be infinite, so the count is floored at
       half a monster — an unseen feature is treated as rarer than the rarest observed one,
       without being worth an unbounded number of points. */
    function weight(key) {
      const n = counts[key] || 0.5;
      return Math.min(TUNING.maxWeight, -Math.log(n / total));
    }
    function has(key) { return !!counts[key]; }
    return { total, counts, weight, has, featureKey };
  }

  /* ============================================================
     Observations
     -----------
     Everything is optional. A field the user did not supply contributes nothing at all,
     rather than contributing "no". Shape:

       {
         type: "dragon",
         size: "large",
         movement: ["fly", "burrow"],
         senses: ["tremorsense"],
         condImmune: ["charmed"],
         symptoms: ["healed-between-rounds"],
         damage: { fire: "immune", radiant: "vulnerable" },   // see DMG_STATES
       }
     ============================================================ */
  const SET_FIELDS = {                 // observation field -> facet it scores against
    movement: "movement", senses: "sense", condImmune: "condImmune",
    symptoms: "symptom", typeTags: "typeTag", damageDealt: "damageDealt",
  };
  const SCALAR_FIELDS = { type: "type", size: "size" };

  const asList = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const norm = v => String(v).trim().toLowerCase();

  const DMG_FACET = { immune: "immune", resistant: "resist", vulnerable: "vuln" };

  /* What a reported damage interaction is worth, from the same rarity table as everything
     else (F1). "Immune to fire" is rare and therefore strong; "it took normal damage from
     fire" is what almost every monster does and is therefore nearly worthless — but not
     worthless, since it does rule out three states.

     `normal` has no facet of its own because it is the absence of the other three, so its
     count is derived: total minus everything that interacts with that type. */
  function damageWeight(rarity, state, type) {
    if (state !== "normal") return rarity.weight(featureKey(DMG_FACET[state], type));
    const interacting = ["immune", "resist", "vuln"]
      .reduce((n, f) => n + (rarity.counts[featureKey(f, type)] || 0), 0);
    const plain = Math.max(0.5, rarity.total - interacting);
    return Math.min(TUNING.maxWeight, -Math.log(plain / rarity.total));
  }

  function candidateFeatureSet(m) {
    const set = new Set();
    FACET_KEYS.forEach(f => FACETS[f](m).forEach(v => { if (v != null && v !== "") set.add(featureKey(f, norm(v))); }));
    return set;
  }

  /* Score one candidate against one set of observations.
     Returns the normalised score plus the per-feature breakdown F14 needs to explain itself —
     a confident wrong answer with no visible reasoning is worse than no answer. */
  function scoreMonster(m, obs, rarity, opts) {
    const o = opts || {};
    const have = candidateFeatureSet(m);
    const forEvidence = [], against = [];
    let raw = 0, supplied = 0;

    /* How much of a feature's rarity weight this candidate actually earns for having it.
       Everything scores 1 except symptoms, which scale by how confidently the ontology
       attached them — a curated trait tag is near-certain, a prose regex is a guess, and
       collapsing the two would let a loose keyword hit outrank the real mechanic. */
    const confidenceOf = (facet, value) => {
      if (facet !== "symptom") return 1;
      const c = (m.symptomConf || {})[value];
      return c == null ? 1 : Math.max(TUNING.minSymptomConfidence, c);
    };

    const creditSet = (values, facet) => {
      asList(values).map(norm).filter(Boolean).forEach(v => {
        const key = featureKey(facet, v);
        const w = rarity.weight(key);
        supplied += w;
        if (have.has(key)) {
          const conf = confidenceOf(facet, v);
          const credit = w * conf;
          raw += credit;
          const hit = { facet, value: v, weight: +credit.toFixed(3) };
          if (conf < 1) hit.confidence = +conf.toFixed(2);
          forEvidence.push(hit);
        } else {
          const cost = w * TUNING.missFactor;
          raw -= cost;
          against.push({ facet, value: v, weight: -(+cost.toFixed(3)), why: "the statblock doesn't have this" });
        }
      });
    };

    Object.entries(SCALAR_FIELDS).forEach(([field, facet]) => { if (obs[field]) creditSet(obs[field], facet); });
    Object.entries(SET_FIELDS).forEach(([field, facet]) => { if (obs[field]) creditSet(obs[field], facet); });

    // Damage interactions: the cost matrix, not equality (F2).
    if (obs.damage) {
      Object.entries(obs.damage).forEach(([type, reported]) => {
        const t = norm(type), r = norm(reported);
        if (!DMG_COST[r]) return;                      // unrecognised state: degrade to manual, never guess
        const actual = m.immune.map(norm).includes(t) ? "immune"
          : m.resist.map(norm).includes(t) ? "resistant"
          : m.vulnerable.map(norm).includes(t) ? "vulnerable" : "normal";
        /* Weight by the rarity of the state the PLAYER reported, not of the one the statblock
           has: "immune to fire" is a much stronger clue than "took normal damage from fire",
           and it stays the strong clue whether or not this candidate happens to match it. */
        const w = damageWeight(rarity, r, t);
        const cost = DMG_COST[r][actual];
        supplied += w;
        if (cost === 0) { raw += w; forEvidence.push({ facet: "damage", value: `${t}: ${r}`, weight: +w.toFixed(3) }); }
        else {
          const penalty = w * cost * TUNING.damageCostFactor;
          raw -= penalty;
          against.push({ facet: "damage", value: `${t}: ${r}`, weight: -(+penalty.toFixed(3)),
                         why: `the statblock says ${actual}` });
        }
      });
    }

    if (m.partial) raw *= TUNING.partialPenalty;

    // F7 — normalise by the evidence actually supplied, so queries of different sizes compare.
    const score = supplied > 0 ? raw / supplied : 0;
    return {
      key: m.key, name: m.name, source: m.source, monster: o.keepMonster ? m : undefined,
      score, raw, supplied,
      for: forEvidence.sort((a, b) => b.weight - a.weight),
      against: against.sort((a, b) => a.weight - b.weight),
    };
  }

  function rank(monsters, obs, rarity, opts) {
    const o = opts || {};
    const out = monsters
      .filter(m => !o.sources || !o.sources.length || o.sources.includes(m.source))   // F16, the one legitimate filter
      .map(m => scoreMonster(m, obs, rarity, o));
    out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return o.limit ? out.slice(0, o.limit) : out;
  }

  /* True when the user supplied nothing worth ranking on — the UI should say so rather than
     present an arbitrary ordering of 3,000 monsters as if it meant something. */
  function hasEvidence(obs) {
    if (!obs) return false;
    const fields = Object.keys(SCALAR_FIELDS).concat(Object.keys(SET_FIELDS));
    if (fields.some(f => asList(obs[f]).filter(Boolean).length)) return true;
    return !!(obs.damage && Object.keys(obs.damage).length);
  }

  return { TUNING, DMG_STATES, DMG_COST, FACETS, FACET_KEYS, featureKey,
           buildRarity, candidateFeatureSet, scoreMonster, rank, hasEvidence };
});
