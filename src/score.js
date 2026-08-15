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
     F4, F5, F6 — numbers

     F4  Tolerance curves, never equality. AC scores on a Gaussian; HP scores on a
         log scale, because being 20 HP out matters enormously at CR 1 and not at
         all at CR 20.

     F5  Residuals from the CR average, not raw values. Homebrew tuning mostly
         shifts the whole power scale and leaves the shape intact — a DM who
         rebuilds a monster three CRs up moves its AC and HP together, and a tool
         that compares raw numbers loses it while a tool that compares "how tough
         for its weight class" keeps it.

     THE PROBLEM F5 HAS, which the handoff does not address: the query has no CR to
     take a residual from. The CR is most of what the user is trying to find out.
     DESIGN.md lays out three ways round it; this implements the third — infer the
     CR from the observed numbers themselves by inverting the corpus CR→HP curve,
     then compare each candidate's residual against the observation's residual at
     that implied CR. Both sides get normalised to their own scale, which is the
     only version that survives the case F5 exists for.

     `mode` selects between that and the simpler raw comparison so the evaluation
     harness can referee, rather than the question being settled by argument.
     ============================================================ */
  const NUMERIC = {
    acSigma: 2.5,        // AC points; F4's "sigma of about 2"
    hpLogSigma: 0.45,    // natural-log HP, so ~±57% is one sigma
    /* Nats, so numbers compete on the same scale as a mid-rarity structural feature.
       Chosen for robustness rather than for the best headline. Recall keeps climbing to
       ~6 when the monster is at its book numbers, but that gain is bought by trusting
       the numbers, and it reverses as soon as the DM retunes: at a ±8 CR rebuild, 6
       scores 57.5% against 59.0% at 3.2. Since "the DM adjusts numbers" is the premise
       the whole tool is built on, 3.2 takes the value that is never much worse than the
       best rather than the one that wins the easy case. (n=400.) */
    acWeight: 3.2,
    hpWeight: 3.2,
    retunedFactor: 0.05, // F6: the "assume this was rebuilt" toggle
    minPerCr: 8,         // below this a CR bucket is too thin to trust alone
    /* "raw" | "residual" | "joint" | "off". raw is the default and F5 is off; the
       measurement that decided it is written up under scoreNumerics below. */
    mode: "raw",
  };

  const gaussian = (delta, sigma) => Math.exp(-(delta * delta) / (2 * sigma * sigma));

  /* CR → expected AC and expected log-HP, measured off the corpus rather than taken
     from the DMG's table. The corpus is what we are ranking against, and where the
     books disagree with themselves the corpus is the thing that has to be matched. */
  function buildNumerics(monsters) {
    const buckets = new Map();
    monsters.forEach(m => {
      if (m.crNum == null) return;
      let b = buckets.get(m.crNum);
      if (!b) { b = { cr: m.crNum, ac: [], logHp: [] }; buckets.set(m.crNum, b); }
      if (typeof m.ac === "number" && m.ac > 0) b.ac.push(m.ac);
      if (typeof m.hpAvg === "number" && m.hpAvg > 0) b.logHp.push(Math.log(m.hpAvg));
    });

    const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const rows = [...buckets.values()].sort((a, b) => a.cr - b.cr)
      .map(b => ({ cr: b.cr, n: Math.max(b.ac.length, b.logHp.length), ac: mean(b.ac), logHp: mean(b.logHp) }))
      .filter(r => r.ac != null && r.logHp != null);

    /* Thin buckets borrow from their neighbours. CR 27 has a handful of monsters and
       its raw mean is whatever those few happen to be; smoothing keeps the curve a
       curve instead of a row of spikes. */
    const smooth = rows.map((r, i) => {
      if (r.n >= NUMERIC.minPerCr) return { cr: r.cr, ac: r.ac, logHp: r.logHp };
      const lo = Math.max(0, i - 1), hi = Math.min(rows.length - 1, i + 1);
      const win = rows.slice(lo, hi + 1);
      const wsum = win.reduce((s, x) => s + x.n, 0) || 1;
      return {
        cr: r.cr,
        ac: win.reduce((s, x) => s + x.ac * x.n, 0) / wsum,
        logHp: win.reduce((s, x) => s + x.logHp * x.n, 0) / wsum,
      };
    });

    /* HP must rise with CR for the inversion below to have a unique answer. It does in
       the data; this only guards against a thin bucket dipping. */
    for (let i = 1; i < smooth.length; i++) {
      if (smooth[i].logHp < smooth[i - 1].logHp) smooth[i].logHp = smooth[i - 1].logHp;
    }

    const interp = (cr, key) => {
      if (!smooth.length) return null;
      if (cr <= smooth[0].cr) return smooth[0][key];
      if (cr >= smooth[smooth.length - 1].cr) return smooth[smooth.length - 1][key];
      for (let i = 1; i < smooth.length; i++) {
        if (cr <= smooth[i].cr) {
          const a = smooth[i - 1], b = smooth[i];
          const t = (cr - a.cr) / ((b.cr - a.cr) || 1);
          return a[key] + t * (b[key] - a[key]);
        }
      }
      return smooth[smooth.length - 1][key];
    };

    /* Invert the curve: what CR would produce these numbers? HP carries almost all of
       the signal — it spans three orders of magnitude across the corpus while AC spans
       about fifteen points and saturates early — so AC only gets a say when HP is absent. */
    function inferCr(obs) {
      const fromCurve = (value, key) => {
        if (!smooth.length) return null;
        if (value <= smooth[0][key]) return smooth[0].cr;
        for (let i = 1; i < smooth.length; i++) {
          if (value <= smooth[i][key]) {
            const a = smooth[i - 1], b = smooth[i];
            const span = (b[key] - a[key]) || 1;
            return a.cr + (value - a[key]) / span * (b.cr - a.cr);
          }
        }
        return smooth[smooth.length - 1].cr;
      };
      if (!smooth.length) return null;          // no corpus, nothing to infer against
      const hasHp = typeof obs.hp === "number" && obs.hp > 0;
      const hasAc = typeof obs.ac === "number" && obs.ac > 0;
      // `from` matters to the caller: a residual taken against a CR inferred from the
      // same quantity is identically zero. See the note on the residual modes below.
      if (hasHp && hasAc) return { cr: fitCr(obs), from: "both" };
      if (hasHp) return { cr: fromCurve(Math.log(obs.hp), "logHp"), from: "hp" };
      if (hasAc) return { cr: fromCurve(obs.ac, "ac"), from: "ac" };
      return null;
    }

    /* Fit one CR to BOTH numbers at once, by least squares in units of each field's own
       tolerance. This is what makes F5 work at all.

       Two observations, one free parameter: the fit generally cannot drive both residuals
       to zero, so what is left over is real information about the creature's shape rather
       than an artefact of the inversion. Inferring from HP alone zeroes HP's residual by
       construction and throws that information away — which is precisely why `residual`
       mode scored no better than switching numbers off. */
    function fitCr(obs) {
      const targetAc = obs.ac, targetLog = Math.log(obs.hp);
      const err = cr => {
        const dAc = (targetAc - interp(cr, "ac")) / NUMERIC.acSigma;
        const dHp = (targetLog - interp(cr, "logHp")) / NUMERIC.hpLogSigma;
        return dAc * dAc + dHp * dHp;
      };
      let best = smooth.length ? smooth[0].cr : 0, bestErr = Infinity;
      smooth.forEach(row => { const e = err(row.cr); if (e < bestErr) { bestErr = e; best = row.cr; } });
      // Refine between the tabulated CRs — the curve is interpolated, so the minimum
      // usually sits between two of them.
      let step = 1;
      for (let i = 0; i < 12; i++) {
        const lo = err(Math.max(0, best - step)), hi = err(Math.min(30, best + step));
        if (lo < bestErr) { best = Math.max(0, best - step); bestErr = lo; }
        else if (hi < bestErr) { best = Math.min(30, best + step); bestErr = hi; }
        else step /= 2;
      }
      return best;
    }

    return {
      rows: smooth,
      expectedAc: cr => interp(cr, "ac"),
      expectedLogHp: cr => interp(cr, "logHp"),
      inferCr,
    };
  }

  /* Score the numeric part of an observation against one candidate. Never subtracts:
     a tolerance curve that decays to zero already costs the candidate everything it
     could have earned, and F3 puts numbers in tier 2 precisely because DMs retune them. */
  function scoreNumerics(m, obs, numerics, opts) {
    const o = opts || {};
    const mode = o.numericMode || NUMERIC.mode;
    const out = { credit: 0, supplied: 0, hits: [] };
    if (mode === "off" || !numerics) return out;

    const hasAc = typeof obs.ac === "number" && obs.ac > 0;
    const hasHp = typeof obs.hp === "number" && obs.hp > 0;
    if (!hasAc && !hasHp) return out;

    // F6 — the user says the DM rebuilds statblocks, so the numbers barely count.
    const scale = o.retuned ? NUMERIC.retunedFactor : 1;

    /* F5, and the correction the harness forced.

       The handoff says to compare residuals from the CR average, and DESIGN.md picked
       inferring the CR from the observed numbers as the way to get a CR for the query.
       Both halves are right and they do not compose: inferring the CR from HP and then
       taking HP's residual AT that CR gives exactly zero, every time, by construction.
       The inversion and the residual cancel, and the measurement agreed — residual mode
       scored no better than switching numbers off entirely (56.8% vs 56.6%).

       So the two numbers are treated differently, which is what the algebra was asking
       for all along:

         HP  sets the power scale. Compared raw, in log space. (Comparing implied CR to
             the candidate's CR is the same comparison under a monotone transform, so
             there is nothing to gain by dressing it up as a residual.)
         AC  is compared as a residual at the CR that HP implies — "how armoured is this
             for its weight class". Here F5's insight pays, because the CR came from a
             different quantity and the residual is a real number rather than zero.

       That is `hybrid`, and it is the default. A residual is only taken against a CR
       inferred from something else. */
    const usesResidual = mode === "residual" || mode === "joint";
    const implied = usesResidual ? numerics.inferCr(obs) : null;

    if (hasAc) {
      const w = NUMERIC.acWeight * scale;
      out.supplied += w;
      if (typeof m.ac === "number" && m.ac > 0) {
        let delta;
        const acResidual = implied && m.crNum != null && (mode === "residual" || mode === "joint");
        if (acResidual) {
          delta = (obs.ac - numerics.expectedAc(implied.cr)) - (m.ac - numerics.expectedAc(m.crNum));
        } else {
          delta = obs.ac - m.ac;
        }
        const fit = gaussian(delta, NUMERIC.acSigma);
        out.credit += w * fit;
        out.hits.push({ facet: "ac", value: `AC ${obs.ac}`, weight: +(w * fit).toFixed(3), fit: +fit.toFixed(2) });
      }
    }

    if (hasHp) {
      const w = NUMERIC.hpWeight * scale;
      out.supplied += w;
      if (typeof m.hpAvg === "number" && m.hpAvg > 0) {
        const obsLog = Math.log(obs.hp), monLog = Math.log(m.hpAvg);
        let delta;
        /* `joint` takes HP's residual too, but only when the CR was fitted to BOTH
           numbers — that is the case where the residual is not self-cancelling.
           `residual` is kept so the harness can still reproduce the comparison that
           ruled it out. */
        const hpResidual = implied && m.crNum != null &&
          (mode === "residual" || (mode === "joint" && implied.from === "both"));
        if (hpResidual) {
          delta = (obsLog - numerics.expectedLogHp(implied.cr)) - (monLog - numerics.expectedLogHp(m.crNum));
        } else {
          delta = obsLog - monLog;
        }
        const fit = gaussian(delta, NUMERIC.hpLogSigma);
        out.credit += w * fit;
        out.hits.push({ facet: "hp", value: `${obs.hp} hp`, weight: +(w * fit).toFixed(3), fit: +fit.toFixed(2) });
      }
    }
    return out;
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

    /* F4/F5/F6 — numbers, on tolerance curves. Added after the categorical evidence so
       the numeric weight sits in the same units (nats) as everything else, and normalised
       through the same F7 denominator. */
    const num = scoreNumerics(m, obs, o.numerics, o);
    if (num.supplied) {
      raw += num.credit;
      supplied += num.supplied;
      num.hits.forEach(h => forEvidence.push(h));
    }

    if (m.partial) raw *= TUNING.partialPenalty;

    // F7 — normalise by the evidence actually supplied, so queries of different sizes compare.
    const score = supplied > 0 ? raw / supplied : 0;
    return {
      key: m.key, name: m.name, source: m.source, srd: !!m.srd, cr: m.cr,
      monster: o.keepMonster ? m : undefined,
      score, raw, supplied,
      for: forEvidence.sort((a, b) => b.weight - a.weight),
      against: against.sort((a, b) => a.weight - b.weight),
    };
  }

  /* ============================================================
     F16 — source filtering. The one legitimate filter in the whole tool.

     It is legitimate because, unlike every other input, it is not a claim about the
     monster — it is a claim about the world. "My DM doesn't own that book" and "don't
     spoil the adventure I'm halfway through" are facts the user knows and the corpus
     cannot. Ranking a monster the user has told you is impossible is not humility, it
     is noise.

     Tri-state, one source at a time, matching the include/exclude filters in pmcrwf:

       neutral   no opinion. Most sources, most of the time.
       include   only these. "We're running Curse of Strahd, it'll be from CoS or MM."
       exclude   never these. The spoiler case, and the reason exclude has to exist
                 separately rather than being expressible as "include everything else":
                 a player who wants to avoid one adventure they are midway through
                 should not have to enumerate the other 106 sources to say so.

     Exclude wins over include when a source is somehow in both, because the cost of
     the two mistakes is not symmetric — wrongly showing a monster spoils an adventure,
     wrongly hiding one costs a place in a list.

     The rarity table is NOT rebuilt over the filtered set, deliberately. How surprising
     tremorsense is, is a fact about the game rather than about which books you own, and
     recomputing it per filter would make the same evidence worth different amounts to
     two people who saw the same monster.
     ============================================================ */
  function sourceFilter(spec) {
    if (!spec) return null;
    // A bare array is the older include-only form, and still means include.
    const s = Array.isArray(spec) ? { include: spec } : spec;
    const inc = asList(s.include).map(norm).filter(Boolean);
    const exc = asList(s.exclude).map(norm).filter(Boolean);
    if (!inc.length && !exc.length) return null;
    const incSet = new Set(inc), excSet = new Set(exc);
    return src => {
      const v = norm(src);
      if (excSet.has(v)) return false;
      return incSet.size ? incSet.has(v) : true;
    };
  }

  function rank(monsters, obs, rarity, opts) {
    const o = opts || {};
    const allowed = sourceFilter(o.sources);
    const out = (allowed ? monsters.filter(m => allowed(m.source)) : monsters)
      .map(m => scoreMonster(m, obs, rarity, o));

    /* Ties are common and they matter. Three or four observations routinely leave
       twenty candidates on identical scores, and whatever comes first is what the
       user reads — so "alphabetical" meant a query that correctly identified a troll
       answered "Aquatic Troll, Blinded Troll, Dragonpriest…" with the actual Troll
       sixteenth, off the bottom of the list.

       The evidence genuinely cannot separate these, so the tiebreak is a prior on
       which monster a party is likelier to have fought, and SRD / Basic Rules
       membership is the best proxy in the data: those are the ~1,200 monsters that
       ship with the free rules, that every DM owns, and that adventures reprint.

       Strictly a tiebreak, on exactly equal scores. It can never reorder candidates
       the evidence has already separated, so it cannot launder a prior into a
       finding — which is also why it needs no harness support to be safe. */
    out.sort((a, b) => b.score - a.score
      || (b.srd ? 1 : 0) - (a.srd ? 1 : 0)
      || a.name.length - b.name.length
      || a.name.localeCompare(b.name));
    return o.limit ? out.slice(0, o.limit) : out;
  }

  /* True when the user supplied nothing worth ranking on — the UI should say so rather than
     present an arbitrary ordering of 3,000 monsters as if it meant something. */
  function hasEvidence(obs) {
    if (!obs) return false;
    const fields = Object.keys(SCALAR_FIELDS).concat(Object.keys(SET_FIELDS));
    if (fields.some(f => asList(obs[f]).filter(Boolean).length)) return true;
    if (obs.damage && Object.keys(obs.damage).length) return true;
    return typeof obs.ac === "number" || typeof obs.hp === "number";
  }

  return { TUNING, NUMERIC, DMG_STATES, DMG_COST, FACETS, FACET_KEYS, featureKey,
           buildRarity, buildNumerics, scoreNumerics, gaussian, sourceFilter,
           candidateFeatureSet, scoreMonster, rank, hasEvidence };
});
