/* Normalisation tests — the six shapes raw 5e.tools data takes that a naive
   reader gets wrong, plus _copy resolution.

   These matter more than they look. Every weight in the scorer is derived from
   how often a feature occurs across the corpus, so a normalisation bug doesn't
   produce a visibly wrong statblock — it produces a subtly wrong *ranking*,
   which is exactly the failure mode nobody catches by eye.

   Run: node tests/normalize.test.js
*/
"use strict";
const N = require("../src/normalize.js");
const { assert, assertEqual, section, report } = require("./harness.js");

/* ---------- 1. _copy resolution ---------- */
section("_copy resolution");
{
  const base = {
    name: "Air Elemental", source: "MM", size: ["L"], type: "elemental",
    ac: [15], hp: { average: 90, formula: "12d10 + 24" },
    speed: { walk: 0, fly: 90, canHover: true },
    immune: ["poison"], conditionImmune: ["exhaustion", "petrified", "poisoned"],
    trait: [{ name: "Air Form", entries: ["The elemental can enter a hostile creature's space."] }],
    action: [{ name: "Slam", entries: ["{@atk mw} {@hit 8} to hit, reach 5 ft. {@h}14 ({@damage 2d8 + 5}) bludgeoning damage."] }],
    cr: "5",
  };
  const copy = {
    name: "Acidic Mist Apparition", source: "HOMEBREW",
    _copy: {
      name: "Air Elemental", source: "MM",
      _mod: {
        "*": { mode: "replaceTxt", replace: "elemental", with: "apparition" },
        trait: { mode: "appendArr", items: [{ name: "Corrosive", entries: ["Acid seeps from it."] }] },
        action: { mode: "removeArr", names: ["Whirlwind"] },
      },
    },
    cr: "6",
  };
  const index = {};
  [base, copy].forEach(m => { index[m.name.toLowerCase() + "|" + m.source.toLowerCase()] = m; });
  const out = N.parseMonster(N.resolveCopy(copy, index, 0));

  assertEqual("a copy inherits its base's AC", out.ac, 15);
  assertEqual("...and its base's HP", out.hpAvg, 90);
  assertEqual("...and its base's immunities", out.immune, ["poison"]);
  assertEqual("...and its base's condition immunities", out.conditionImmune, ["exhaustion", "petrified", "poisoned"]);
  assertEqual("a copy's own literal field overrides the inherited one", out.cr, "6");
  assertEqual("...and it keeps its own name, never the base's", out.name, "Acidic Mist Apparition");
  assert("replaceTxt rewrites the inherited prose", /apparition/i.test(out.traits[0].text));
  assert("...and does not leave the replaced word behind", !/elemental/i.test(out.traits[0].text));
  assertEqual("...but must never rewrite the record's own identity", out.name, "Acidic Mist Apparition");
  assertEqual("appendArr adds a trait on top of the inherited ones", out.traits.length, 2);
  assertEqual("...at the end", out.traits[1].name, "Corrosive");
  assertEqual("removeArr naming something absent leaves the list alone", out.actions.length, 1);
  assertEqual("a resolved copy records what it came from", out.copiedFrom, "Air Elemental");
  assert("...and is not flagged partial when every mod applied", !out.partial);

  // The failure the header warns about: a base in a file the user didn't load.
  const orphan = N.resolveCopy(copy, {}, 0);
  assert("a copy whose base is missing resolves to itself, not to a crash", orphan.name === "Acidic Mist Apparition");
  assertEqual("...and carries none of the base's features to be counted", N.parseMonster(orphan).ac, null);
}

section("_copy: partial resolution is flagged, not hidden");
{
  const base = { name: "Mage", source: "MM", ac: [12], hp: { average: 40 }, spellcasting: [{ name: "Spellcasting", headerEntries: ["It is a 9th-level spellcaster."] }] };
  const copy = {
    name: "Archmage", source: "MM",
    _copy: { name: "Mage", source: "MM", _mod: { spellcasting: { mode: "replaceSpells", spells: {} } } },
  };
  const index = { "mage|mm": base, "archmage|mm": copy };
  const out = N.parseMonster(N.resolveCopy(copy, index, 0));
  assert("an unsupported spell-list mod flags the record partial", out.partial);
  assertEqual("...while everything else still resolved", out.ac, 12);

  const templated = { name: "Half-Dragon", source: "MM", _copy: { name: "Mage", source: "MM", _templates: [{ name: "Half-Dragon" }] } };
  assert("a _templates copy is flagged partial too",
    N.parseMonster(N.resolveCopy(templated, Object.assign({}, index, { "half-dragon|mm": templated }), 0)).partial);
}

