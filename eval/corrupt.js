/* ============================================================
   The synthetic test set — handoff §6.

   "Do not tune the weights by intuition. Corrupt your own data instead."

   Take a real statblock, degrade it into the observations a party would plausibly
   have after one fight, and see whether the scorer can still find it. This is free
   to generate and it is the only honest way to pick the constants in F1–F7,
   because the alternative is choosing numbers that feel right and then finding out
   at someone's table.

   The corruption model, from the handoff, plus what it takes to make each step
   mean something:

     1. Delete about 60% of the fields.  Applied per OBSERVATION, not per field
        of the statblock. A party does not learn "60% of the senses block"; they
        learn one or two specific things and never test the rest. Item-level
        dropout is also the pessimistic reading, since it can delete the single
        rare feature that would have identified the monster outright.
     2. Shift AC by ±3, and 3. HP by ±30%.  Carried on the observation now so the
        harness is ready for F4/F5; the scorer ignores them until numerics land.
     4. Swap one damage resistance.  A wrong observation, not a missing one —
        this is the step that tests F2's asymmetry, and the only step that can
        make the true answer score BELOW a wrong one.
     5. Paraphrase the appearance.  Not yet: there is no appearance scorer
        (F10–F12), so generating the text would measure nothing. Named in
        `unmodelled` below rather than silently skipped.

   WHAT THIS MODEL DOES NOT CAPTURE, and why the numbers it produces are an upper
   bound rather than a prediction:

     - Every observation here is drawn from the statblock, so it is at worst
       incomplete or perturbed. A real player misremembers, conflates two
       creatures, and reports things that were never true.
     - Reflavouring is not modelled at all, because the fields it would corrupt
       (appearance) are not yet scored.
     - The corrupted monster is still IN the corpus being searched. A homebrew
       monster that simply is not in any book is the case the confidence floor
       has to handle, and this harness says nothing about it.
   ============================================================ */
"use strict";

const UNMODELLED = [
  "appearance paraphrase (F10-F12 not built)",
  "reflavouring",
  "two monsters merged into one set of observations",
  "a homebrew monster that is not in the corpus at all",
];

