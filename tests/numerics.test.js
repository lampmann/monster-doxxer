/* Numeric scoring tests — F4, F5, F6.

   F4 is tolerance curves, never equality. F5 is residuals from the CR average.
   F6 is the "assume this was rebuilt" toggle.

   The interesting assertion here is a negative one. F5 is implemented and is NOT
   the default, because the harness says it loses to a plain tolerance curve in
   every formulation, including the coherent-rebuild case it was designed for. The
   `residual` mode is kept so that finding stays reproducible, and the test below
   pins the reason it fails: infer a CR from HP, take HP's residual at that CR, and
   you get zero every time. That is a property of the arithmetic, not of the data,
   so it belongs in a unit test rather than only in a benchmark.

   Run: node tests/numerics.test.js
*/
"use strict";
const S = require("../src/score.js");
const { assert, assertEqual, assertClose, section, report } = require("./harness.js");

/* A synthetic corpus with a clean power curve: AC rises gently with CR, HP rises
   exponentially, and a couple of monsters sit deliberately off the curve. */
function corpus() {
  const out = [];
  for (let cr = 0; cr <= 20; cr++) {
    for (let i = 0; i < 12; i++) {
      out.push({
        key: `M${cr}-${i}|T`, name: `M${cr}-${i}`, source: "T",
        type: "beast", typeAlt: [], typeTags: [], size: ["medium"], speeds: { walk: 30 },
        senseTags: [], conditionImmune: [], traitTags: [], actionTags: [], damageTags: [],
        resist: [], immune: [], vulnerable: [], symptoms: [], partial: false,
        crNum: cr, ac: 12 + cr / 2, hpAvg: Math.round(20 * Math.exp(cr / 6)),
      });
    }
  }
  return out;
}
const MONS = corpus();
const NUM = S.buildNumerics(MONS);
const R = S.buildRarity(MONS);

const mon = over => Object.assign({
  key: "X|T", name: "X", source: "T", crNum: 10, ac: 17, hpAvg: 103,
}, over);

/* ---------- the CR curve ---------- */
section("F5 — the CR curve is measured off the corpus");
{
  assert("the curve covers the corpus's CR range", NUM.rows.length >= 20);
  assert("expected HP rises with CR", NUM.rows.every((r, i, a) => i === 0 || a[i - 1].logHp <= r.logHp));
  assert("expected AC rises with CR", NUM.expectedAc(20) > NUM.expectedAc(1));
  assert("a CR between two buckets interpolates rather than snapping",
    NUM.expectedAc(5.5) > NUM.expectedAc(5) && NUM.expectedAc(5.5) < NUM.expectedAc(6));
  assert("a CR above the corpus clamps rather than extrapolating to nonsense",
    Number.isFinite(NUM.expectedAc(99)) && NUM.expectedAc(99) === NUM.expectedAc(20));
}

section("F5 — inferring the CR the party actually fought");
{
  const at10 = NUM.inferCr({ hp: Math.round(20 * Math.exp(10 / 6)) });
  assertClose("HP alone recovers roughly the right CR", at10.cr, 10, 1);
  assertEqual("...and says where it came from", at10.from, "hp");

  assert("a tougher monster implies a higher CR",
    NUM.inferCr({ hp: 400 }).cr > NUM.inferCr({ hp: 40 }).cr);
  assertEqual("AC alone is used only when there is no HP", NUM.inferCr({ ac: 16 }).from, "ac");
  assertEqual("both numbers are fitted together when both are present",
    NUM.inferCr({ ac: 17, hp: 103 }).from, "both");
  assertEqual("nothing to infer from yields nothing rather than a default", NUM.inferCr({}), null);
}

/* THE reason F5 is off. This is arithmetic, not data. */
section("F5 — why the handoff's residual cancels itself out");
{
  const hp = 250;
  const implied = NUM.inferCr({ hp });
  const residual = Math.log(hp) - NUM.expectedLogHp(implied.cr);
  assertClose("a CR inferred from HP leaves HP with no residual at all — every time", residual, 0, 1e-6);

  // Fitting both numbers at once leaves something behind, which is the corrected form.
  const odd = { ac: 22, hp: 60 };            // heavily armoured, not very tough
  const fit = NUM.inferCr(odd);
  const acRes = odd.ac - NUM.expectedAc(fit.cr);
  const hpRes = Math.log(odd.hp) - NUM.expectedLogHp(fit.cr);
  assert("fitting one CR to two numbers cannot zero both, so information survives",
    Math.abs(acRes) > 0.5 || Math.abs(hpRes) > 0.05);
}

/* ---------- F4 ---------- */
section("F4 — tolerance curves, never equality");
{
  const obs = { ac: 17, hp: 103 };
  const exact = S.scoreNumerics(mon(), obs, NUM, {});
  const near = S.scoreNumerics(mon({ ac: 19, hpAvg: 130 }), obs, NUM, {});
  const far = S.scoreNumerics(mon({ ac: 30, hpAvg: 5 }), obs, NUM, {});

  assert("an exact match scores highest", exact.credit > near.credit);
  assert("...a near miss still scores, rather than being excluded", near.credit > 0);
  assert("...and a wild mismatch decays towards nothing", far.credit < near.credit * 0.5);
  assert("numbers never subtract — they are tier 2, and DMs retune them (F3)",
    [exact, near, far].every(x => x.credit >= 0));
  assert("...but a mismatch still costs, because it earns none of the weight it supplied",
    far.credit < far.supplied * 0.5);

  assertClose("every candidate is asked for the same amount of evidence",
    exact.supplied, far.supplied, 1e-9);
}