section("_copy: chains and cycles");
{
  const a = { name: "A", source: "X", ac: [11], hp: { average: 10 } };
  const b = { name: "B", source: "X", _copy: { name: "A", source: "X" }, hp: { average: 20 } };
  const c = { name: "C", source: "X", _copy: { name: "B", source: "X" } };
  const index = { "a|x": a, "b|x": b, "c|x": c };
  const out = N.parseMonster(N.resolveCopy(c, index, 0));
  assertEqual("a copy of a copy inherits down the whole chain", out.ac, 11);
  assertEqual("...taking the nearest override", out.hpAvg, 20);

  const l1 = { name: "L1", source: "X", _copy: { name: "L2", source: "X" } };
  const l2 = { name: "L2", source: "X", _copy: { name: "L1", source: "X" } };
  const cyc = { "l1|x": l1, "l2|x": l2 };
  let threw = false;
  try { N.resolveCopy(l1, cyc, 0); } catch (e) { threw = true; }
  assert("a cyclic _copy chain gives up rather than blowing the stack", !threw);
}

/* ---------- 2. conditional AC arrays ---------- */
section("ac");
{
  assertEqual("a bare number is the AC", N.acInfo(15).ac, 15);
  assertEqual("an array takes the FIRST entry as the number", N.acInfo([{ ac: 12, from: ["natural armor"] }, { ac: 15, condition: "with mage armor" }]).ac, 12);
  assert("...while the text keeps every conditional entry, which is itself evidence",
    /mage armor/.test(N.acInfo([{ ac: 12 }, { ac: 15, condition: "with {@spell mage armor}" }]).acText));
  assertEqual("an AC that is only prose yields no number rather than NaN", N.acInfo([{ special: "13 + Dex modifier" }]).ac, null);
  assert("...and keeps the prose", /13 \+ Dex/.test(N.acInfo([{ special: "13 + Dex modifier" }]).acText));
  assertEqual("a missing AC is null, not 0 — 0 would rank as a real observation", N.acInfo(undefined).ac, null);
}

/* ---------- 3. cr as an object (lair / coven) ---------- */
section("cr");
{
  assertEqual("a plain CR passes through", N.parseMonster({ name: "x", cr: "5" }).cr, "5");
  assertEqual("...as a number for residual scoring", N.parseMonster({ name: "x", cr: "5" }).crNum, 5);
  assertEqual("a lair CR resolves to the base number, not the lair one",
    N.parseMonster({ name: "x", cr: { cr: "13", lair: "14" } }).cr, "13");
  assertEqual("a coven CR resolves to the coven value when there is no base",
    N.parseMonster({ name: "x", cr: { coven: "5" } }).cr, "5");
  assertEqual("fractional CRs become numbers", N.crToNum("1/4"), 0.25);
  assertEqual("...including 1/8", N.crToNum("1/8"), 0.125);
  assertEqual("CR 0 is zero, not null", N.crToNum("0"), 0);
  assertEqual("an unparseable CR is null so it can be skipped rather than counted as 0", N.crToNum("Unknown"), null);
}

/* ---------- 4. type with tags ---------- */
section("type");
{
  assertEqual("a string type has no tags", N.typeInfo("dragon"), { type: "dragon", alt: [], tags: [] });
  assertEqual("an object type splits into type and tags",
    N.typeInfo({ type: "humanoid", tags: ["elf"] }), { type: "humanoid", alt: [], tags: ["elf"] });
  assertEqual("...including the {tag, prefix} object form",
    N.typeInfo({ type: "humanoid", tags: [{ tag: "goblinoid", prefix: "any" }] }), { type: "humanoid", alt: [], tags: ["goblinoid"] });
  assertEqual("a missing type yields empty rather than undefined", N.typeInfo(undefined), { type: "", alt: [], tags: [] });

  /* The Empyrean is "celestial or fiend" and the book does not choose. Nesting a
     {choose} inside `type` is rare enough to look like a data error and common enough
     to crash the ranker: before this was handled, `type` came back as an object and
     every facet that lowercased it threw. */
  assertEqual("a type the book leaves undecided keeps its first option as the type",
    N.typeInfo({ type: { choose: ["celestial", "fiend"] } }), { type: "celestial", alt: ["fiend"], tags: [] });
  assertEqual("...and an undecided type still carries its tags",
    N.typeInfo({ type: { choose: ["celestial", "fiend"] }, tags: ["titan"] }).tags, ["titan"]);
  assert("...and the type is always a string, whatever shape it arrived in",
    ["dragon", { type: "humanoid" }, { type: { choose: ["fey"] } }, undefined, 7]
      .every(t => typeof N.typeInfo(t).type === "string"));
}

