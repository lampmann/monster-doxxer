/* The named-trait catalogue — src/traits.js.

   Two things under test, different in kind.

   The CODE — canonicalisation, alias folding, search — is tested on synthetic
   statblocks like the rest of the suite, since no sourcebook content lives in this
   repository.

   The CATALOGUE is data, and what is worth asserting about data is that it is
   internally coherent: every entry's key is already canonical (an entry whose key
   canonicalises to something else can never match a monster), no duplicates, every
   entry glossed, every alias target real. Whether an entry matches anything in the
   actual bestiary is a question about WotC's data, and lives in scratch checks
   against the user's own data/ rather than here.

   Run: node tests/traits.test.js
*/
"use strict";
const T = require("../src/traits.js");
const S = require("../src/score.js");
const { assert, assertEqual, section, report } = require("./harness.js");

function mon(over) {
  return Object.assign({
    name: "Test", source: "T", key: "Test|T",
    traits: [], traitTags: [], actionTags: [],
  }, over || {});
}

section("canonicalising a trait name");

assertEqual("a trailing scope note is not part of the name",
  T.traitsOf(mon({ traits: [{ name: "Regeneration (Troll Form Only)" }] })), ["regeneration"]);
assertEqual("inner parentheses are left alone",
  T.traitsOf(mon({ traits: [{ name: "Keen Senses (Sight)" }] })), ["keen senses"]);
assertEqual("case and stray whitespace do not make a second feature",
  T.traitsOf(mon({ traits: [{ name: "  MAGIC   Resistance " }] })), ["magic resistance"]);
assert("editorial entries are not traits",
  T.traitsOf(mon({ traits: [{ name: "Roleplaying Information" }] })).length === 0);

section("alias folding");

/* The reason this matters: 5e.tools' tag spells it plural and the trait entry spells
   it singular, and left unfolded the rarity table prices one 470-monster feature as
   two 235-monster ones — i.e. as twice as rare as it is. */
assertEqual("the tag spelling and the trait spelling are one feature",
  T.traitsOf(mon({ traits: [{ name: "Legendary Resistance" }], traitTags: ["Legendary Resistances"] })),
  ["legendary resistance"]);
assertEqual("the six keen-sense spellings are one mechanic",
  T.traitsOf(mon({ traits: [{ name: "Keen Hearing and Smell" }, { name: "Keen Sight" }] })),
  ["keen senses"]);
assertEqual("a typo in the source data folds onto the real name",
  T.traitsOf(mon({ traits: [{ name: "Aversion of Fire" }] })), ["aversion to fire"]);

section("what gets indexed");

assertEqual("trait names, trait tags and action tags all count",
  T.traitsOf(mon({ traits: [{ name: "Pack Tactics" }], traitTags: ["Magic Resistance"],
                   actionTags: ["Breath Weapon"] })).sort(),
  ["breath weapon", "magic resistance", "pack tactics"]);
/* Every statblock has a Bite or a Claw. Indexing action NAMES would bury the
   vocabulary under three features that distinguish nothing. */
assert("action names are not indexed, only action tags",
  !T.traitsOf(mon({ actions: [{ name: "Bite" }] })).length);
assert("tagTraits writes the field the trait facet reads",
  T.tagTraits([mon({ traits: [{ name: "Flyby" }] })])[0].traitNames[0] === "flyby");

section("the catalogue is coherent");

const seen = new Set();
let dupes = 0, uncanonical = 0, unglossed = 0;
T.TRAIT_ALL.forEach(e => {
  if (seen.has(e.key)) dupes++;
  seen.add(e.key);
  /* An entry whose key is not already canonical is a dead button: traitsOf will never
     produce that string, so nothing can ever match it. */
  if (T.traitFold(T.traitCanon(e.key)) !== e.key) uncanonical++;
  if (!e.desc || e.desc.length < 12) unglossed++;
});
assertEqual("no trait appears in two groups", dupes, 0);
assertEqual("every key is what traitsOf would produce", uncanonical, 0);
assertEqual("every entry carries a real gloss", unglossed, 0);
assert("the catalogue is not trivially small", T.TRAIT_ALL.length > 100);
assert("every group has a label and entries",
  T.TRAIT_GROUPS.every(g => g.label && g.id && g.traits.length));
/* An alias whose target is itself an alias folds only one step, so the two spellings
   still land on different keys and the split this is meant to prevent happens anyway. */
const chained = Object.entries(T.TRAIT_ALIASES)
  .filter(([, to]) => T.TRAIT_ALIASES[to] !== undefined);
assertEqual("no alias points at another alias", chained.map(([f]) => f), []);
const notCanon = Object.entries(T.TRAIT_ALIASES)
  .filter(([from, to]) => T.traitCanon(from) !== from || T.traitCanon(to) !== to);
assertEqual("both sides of every alias are already canonical", notCanon.map(([f]) => f), []);

section("search finds a trait from what you saw, not its name");

const named = q => T.searchTraits(q, 6).map(e => e.key);
assert("the exact name comes first", named("pack tactics")[0] === "pack tactics");
/* The whole argument for a trait list over a bare index: the gloss is searchable, so
   the jargon is not a precondition. */
assert("a description of the effect finds it", named("wounds closed").includes("regeneration"));
assert("player phrasing finds it", named("it grabbed me").includes("grappler"));
assert("a made-up word finds nothing", T.searchTraits("xyzzyplugh", 6).length === 0);
/* One shared common word is not a match. Before the score floor, "my sword bounced
   off" — which no catalogued trait is about — returned five unrelated entries. */
assert("a query about nothing in the catalogue returns nothing rather than noise",
  T.searchTraits("my sword bounced off", 6).length <= 1);
assert("an empty query is not a search", T.searchTraits("", 6).length === 0);

section("the trait facet scores");

const corpus = [
  mon({ name: "Alpha", key: "Alpha|T", traits: [{ name: "Pack Tactics" }] }),
  mon({ name: "Beta", key: "Beta|T", traits: [{ name: "Magic Resistance" }] }),
  mon({ name: "Gamma", key: "Gamma|T", traits: [{ name: "Magic Resistance" }] }),
];
T.tagTraits(corpus);
const rarity = S.buildRarity(corpus);
assert("a named trait is evidence on its own", S.hasEvidence({ traits: ["pack tactics"] }));
const hit = S.scoreMonster(corpus[0], { traits: ["pack tactics"] }, rarity, {});
const miss = S.scoreMonster(corpus[1], { traits: ["pack tactics"] }, rarity, {});
assert("the monster with the trait scores above the one without", hit.score > miss.score);
assert("the evidence line names the facet",
  (hit.for || []).some(x => x.facet === "trait" && x.value === "pack tactics"));
/* An exact string off a curated catalogue is not a guess, so unlike a symptom it takes
   no confidence discount. */
assert("a trait hit is not discounted",
  (hit.for || []).every(x => x.facet !== "trait" || x.confidence == null));
/* F1, unchanged: one-in-three is rarer than two-in-three and must be worth more. */
const rare = S.scoreMonster(corpus[0], { traits: ["pack tactics"] }, rarity, {});
const common = S.scoreMonster(corpus[1], { traits: ["magic resistance"] }, rarity, {});
assert("the rarer trait is worth more",
  rare.for[0].weight > common.for[0].weight);

report("traits");