/* ---------- deterministic RNG ----------
   A harness that cannot reproduce its own runs cannot tell a real improvement from
   a lucky sample. mulberry32: small, fast, good enough for sampling. */
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const shuffled = (r, list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning",
  "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

const DEFAULTS = {
  keepRate: 0.4,          // ~60% of observations deleted, per the handoff
  maxSymptoms: 4,         // a party reports a handful of odd things, not fifteen
  acShift: 3,
  hpShiftFraction: 0.3,
  swapResistance: true,
  swapRate: 1.0,          // probability a query carries a wrong damage entry — see below
  damageTestRate: 0.35,   // chance a given damage interaction was tested at all
  strayRate: 0,           // probability each surviving set field gains a false observation
};

/* ON strayRate. The handoff corrupts damage and nothing else, which makes damage the only
   witness in the model that ever lies. Any constant chosen against that model will say to
   distrust damage and trust everything else — an artefact of the corruption, not a fact
   about the scorer. strayRate adds a plausible-but-false item to other set fields, so
   "the player misremembered" applies evenly. Off by default so the headline number stays
   faithful to §6; turn it on before trusting a constant that governs contradictions. */

/* ON swapRate. The handoff says "swap one damage resistance", and taken literally that
   means EVERY query contains a lie — with ~4 or 5 interactions tested, a fifth of all
   damage evidence is false. That is a worst case, not a typical table, and it matters
   because the best value of damageCostFactor falls straight out of the assumed lie rate:
   if evidence is always partly false the scorer should ignore contradictions entirely,
   and if it is usually true the scorer should punish them hard.
   Default stays 1.0 so the headline number matches the spec; sweep against a lower rate
   before concluding a constant is right. */

/* Everything the party COULD have observed, before anything is deleted.
   Deliberately mirrors the fields score.js reads, so the harness cannot
   accidentally measure a field the scorer ignores or vice versa. */
function fullObservation(m) {
  const damage = {};
  (m.immune || []).forEach(d => { damage[String(d).toLowerCase()] = "immune"; });
  (m.resist || []).forEach(d => { const k = String(d).toLowerCase(); if (!damage[k]) damage[k] = "resistant"; });
  (m.vulnerable || []).forEach(d => { const k = String(d).toLowerCase(); if (!damage[k]) damage[k] = "vulnerable"; });

  return {
    type: m.type || "",
    size: (m.size || [])[0] || "",
    typeTags: (m.typeTags || []).slice(),
    movement: Object.keys(m.speeds || {}).filter(k => k !== "walk" && m.speeds[k] > 0),
    senses: (m.senseTags || []).map(s => String(s).toLowerCase()),
    condImmune: (m.conditionImmune || []).slice(),
    damageDealt: (m.damageTags || []).slice(),
    symptoms: (m.symptoms || []).slice(),
    damage,
    ac: m.ac,
    hp: m.hpAvg,
  };
}

const SET_FIELDS = ["typeTags", "movement", "senses", "condImmune", "damageDealt", "symptoms"];
const SCALAR_FIELDS = ["type", "size"];

/* Corrupt one monster into a query. Returns the observation plus a record of what was
   done to it, so a failing case can be inspected rather than just counted. */
function corrupt(m, r, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const full = fullObservation(m);
  const obs = {};
  const notes = [];

  // 1. Dropout. Scalars survive or don't; sets are thinned item by item.
  SCALAR_FIELDS.forEach(f => { if (full[f] && r() < o.keepRate) obs[f] = full[f]; });
  SET_FIELDS.forEach(f => {
    const kept = full[f].filter(() => r() < o.keepRate);
    if (kept.length) obs[f] = kept;
  });
  if (obs.symptoms && obs.symptoms.length > o.maxSymptoms) {
    obs.symptoms = shuffled(r, obs.symptoms).slice(0, o.maxSymptoms);
  }

  /* The player misremembers: a field the party reported gains something the monster does
     not actually have. Drawn from the corpus vocabulary rather than invented, so the false
     observation is one a real creature could have produced. */
  if (o.strayRate > 0 && o.vocab) {
    SET_FIELDS.forEach(f => {
      if (!obs[f] || r() >= o.strayRate) return;
      const pool = o.vocab[f];
      if (!pool || !pool.length) return;
      const stray = pick(r, pool);
      if (obs[f].includes(stray) || full[f].includes(stray)) return;   // must be false to be a lie
      obs[f] = obs[f].concat([stray]);
      notes.push(`${f}: +${stray} (wrong)`);
    });
  }

  /* Damage interactions are their own dropout: a party tests a few types and learns
     nothing about the rest. Absence here must stay absence — reporting "normal" for
     an untested type would be a fabricated observation, and F2 exists precisely
     because absence of evidence is not evidence of absence. */
  const damage = {};
  DAMAGE_TYPES.forEach(d => {
    if (r() >= o.damageTestRate) return;
    damage[d] = full.damage[d] || "normal";
  });
  if (Object.keys(damage).length) obs.damage = damage;

  // 2 & 3. Numeric drift. The DM retuned it; the shape is intact, the values are not.
  if (typeof full.ac === "number" && r() < o.keepRate) {
    const shift = Math.round((r() * 2 - 1) * o.acShift);
    obs.ac = Math.max(1, full.ac + shift);
    if (shift) notes.push(`ac ${full.ac} -> ${obs.ac}`);
  }
  if (typeof full.hp === "number" && r() < o.keepRate) {
    const factor = 1 + (r() * 2 - 1) * o.hpShiftFraction;
    obs.hp = Math.max(1, Math.round(full.hp * factor));
    if (obs.hp !== full.hp) notes.push(`hp ${full.hp} -> ${obs.hp}`);
  }

  /* 4. Swap one damage interaction to something untrue. The single step that can push
     the correct answer below a wrong one, so it is what actually tests F2. */
  if (o.swapResistance && obs.damage && r() < o.swapRate) {
    const tested = Object.keys(obs.damage);
    if (tested.length) {
      const d = pick(r, tested);
      const states = ["immune", "resistant", "normal", "vulnerable"].filter(s => s !== obs.damage[d]);
      const to = pick(r, states);
      notes.push(`damage ${d}: ${obs.damage[d]} -> ${to} (wrong)`);
      obs.damage[d] = to;
    }
  }

  return { obs, notes, truth: m.key, truthName: m.name };
}

/* A query with nothing in it is unscoreable, and counting it as a miss measures the
   sampler rather than the scorer. Retry a few times, then give up on that monster and
   report it — a statblock so featureless it survives no dropout is itself a finding. */
function corruptViable(m, r, opts, hasEvidence, tries) {
  const n = tries || 8;
  for (let i = 0; i < n; i++) {
    const c = corrupt(m, r, opts);
    if (hasEvidence(c.obs)) return c;
  }
  return null;
}

/* The vocabulary of each set field across the corpus, for strayRate to draw false
   observations from. Built once and passed in via opts.vocab. */
function buildVocab(monsters) {
  const vocab = {};
  SET_FIELDS.forEach(f => { vocab[f] = new Set(); });
  monsters.forEach(m => {
    const full = fullObservation(m);
    SET_FIELDS.forEach(f => full[f].forEach(v => vocab[f].add(v)));
  });
  SET_FIELDS.forEach(f => { vocab[f] = [...vocab[f]]; });
  return vocab;
}

module.exports = { rng, pick, shuffled, corrupt, corruptViable, fullObservation, buildVocab,
                   DEFAULTS, DAMAGE_TYPES, SET_FIELDS, UNMODELLED };