/* A copy borrows the base's MECHANICS, never its bibliography. Letting srd/basicRules
   ride along made 879 of the real corpus's 1,141 copies claim SRD membership they don't
   have — The Bagman is a _copy of the Troll, so it arrived flagged as a Basic Rules
   monster — and page numbers pointed into the wrong book. */
section("_copy does not inherit publication metadata");
{
  const index = {
    "troll|mm": { name: "Troll", source: "MM", srd: true, basicRules: true, page: 291, size: ["L"] },
  };
  const copy = N.resolveCopy({ name: "The Bagman", source: "VRGR", page: 225,
    _copy: { name: "Troll", source: "MM" } }, index, 0);

  assertEqual("the copy keeps its own name", copy.name, "The Bagman");
  assertEqual("...and its own source", copy.source, "VRGR");
  assertEqual("a copy does not inherit the base's SRD membership", copy.srd, undefined);
  assertEqual("...nor its Basic Rules membership", copy.basicRules, undefined);
  assertEqual("...and keeps its own page rather than the base's", copy.page, 225);
  assertEqual("mechanics are still inherited, which is the point of a copy", copy.size, ["L"]);

  // A copy that declares its own publication metadata keeps what it declared.
  const declared = N.resolveCopy({ name: "Scrag", source: "TftYP", srd: true,
    _copy: { name: "Troll", source: "MM" } }, index, 0);
  assertEqual("a copy that states its own SRD membership keeps it", declared.srd, true);
}

/* ---------- 5. hp.special ---------- */
section("hp");
{
  assertEqual("an ordinary hp block gives an average", N.hpInfo({ average: 45, formula: "7d8 + 14" }).avg, 45);
  assertEqual("hp.special replaces the average outright", N.hpInfo({ special: "50 (equal to half your hit points)" }).avg, null);
  assert("...and the prose is kept", /half your hit points/.test(N.hpInfo({ special: "50 (equal to half your hit points)" }).special));
  assertEqual("a missing hp block is null, not 0", N.hpInfo(undefined).avg, null);
}

/* ---------- 6. conditional speeds ---------- */
section("speed");
{
  assertEqual("a bare number is a walk speed", N.speedInfo(30).speeds, { walk: 30 });
  assertEqual("every movement mode is captured separately",
    N.speedInfo({ walk: 20, fly: 60, swim: 40 }).speeds, { walk: 20, fly: 60, swim: 40 });
  assertEqual("a conditional speed still yields its number",
    N.speedInfo({ walk: 30, fly: { number: 60, condition: "(in raven form)" } }).speeds, { walk: 30, fly: 60 });
  assert("...and the condition survives in the text", /raven form/.test(N.speedInfo({ fly: { number: 60, condition: "(in raven form)" } }).text));
  assert("hover is recorded — it separates an air elemental from a giant eagle", N.speedInfo({ fly: 90, canHover: true }).hover);
  assertEqual("a walk speed of 0 is kept, not dropped as falsy", N.speedInfo({ walk: 0, fly: 50 }).speeds.walk, 0);
}

/* ---------- damage interactions ---------- */
section("resistances, immunities, vulnerabilities");
{
  const r = N.dmgTypes(["fire", "cold"], "resist");
  assertEqual("a plain list flattens", r.flat, ["fire", "cold"]);
  const grouped = N.dmgTypes([{ resist: ["bludgeoning", "piercing", "slashing"], note: "from nonmagical attacks", cond: true }], "resist");
  assertEqual("a grouped entry flattens to its types", grouped.flat, ["bludgeoning", "piercing", "slashing"]);
  assert("...and the qualifier is preserved, because it changes what the players observed",
    /nonmagical/.test(grouped.text));
  const mixed = N.dmgTypes(["fire", { resist: ["piercing"], note: "from nonmagical attacks" }], "resist");
  assertEqual("a mixed list keeps both halves", mixed.flat, ["fire", "piercing"]);
  assertEqual("duplicates collapse so a type can't be double-counted as evidence",
    N.dmgTypes(["fire", "fire"], "resist").flat, ["fire"]);
}

/* ---------- actions ---------- */
section("actions");
{
  const a = N.parseAction({
    name: "Bite {@recharge 5}",
    entries: ["{@atk mw} {@hit 7} to hit, reach 10 ft., one target. {@h}11 ({@damage 2d6 + 4}) piercing damage plus 7 ({@damage 2d6}) acid damage."],
  }, "action");
  assertEqual("an attack's to-hit is pulled out", a.hit, 7);
  assertEqual("...its reach", a.reach, 10);
  assertEqual("...every damage expression, not just the first", a.dmg, ["2d6 + 4", "2d6"]);
  assert("...and it is marked as an attack", a.isAttack);
  assertEqual("a recharge in the NAME is spelled out rather than stripped to a bare number",
    a.name, "Bite (Recharge 5-6)");
  const s = N.parseAction({ name: "Petrifying Gaze", entries: ["...must succeed on a {@dc 13} Constitution saving throw..."] }, "action");
  assertEqual("a save DC is pulled out", s.dc, 13);
  assertEqual("...along with the ability", s.saveAbil, "Con");
  assert("...and it is not an attack", !s.isAttack);
}