section("F4 — HP is compared on a log scale, so error is relative not absolute");
{
  // 40 HP out is most of a CR-1 monster and a rounding error on a CR-18 one.
  const lowFit = S.scoreNumerics(mon({ crNum: 1, hpAvg: 60 }), { hp: 20 }, NUM, {}).credit;
  const highFit = S.scoreNumerics(mon({ crNum: 18, hpAvg: 340 }), { hp: 300 }, NUM, {}).credit;
  assert("the same absolute HP gap hurts far more at the bottom of the range", highFit > lowFit);

  const same = S.scoreNumerics(mon({ crNum: 1, hpAvg: 30 }), { hp: 20 }, NUM, {}).credit;
  const scaled = S.scoreNumerics(mon({ crNum: 18, hpAvg: 300 }), { hp: 200 }, NUM, {}).credit;
  assertClose("...while the same PROPORTIONAL gap costs the same at either end", same, scaled, 0.02);
}

/* ---------- F6 ---------- */
section("F6 — 'assume this was rebuilt' drops the numbers' weight");
{
  const obs = { ac: 17, hp: 103 };
  const normal = S.scoreNumerics(mon(), obs, NUM, {});
  const retuned = S.scoreNumerics(mon(), obs, NUM, { retuned: true });
  assert("the toggle cuts what the numbers are worth", retuned.supplied < normal.supplied * 0.2);
  assert("...but does not switch them off entirely", retuned.supplied > 0);

  // The point of the toggle: a badly retuned monster stops being punished for it.
  const wrong = { ac: 25, hp: 900 };
  const hurt = S.scoreNumerics(mon(), wrong, NUM, {});
  const forgiven = S.scoreNumerics(mon(), wrong, NUM, { retuned: true });
  assert("a monster the DM rebuilt loses far less to its numbers under the toggle",
    (hurt.supplied - hurt.credit) > (forgiven.supplied - forgiven.credit) * 5);
}

/* ---------- integration ---------- */
section("numbers as evidence inside a full ranking");
{
  const target = MONS.find(m => m.crNum === 14);
  const obs = { type: "beast", ac: target.ac, hp: target.hpAvg };
  const ranked = S.rank(MONS, obs, R, { numerics: NUM, limit: 5 });
  const crOf = name => MONS.find(m => m.name === name).crNum;
  assertClose("the top result sits at the CR the numbers imply", crOf(ranked[0].name), 14, 1);
  assert("...and so does the rest of the shortlist, since only the numbers separate them",
    ranked.every(r => Math.abs(crOf(r.name) - 14) <= 1));

  assert("a query of numbers alone is scoreable", S.hasEvidence({ ac: 17 }));
  assert("...and so is HP alone", S.hasEvidence({ hp: 200 }));
  assertEqual("...while an empty query still isn't", S.hasEvidence({}), false);

  const off = S.rank(MONS, obs, R, { numerics: NUM, numericMode: "off", limit: 1 })[0];
  const on = S.rank(MONS, obs, R, { numerics: NUM, limit: 1 })[0];
  assert("switching numerics off changes the ranking, so they are actually being used",
    off.score !== on.score);
}

section("robustness");
{
  assertEqual("no numerics table means no numeric scoring rather than a crash",
    S.scoreNumerics(mon(), { ac: 17 }, null, {}).credit, 0);
  assertEqual("an observation with no numbers contributes nothing",
    S.scoreNumerics(mon(), { type: "beast" }, NUM, {}).supplied, 0);

  const noStats = mon({ ac: null, hpAvg: null });
  const res = S.scoreNumerics(noStats, { ac: 17, hp: 103 }, NUM, {});
  assertEqual("a candidate with no AC or HP earns nothing", res.credit, 0);
  assert("...but is still asked for the evidence, so it can't win by having no stats",
    res.supplied > 0);

  const noCr = S.scoreNumerics(mon({ crNum: null }), { ac: 17, hp: 103 }, NUM, { numericMode: "residual" });
  assert("a candidate with no CR falls back to raw rather than dropping out", noCr.credit > 0);

  assertEqual("an empty corpus yields a usable, empty curve", S.buildNumerics([]).rows, []);
  assertEqual("...and infers nothing from it rather than a NaN CR",
    S.buildNumerics([]).inferCr({ hp: 10 }), null);
  assert("...and scoring against it is harmless, not NaN",
    S.scoreNumerics(mon(), { ac: 17, hp: 103 }, S.buildNumerics([]), { numericMode: "residual" }).credit >= 0);
  assert("garbage stats are ignored rather than poisoning the curve",
    S.buildNumerics(MONS.concat([mon({ ac: -5, hpAvg: 0, crNum: 3 })])).rows.length > 0);
}

report("numerics");
