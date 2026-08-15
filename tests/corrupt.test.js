/* Corruption model tests — the handoff's §6 evaluation harness.

   The harness is a measuring instrument, and an instrument nobody checks reads
   whatever you hoped for. Two properties matter more than the rest:

     Reproducibility. Two runs on the same seed must produce the same corruptions,
     or a tuning change cannot be told apart from a lucky sample.

     Honest corruption. A "lie" must actually be false, dropout must actually drop,
     and an untested damage type must be ABSENT rather than reported as normal —
     that last one is the difference between "we never tried fire" and "we tried
     fire and nothing happened", and F2 is built on the distinction.

   These run on synthetic monsters. Whether the harness's numbers mean anything
   about the real bestiary is a question for `node eval/run.js` against your own
   data/, not for a unit test that has no bestiary to read.

   Run: node tests/corrupt.test.js
*/
"use strict";
const C = require("../eval/corrupt.js");
const S = require("../src/score.js");
const { assert, assertEqual, section, report } = require("./harness.js");

function mon(over) {
  return Object.assign({
    name: "Test", source: "T", key: "Test|T",
    type: "aberration", typeAlt: [], typeTags: ["shapechanger"], size: ["huge"],
    speeds: { walk: 30, burrow: 30, fly: 60 }, hover: true,
    senseTags: ["Tremorsense", "Darkvision"], conditionImmune: ["charmed", "frightened"],
    traitTags: [], actionTags: [], damageTags: ["acid", "psychic"],
    resist: ["cold"], immune: ["acid"], vulnerable: ["radiant"],
    symptoms: ["it-burrowed-away", "it-healed-between-rounds", "it-vanished"],
    symptomConf: {}, partial: false, ac: 18, hpAvg: 200, cr: "9", crNum: 9,
  }, over);
}

/* ---------- reproducibility ---------- */
section("§6 — the harness can reproduce itself");
{
  const a = C.corrupt(mon(), C.rng(42), {});
  const b = C.corrupt(mon(), C.rng(42), {});
  assertEqual("the same seed produces the same corruption", JSON.stringify(a.obs), JSON.stringify(b.obs));

  const c = C.corrupt(mon(), C.rng(43), {});
  assert("a different seed produces a different one, or the RNG isn't doing anything",
    JSON.stringify(a.obs) !== JSON.stringify(c.obs));

  const r = C.rng(1);
  const draws = Array.from({ length: 500 }, () => r());
  assert("draws stay in [0,1)", draws.every(x => x >= 0 && x < 1));
  const mean = draws.reduce((x, y) => x + y, 0) / draws.length;
  assert("...and are roughly uniform, not clustered at one end", mean > 0.42 && mean < 0.58);
}

/* ---------- the observation ---------- */
section("§6 — the full observation mirrors what the scorer reads");
{
  const full = C.fullObservation(mon());
  assertEqual("movement lists every non-walk speed", full.movement.sort(), ["burrow", "fly"]);
  assertEqual("a damage immunity is reported as immune", full.damage.acid, "immune");
  assertEqual("...a resistance as resistant", full.damage.cold, "resistant");
  assertEqual("...and a vulnerability as vulnerable", full.damage.radiant, "vulnerable");
  assert("a type the monster has no interaction with is absent, not 'normal'", !("fire" in full.damage));

  // If the harness generated a field the scorer ignores, it would be measuring nothing.
  const scored = new Set(["type", "size", "typeTags", "movement", "senses", "condImmune",
    "damageDealt", "symptoms", "damage", "ac", "hp"]);
  assert("every field the harness produces is one the scorer reads",
    Object.keys(full).every(k => scored.has(k)));
}

/* ---------- dropout ---------- */
section("§6 step 1 — delete about 60% of the observations");
{
  const r = C.rng(7);
  let kept = 0, total = 0;
  for (let i = 0; i < 400; i++) {
    const full = C.fullObservation(mon());
    const { obs } = C.corrupt(mon(), r, { swapResistance: false });
    ["movement", "senses", "condImmune", "symptoms", "damageDealt"].forEach(f => {
      total += full[f].length;
      kept += (obs[f] || []).length;
    });
  }
  const rate = kept / total;
  assert(`roughly 40% of observations survive dropout (saw ${(100 * rate).toFixed(0)}%)`,
    rate > 0.3 && rate < 0.5);

  const heavy = C.corrupt(mon(), C.rng(3), { keepRate: 0, swapResistance: false });
  assertEqual("at keepRate 0 nothing structural survives",
    ["movement", "senses", "condImmune", "symptoms", "type", "size"].filter(f => heavy.obs[f]).length, 0);

  const full = C.corrupt(mon(), C.rng(3), { keepRate: 1, damageTestRate: 0, swapResistance: false });
  assertEqual("at keepRate 1 the movement modes all survive", full.obs.movement.sort(), ["burrow", "fly"]);
}

section("§6 — a party reports a handful of odd things, not fifteen");
{
  const many = mon({ symptoms: Array.from({ length: 20 }, (_, i) => "symptom-" + i) });
  for (let seed = 1; seed <= 30; seed++) {
    const { obs } = C.corrupt(many, C.rng(seed), { keepRate: 1, maxSymptoms: 4 });
    if ((obs.symptoms || []).length > 4) {
      assert("symptoms are capped at maxSymptoms", false);
      break;
    }
  }
  assert("symptoms are capped at maxSymptoms", true);
}