/* ---------- multiattack ---------- */
section("attacks per turn");
{
  /* Every case here is a real statblock that a previous version of the parser got
     wrong. The count is evidence the party can actually report — they counted the
     attack rolls — so a wrong number argues against the right monster. */
  const count = text => N.parseMonster({
    name: "X", source: "T", action: [{ name: "Multiattack", entries: [text] }],
  }).attacksPerTurn;

  assertEqual("no Multiattack means no claim, not zero attacks",
    N.parseMonster({ name: "X", source: "T" }).attacksPerTurn, 0);

  // The bug the playtest found: more than one word between the count and "attacks".
  assertEqual("a two-word attack name still counts (Mind's Eye Matter Smith)",
    count("The matter smith makes two Manifested Force attacks."), 2);
  assertEqual("...and a five-word one (Alhoon)",
    count("The alhoon makes two Chilling Grasp or Arcane Bolt attacks."), 2);

  // 1. Stated total wins over its own breakdown.
  assertEqual("a stated total is not added to the breakdown that follows it",
    count("The knight makes two attacks: one with its bite and one with its claws."), 2);
  assertEqual("...and 'can make' reads the same as 'makes'",
    count("The marilith can make seven attacks: six with its longswords and one with its tail."), 7);

  // 2. "or" means alternatives.
  assertEqual("alternatives are the largest option, not their sum",
    count("It makes two Branch attacks, two Radiant Pellet attacks, or one of each."), 2);

  // 3. Additive.
  assertEqual("distinct attacks are summed",
    count("The beast makes one Bite attack and two Claw attacks."), 3);

  // Sentences that restate rather than extend.
  assertEqual("a replacement clause does not add attacks",
    count("The dragon makes three Rend attacks. It can replace one attack with a use of Spellcasting."), 3);
  assertEqual("...nor an 'Alternatively' sentence",
    count("The giant makes three Soul Burst attacks. Alternatively, it can make three Reaping Scythe attacks."), 3);
  assertEqual("...nor a back-reference to attacks already counted (Duergar Despot)",
    count("The duergar makes two Iron Fist attacks and two Stomping Foot attacks. " +
          "After one of the attacks, the duergar can move up to half its speed."), 4);

  // 4. The verb form, fallback only.
  assertEqual("the old verb phrasing is read when there is no noun to anchor on",
    count("Auril attacks twice with her talons."), 2);
  assertEqual("...and sums across it (Archduke Zariel)",
    count("Zariel attacks twice with her flail and once with Matalotok."), 3);

  // Silence, not a guess.
  assertEqual("a count that depends on the spell slot yields no claim",
    count("The spirit makes a number of attacks equal to half this spell's level."), 0);
  assertEqual("...as does one that depends on the creature's own state",
    count("The hydra makes as many bite attacks as it has heads."), 0);
  assertEqual("an absurd total is a misparse, and says nothing rather than something wrong",
    count("It makes nine Bite attacks and nine Claw attacks."), 0);
}

/* ---------- whole-corpus ingest ---------- */
section("ingest");
{
  const fileA = [{ name: "Goblin", source: "MM", ac: [15], hp: { average: 7 }, cr: "1/4", type: "humanoid" }];
  const fileB = [{ name: "Goblin Boss", source: "MM", _copy: { name: "Goblin", source: "MM" }, hp: { average: 21 }, cr: "1" }];
  const { monsters, skipped } = N.ingest([fileA, fileB]);
  assertEqual("both files ingest", monsters.length, 2);
  assertEqual("nothing was skipped", skipped.length, 0);
  const boss = monsters.find(m => m.name === "Goblin Boss");
  assertEqual("a copy resolves across FILE boundaries — the whole reason ingest indexes first", boss.ac, 15);
  assertEqual("...taking its own overrides", boss.hpAvg, 21);
  assertEqual("results are sorted by name", monsters.map(m => m.name), ["Goblin", "Goblin Boss"]);

  const dupes = N.ingest([[{ name: "Goblin", source: "MM", ac: [15] }], [{ name: "Goblin", source: "MM", ac: [13] }]]);
  assertEqual("the same monster in two files is counted once, not twice", dupes.monsters.length, 1);

  const bad = N.ingest([[{ name: "Fine", source: "X" }, { notAName: true }]]);
  assertEqual("a record with no name is ignored rather than throwing", bad.monsters.length, 1);
}

report("normalize");
