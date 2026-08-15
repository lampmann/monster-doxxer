/* Matching a name the party heard.

   The premise: a DM narrates, and narration contains nouns. "The barghest lunges"
   hands a table the word without telling them it names a creature with a statblock.

   Two properties carry the whole feature, and they pull against each other.

   A name has to be STRONG — strong enough to beat the player's own guess about
   what kind of thing it was, which is the case that broke the first implementation.
   And it has to be FORGIVING, twice over: forgiving of spelling, because the name
   arrived through the air rather than on a page, and forgiving of being wrong,
   because the DM may have renamed the creature or invented the word outright. A
   name must never become the filter that "rank, never filter" forbids.

   Run: node tests/names.test.js
*/
"use strict";
const N = require("../src/names.js");
const S = require("../src/score.js");
const { assert, assertEqual, section, report } = require("./harness.js");

function mon(name, over) {
  return Object.assign({
    name, source: "T", key: name + "|T",
    type: "fiend", typeAlt: [], typeTags: [], size: ["medium"], speeds: { walk: 30 },
    senseTags: [], conditionImmune: [], traitTags: [], actionTags: [], damageTags: [],
    resist: [], immune: [], vulnerable: [], symptoms: [], partial: false,
  }, over);
}

const CORPUS = [
  mon("Barghest"), mon("Ghast"), mon("Owlbear"), mon("Owl"),
  mon("Fire Giant"), mon("Frost Giant"), mon("Stone Giant"),
  mon("Gelatinous Cube"),
  mon("Liondrake", { alias: ["Dragonne"] }),
  mon("Ancient Red Dragon", { type: "dragon", shortName: "dragon" }),
];
const INDEX = N.buildNameIndex(CORPUS);
const ranked = q => [...N.nameScore(q, INDEX).entries()].sort((a, b) => b[1] - a[1]);
const best = q => { const r = ranked(q)[0]; return r ? r[0].split("|")[0] : null; };
const scoreOf = (q, name) => N.nameScore(q, INDEX).get(name + "|T") || 0;

section("a name said out loud, spelled however it was heard");
{
  assertEqual("the exact name matches exactly", scoreOf("barghest", "Barghest"), 1);
  assertEqual("...whatever the capitalisation", scoreOf("BARGHEST", "Barghest"), 1);
  assertEqual("...and whatever punctuation came with it", scoreOf("  barghest!  ", "Barghest"), 1);

  assertEqual("a misspelling still finds it", best("barghast"), "Barghest");
  assert("...at nearly full strength, since people write down what they heard",
    scoreOf("barghast", "Barghest") > 0.85);
  assertEqual("a name heard as two words finds the one-word creature", best("owl bear"), "Owlbear");
  assertEqual("a name with a word tacked on still finds it", best("gelatinous cube thing"), "Gelatinous Cube");

  assert("...but a real match still beats a fuzzy one",
    scoreOf("barghest", "Barghest") > scoreOf("barghast", "Barghest"));
  assert("a short name is not fuzzy-matched into a different one — 'owl' is not 'ow'",
    scoreOf("owl", "Owlbear") < scoreOf("owl", "Owl"));
}

section("a partial name narrows without pretending to decide");
{
  assert("'giant' finds the giants", ranked("giant").some(([k]) => /Giant/.test(k)));
  assert("...but not at full strength, because it names three of them",
    scoreOf("giant", "Fire Giant") < 0.85);
  assert("the full name beats the partial one",
    scoreOf("fire giant", "Fire Giant") > scoreOf("giant", "Fire Giant"));
  assertEqual("...and an exact two-word name is exact", scoreOf("fire giant", "Fire Giant"), 1);

  /* A distinctive word should count for more than a common one. "Barghest" appears in one
     name and "giant" in three, and a player who caught only the distinctive half has
     narrowed things far more. */
  assert("a distinctive word is worth more than a common one",
    scoreOf("barghest", "Barghest") > scoreOf("giant", "Fire Giant"));
}

section("alternate names");
{
  assertEqual("a creature answers to its alias", best("dragonne"), "Liondrake");
  assertEqual("...and to the short name its own statblock uses",
    best("dragon") === "Ancient Red Dragon" || best("dragon") === "Liondrake", true);
}

section("a name nobody has heard of is not forced onto something");
{
  assertEqual("gibberish matches nothing at all", N.nameScore("zzzznotamonster", INDEX).size, 0);
  assertEqual("an empty query matches nothing", N.nameScore("", INDEX).size, 0);
  assertEqual("...and neither does one made only of joining words", N.nameScore("of the", INDEX).size, 0);
  assertEqual("no index means no scores rather than a crash", N.nameScore("barghest", null).size, 0);

  assertEqual("the UI is told when nothing was recognised", N.looksLikeName("zzzznotamonster", INDEX), null);
  const hit = N.looksLikeName("barghest", INDEX);
  assertEqual("...and what was, when something is", hit.name, "Barghest");
  assertEqual("...including whether it was exact", hit.exact, true);
  assertEqual("a near miss is reported as a near miss", N.looksLikeName("barghast", INDEX).exact, false);
}

section("edit distance");
{
  assertEqual("identical strings are zero apart", N.editDistance("orc", "orc", 2), 0);
  assertEqual("one substitution is one", N.editDistance("barghest", "barghast", 2), 1);
  assert("something far away is reported as beyond the limit rather than measured",
    N.editDistance("barghest", "gelatinous cube", 2) > 2);
  assert("short names get no slack, so 'orc' cannot become 'ork'... or 'ord'", N.slackFor(3) === 0);
  assert("longer ones get some, because they were heard rather than read", N.slackFor(10) >= 2);
}

/* ---------- the part that broke first time ---------- */
section("a name outweighs the player's own guess, without filtering");
{
  const R = S.buildRarity(CORPUS);
  const names = N.nameScore("barghest", INDEX);

  // The player heard "barghest" AND guessed, wrongly, that it was a dragon.
  const obs = { type: "dragon" };
  const out = S.rank(CORPUS, obs, R, { nameScores: names });

  assertEqual("the named creature leads, even contradicted on type", out[0].name, "Barghest");
  assert("...and the type guess still counts for something, rather than being ignored",
    out.some(r => r.name === "Ancient Red Dragon" && r.score > 0));
  assertEqual("every candidate is still ranked — a name is never a filter", out.length, CORPUS.length);

  // Credit only: a candidate that isn't the named creature must not be actively docked.
  const withName = S.rank(CORPUS, { type: "dragon" }, R, { nameScores: names });
  const without = S.rank(CORPUS, { type: "dragon" }, R);
  const get = (list, n) => list.find(r => r.name === n).score;
  assert("a creature the name doesn't match is not penalised, only out-earned",
    !withName.some(r => r.for.some(f => f.facet === "name" && f.weight < 0)));
  assert("...though the dragon does score lower once something else explains more",
    get(withName, "Ancient Red Dragon") < get(without, "Ancient Red Dragon"));

  assert("the name is shown as evidence, so the user can see why this ranked first",
    out[0].for.some(f => f.facet === "name"));
}

section("a name on its own is enough to ask with");
{
  assert("a heard name is evidence", S.hasEvidence({ heardName: "barghest" }));
  assertEqual("...but an empty one is not", S.hasEvidence({ heardName: "  " }), false);
  const R = S.buildRarity(CORPUS);
  const out = S.rank(CORPUS, { heardName: "barghest" }, R, { nameScores: N.nameScore("barghest", INDEX) });
  assertEqual("and it alone identifies the creature", out[0].name, "Barghest");
}

report("names");