/* ---------- numeric drift ---------- */
section("§6 steps 2 and 3 — AC and HP drift");
{
  let acSeen = 0, hpSeen = 0, acWorst = 0, hpWorst = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const { obs } = C.corrupt(mon(), C.rng(seed), { keepRate: 1, acShift: 3, hpShiftFraction: 0.3 });
    if (typeof obs.ac === "number") { acSeen++; acWorst = Math.max(acWorst, Math.abs(obs.ac - 18)); }
    if (typeof obs.hp === "number") { hpSeen++; hpWorst = Math.max(hpWorst, Math.abs(obs.hp - 200) / 200); }
  }
  assert("AC is reported often enough to measure", acSeen > 100);
  assert("...and never drifts further than the configured shift", acWorst <= 3);
  assert("HP is reported often enough to measure", hpSeen > 100);
  assert("...and never drifts further than the configured fraction", hpWorst <= 0.301);
  assert("...and the drift is actually exercised, not always zero", acWorst > 0 && hpWorst > 0);

  const floored = C.corrupt(mon({ ac: 1, hpAvg: 1 }), C.rng(5), { keepRate: 1, acShift: 10, hpShiftFraction: 0.9 });
  assert("a shift can't push AC below 1", floored.obs.ac == null || floored.obs.ac >= 1);
  assert("...nor HP below 1", floored.obs.hp == null || floored.obs.hp >= 1);
}

/* ---------- the lies ---------- */
section("§6 step 4 — a swapped damage interaction is genuinely wrong");
{
  const truth = C.fullObservation(mon());
  let checked = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { obs, notes } = C.corrupt(mon(), C.rng(seed), { keepRate: 1, damageTestRate: 1, swapRate: 1 });
    const note = notes.find(n => n.startsWith("damage "));
    if (!note) continue;
    const type = note.split(" ")[1].replace(":", "");
    const reported = obs.damage[type];
    const actual = truth.damage[type] || "normal";
    if (reported === actual) { assert("a swapped interaction never matches the truth", false); return; }
    checked++;
  }
  assert(`a swapped interaction never matches the truth (checked ${checked})`, checked > 50);

  const clean = C.corrupt(mon(), C.rng(9), { keepRate: 1, damageTestRate: 1, swapRate: 0 });
  assert("at swapRate 0 no damage lie is planted", !clean.notes.some(n => /wrong/.test(n)));
}

section("§6 — the player misremembers a feature they never saw");
{
  const vocab = C.buildVocab([mon(), mon({ senseTags: ["Truesight"], speeds: { walk: 30, swim: 40 },
    conditionImmune: ["poisoned"], symptoms: ["it-flew"], damageTags: ["fire"], typeTags: ["demon"] })]);
  assert("the vocabulary is drawn from the corpus, so a lie is plausible",
    vocab.senses.includes("truesight") && vocab.movement.includes("swim"));

  const truth = C.fullObservation(mon());
  let strays = 0, planted = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { obs, notes } = C.corrupt(mon(), C.rng(seed), { keepRate: 1, strayRate: 1, vocab, swapResistance: false });
    C.SET_FIELDS.forEach(f => (obs[f] || []).forEach(v => { if (!truth[f].includes(v)) strays++; }));
    // Each note names a stray the model believes it planted. The point of a stray is that
    // it is FALSE, so every claimed one must be absent from the truth.
    notes.filter(n => /\(wrong\)$/.test(n)).forEach(n => {
      const [field, value] = n.replace(" (wrong)", "").split(": +");
      if (field && value && !truth[field].includes(value)) planted++;
    });
  }
  assert("misremembering actually plants false observations", strays > 50);
  assertEqual("...and every stray it claims to have planted is genuinely false", planted, strays);

  let none = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const { obs } = C.corrupt(mon(), C.rng(seed), { keepRate: 1, strayRate: 0, vocab, swapResistance: false });
    C.SET_FIELDS.forEach(f => (obs[f] || []).forEach(v => { if (!truth[f].includes(v)) none++; }));
  }
  assertEqual("...and at strayRate 0 it plants none, so the default stays faithful to §6", none, 0);
}

/* ---------- viability ---------- */
section("§6 — an unscoreable query is reported, not counted as a miss");
{
  const viable = C.corruptViable(mon(), C.rng(11), {}, S.hasEvidence);
  assert("a normal monster yields a query with something in it", viable && S.hasEvidence(viable.obs));

  const featureless = {
    name: "Blob", source: "T", key: "Blob|T", type: "", typeTags: [], size: [],
    speeds: {}, hover: false, senseTags: [], conditionImmune: [], damageTags: [],
    resist: [], immune: [], vulnerable: [], symptoms: [], ac: null, hpAvg: null,
  };
  assertEqual("a statblock with no features at all yields null rather than an empty query",
    C.corruptViable(featureless, C.rng(11), { damageTestRate: 0 }, S.hasEvidence), null);
}

report("corrupt");
