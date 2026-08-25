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
     5. Paraphrase the appearance.  Not a paraphrase of the book's prose — the
        eight words a player would offer from memory, weighted towards the shape
        of the thing, and half the time repainted a different colour. See the
        long note on it below; it is the only place reflavouring is modelled.

   WHAT THIS MODEL DOES NOT CAPTURE, and why the numbers it produces are an upper
   bound rather than a prediction:

     - Every observation here is drawn from the statblock, so it is at worst
       incomplete or perturbed. `strayRate` and the recolouring make some of it
       false, but a real player also conflates two creatures and reports things
       that were never true of either.
     - The corrupted monster is still IN the corpus being searched. A homebrew
       monster that simply is not in any book is the case the confidence floor
       has to handle, and this harness says nothing about it.
   ============================================================ */
"use strict";

const UNMODELLED = [
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
  crShift: 0,             // CR steps the DM rebuilt the monster by, +/- — see below
  describeRate: 0,        // probability the party describes what it looked like at all
  describeWords: 6,       // how many words they remember
  recolourRate: 0.5,      // probability the DM had reflavoured the colour — see below
  synonymRate: 0,         // probability a book word is said in the player's words instead
  heardRate: 0,           // probability the DM said a name the party caught
  garbleRate: 0.4,        // ...and wrote down wrong, having heard it rather than read it
  mishearRate: 0.1,       // ...or got completely wrong. See below.
  bossDriftRate: 0,       // probability the DM added legendary/lair to a monster without it
  rollRate: 0,            // probability the party reports DICE instead of remembered numbers
};

/* ON heardRate — a name the party heard.

   DMs narrate, and narration contains nouns. "The barghest lunges at you" hands a table
   the word without telling them it names a creature with a statblock. So some fraction of
   queries carry a name, and the model has to be unkind about it in two ways:

   garbleRate   the name arrived through the air, once. People write "barghast".
   mishearRate  the name is simply WRONG — the DM renamed the thing, or the party latched
                onto a different word entirely. This is the one that matters: a scorer
                that treats a name as conclusive will be destroyed here, and one that
                treats it as strong-but-not-binding will lose a little and recover. */

/* ON synonymRate — the vocabulary gap, and the whole case for embeddings.

   Sampling words out of the book's own prose measures BM25 at its best: the query is
   literally drawn from the document it has to match. Real players do not talk like the
   Monster Manual. The book says a beholder's body is SPHEROID; the player says it was a
   floating ORB. The book says INSECTILE and FERROUS; the player says bug and metal.

   Every substitution below is a word the books actually use paired with what somebody
   would say instead. Turning this up is the experiment that says how much of F10 the
   lexical half can carry, and therefore whether the embedding half is worth a model, a
   Python build step and a shipped vector index. */
const SYNONYMS = {
  spheroid: "orb", spherical: "ball", globular: "round",
  insectile: "insect", insectoid: "bug", chitinous: "shell", carapace: "shell",
  mandible: "jaw", proboscis: "snout", ferrous: "metal",
  serpentine: "snakelike", sinuous: "snaky", undulating: "rippling", writhing: "squirming",
  avian: "bird", ursine: "bear", feline: "cat", lupine: "wolf", equine: "horse",
  gelatinous: "jelly", translucent: "see-through", iridescent: "shimmering",
  luminous: "glowing", phosphorescent: "glowing", incandescent: "burning",
  emaciated: "skinny", corpulent: "fat", bulbous: "bulging", diminutive: "tiny",
  vestigial: "useless", prehensile: "gripping", appendage: "limb",
  visage: "face", maw: "mouth", talon: "claw", tendril: "tentacle",
  putrid: "rotting", fetid: "stinking", desiccated: "dried",
  humanoid: "person-shaped", quadruped: "four-legged", plumage: "feathers",
};

/* ON THE APPEARANCE PARAPHRASE (§6 step 5, and F10-F12).

   A player does not paraphrase the Monster Manual. They describe a thing they saw once,
   from memory, in about eight words, and they remember its SHAPE far better than its
   colour. So the model is: take the monster's description document, keep a handful of
   content words biased towards morphology, and — half the time — repaint it, because
   the DM who wants to preserve a surprise changes the colour and nothing else.

   That last step is the only place reflavouring is modelled anywhere in this harness,
   and it is the exact thing F12's colour downweighting exists to survive. A scorer that
   trusts colour will be punished here, which is the point. */

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

/* The symptoms a party reports when the thing acted like a boss. These are the ontology
   ids that resolve to legendary actions or a lair, and they are the observations a DM's
   promotion of an ordinary monster would produce. */
const BOSS_SYMPTOMS = ["it-acted-out-of-turn", "the-room-itself-attacked-us",
                       "something-happened-at-the-start-of-its-turn"];
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

  /* ROLLS INSTEAD OF MEMORY.

     The party usually does not know a monster's AC — but they know what they rolled and
     whether it hit, which bounds the AC exactly and cannot be misremembered. This
     generates that: a handful of d20 totals either side of the true value, split into
     hits and misses, exactly as the tool asks for them.

     Note what this does NOT corrupt. The bounds are derived from the monster's REAL AC,
     because that is what actually happens at a table: the dice do not lie even when the
     players do. So this is the one observation the DM cannot fudge and the party cannot
     misremember, and measuring it against the remembered-number path is the point —
     `--rolls 1 --numeric-noise` would be the comparison if the numbers were also
     perturbed, which acShift already does for the point-estimate path. */
  if (o.rollRate > 0 && r() < o.rollRate && typeof m.ac === "number" && m.ac > 0) {
    const hits = [], misses = [];
    const swings = 3 + Math.floor(r() * 3);
    for (let i = 0; i < swings; i++) {
      // A d20 total in the neighbourhood of the AC, so the bounds actually bracket it.
      const total = m.ac - 4 + Math.floor(r() * 9);
      if (total >= m.ac) hits.push(total); else misses.push(total);
    }
    if (hits.length || misses.length) {
      obs.acRange = { lo: misses.length ? Math.max.apply(null, misses) : null,
                      hi: hits.length ? Math.min.apply(null, hits) : null,
                      contradiction: false };
      delete obs.ac;               // the dice replace the memory, they do not join it
      notes.push(`ac: rolled bounds ${obs.acRange.lo}-${obs.acRange.hi}`);
    }
  }

  /* BOSS DRIFT — handoff §7's second open question, made measurable.

     "Should legendary and lair actions be a separate trust tier? They are strong
      signals but GMs add and remove them freely."

     Removal is already modelled and already free: dropout deletes observations, and
     F2 charges nothing for a feature the party never mentioned. So a DM who strips
     legendary actions off a dragon costs this tool nothing.

     ADDITION is the untested half, and it is the one that can hurt. A DM who promotes
     an ordinary monster to a boss — giving an owlbear legendary actions and a lair —
     hands the party a true observation of something the statblock does not have. Under
     missFactor 1.0 that is charged against the real answer at full price, which is
     exactly the case for asking whether these belong in their own trust tier.

     So: pick a monster that has NEITHER, and report the symptom anyway. Deliberately
     only for monsters lacking the feature, because a boss that already is one produces
     no drift — this isolates the addition case rather than diluting it. */
  if (o.bossDriftRate > 0 && r() < o.bossDriftRate) {
    const hasBoss = (m.legendary || []).length > 0 || m.hasLair;
    if (!hasBoss) {
      const sym = pick(r, BOSS_SYMPTOMS);
      obs.symptoms = (obs.symptoms || []).concat([sym]);
      notes.push(`symptoms: +${sym} (the DM made it a boss)`);
    }
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

  /* 2b. The rebuild. §6's AC and HP shifts move the two numbers independently and at
     random, which models a DM nudging a stat — not the case F5 was designed for. A DM who
     rebuilds a monster to threaten a different party moves AC and HP TOGETHER, up the
     power curve, and leaves the creature's shape intact: still unusually armoured for its
     weight, still unusually tough for its weight.

     crShift models that properly. It relocates the monster to another CR and preserves
     its residuals, which is the exact scenario the residual machinery claims to survive.
     Without this, an evaluation of F5 is an evaluation of something else. */
  if (o.crShift && o.numerics && m.crNum != null) {
    const shift = (r() * 2 - 1) * o.crShift;
    const newCr = Math.max(0, Math.min(30, m.crNum + shift));
    if (typeof full.ac === "number") {
      const residual = full.ac - o.numerics.expectedAc(m.crNum);
      full.ac = Math.max(1, Math.round(o.numerics.expectedAc(newCr) + residual));
    }
    if (typeof full.hp === "number") {
      const residual = Math.log(full.hp) - o.numerics.expectedLogHp(m.crNum);
      full.hp = Math.max(1, Math.round(Math.exp(o.numerics.expectedLogHp(newCr) + residual)));
    }
    notes.push(`rebuilt CR ${m.crNum} -> ${newCr.toFixed(1)}`);
  }

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

  /* 6. Somebody caught a name. */
  if (o.heardRate > 0 && r() < o.heardRate) {
    let heard = m.name;
    if (o.allNames && o.allNames.length && r() < o.mishearRate) {
      heard = pick(r, o.allNames);                       // wrong creature entirely
      notes.push(`misheard the name as "${heard}"`);
    } else if (r() < o.garbleRate) {
      heard = garble(heard, r);
      notes.push(`heard the name as "${heard}"`);
    }
    obs.heardName = heard;
  }

  /* 5. Describe it. Only sometimes: plenty of parties never volunteer a description,
     and the ones who do give a few words rather than a paragraph. */
  if (o.describeRate > 0 && o.documents && r() < o.describeRate) {
    const text = o.documents[m.key];
    if (text) {
      const said = paraphrase(text, r, o);
      if (said) { obs.appearance = said; notes.push(`described as "${said}"`); }
    }
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

/* One or two character edits, the way a name sounds different from how it is spelled.
   Deliberately small: "barghast" for "barghest", not an anagram. */
function garble(name, r) {
  const chars = name.split("");
  const edits = 1 + (r() < 0.3 ? 1 : 0);
  for (let i = 0; i < edits && chars.length > 3; i++) {
    const at = 1 + Math.floor(r() * (chars.length - 2));   // never the first letter
    if (!/[a-z]/i.test(chars[at])) continue;
    const roll = r();
    if (roll < 0.5) chars[at] = "aeiou"[Math.floor(r() * 5)];   // vowel confusion, the commonest
    else if (roll < 0.8) chars.splice(at, 1);
    else chars.splice(at, 0, chars[at]);
  }
  return chars.join("");
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

/* Words the paraphrase can repaint with. Deliberately the same list the scorer
   downweights, so a recoloured description is one the scorer could be fooled by. */
const PALETTE = ["red", "green", "blue", "black", "white", "grey", "brown", "purple",
  "golden", "pale", "crimson", "ashen"];

/* Turn a monster's description document into the eight words a player would offer.
   `describe` and `isMorphology` come from src/appearance.js, passed in rather than
   imported so this file keeps no opinion about how documents are built. */
function paraphrase(text, r, o) {
  const words = String(text || "").toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/)
    .filter(w => w.length > 3);
  if (!words.length) return "";

  const isColour = o.isColour || (() => false);
  const isMorph = o.isMorphology || (() => false);
  /* A word counts as sayable if it is plain visual vocabulary OR one of the book's fancier
     description words. The fancy ones have to be in the pool for synonymRate to have
     anything to substitute — that is the whole vocabulary-gap experiment. */
  const plainVisual = o.isVisual || (() => true);
  const isVisual = w => plainVisual(w) || Object.prototype.hasOwnProperty.call(SYNONYMS, w);

  /* Draw from the words a player could plausibly have SAID, not from the book's prose at
     large. Without this the sample was 96% lore vocabulary — "windborne family nature
     civilized" for a yeti — and BM25 scored 84% because a bag of seven words lifted
     verbatim out of a document is very nearly a fingerprint for it. That measured
     document retrieval, not monster identification. */
  const visual = words.filter(isVisual);
  if (visual.length < 3) return "";        // nothing visual on record: the party says nothing
  const pool = visual.map(w => ({ w, weight: isMorph(w) ? 3 : isColour(w) ? 1.5 : 1 }));
  const kept = [];
  const want = Math.min(o.describeWords || 6, pool.length);
  while (kept.length < want && pool.length) {
    let total = pool.reduce((n, x) => n + x.weight, 0);
    let roll = r() * total, i = 0;
    while (i < pool.length - 1 && (roll -= pool[i].weight) > 0) i++;
    const [taken] = pool.splice(i, 1);
    if (!kept.includes(taken.w)) kept.push(taken.w);
  }

  const recolour = o.recolourRate == null ? 0.5 : o.recolourRate;
  return kept.map(w => {
    // The DM repainted it. Everything else about the description stays true.
    if (isColour(w) && r() < recolour) return pick(r, PALETTE);
    // The player says it in their own words rather than the book's.
    if (SYNONYMS[w] && r() < (o.synonymRate || 0)) return SYNONYMS[w];
    return w;
  }).join(" ");
}

module.exports = { rng, pick, shuffled, corrupt, corruptViable, fullObservation, buildVocab,
                   paraphrase, garble, PALETTE, SYNONYMS, DEFAULTS, DAMAGE_TYPES, SET_FIELDS, UNMODELLED };
