/* Source catalogue tests — F16's supporting metadata.

   The filter itself is tested in score.test.js; this covers turning 107 opaque
   source codes into something a person can click. The properties that matter are
   about degradation: the book titles come from files the user may not have, and a
   filter that hides sources it can't name would quietly drop monsters from the
   corpus without saying so.

   Run: node tests/sources.test.js
*/
"use strict";
const SRC = require("../src/sources.js");
const S = require("../src/score.js");
const { assert, assertEqual, section, report } = require("./harness.js");

const BOOKS = { book: [{ id: "MM", name: "Monster Manual" }, { id: "VGM", name: "Volo's Guide to Monsters" }] };
const ADVENTURES = { adventure: [{ id: "CoS", name: "Curse of Strahd" }, { id: "WDH", name: "Waterdeep: Dragon Heist" }] };
const CAT = SRC.buildCatalogue(BOOKS, ADVENTURES);

const mon = (name, source) => ({ name, source, key: name + "|" + source });
const CORPUS = [
  mon("Goblin", "MM"), mon("Troll", "MM"), mon("Bugbear", "MM"),
  mon("Froghemoth", "VGM"),
  mon("Strahd", "CoS"), mon("Baba Lysaga", "CoS"),
  mon("Xanathar", "WDH"),
  mon("Homebrew Horror", "MYSTERY"),
];

section("F16 — codes become titles");
{
  assertEqual("a book resolves to its title", CAT["mm"].name, "Monster Manual");
  assertEqual("...and is grouped as a book", CAT["mm"].group, "book");
  assertEqual("an adventure resolves too", CAT["cos"].name, "Curse of Strahd");
  assertEqual("...and is grouped as an adventure, which is the spoiler axis", CAT["cos"].group, "adventure");
  assertEqual("an empty catalogue is empty rather than an error", SRC.buildCatalogue(null, null), {});
}

section("F16 — one row per source actually present");
{
  const rows = SRC.sourceRows(CORPUS, CAT);
  assertEqual("only sources with monsters in them appear", rows.length, 5);
  assertEqual("...counted", rows.find(r => r.code === "MM").count, 3);
  assertEqual("the commonest source comes first, so the Monster Manual outranks a one-monster adventure",
    rows[0].code, "MM");

  const unknown = rows.find(r => r.code === "MYSTERY");
  assert("a source the catalogue doesn't know is still listed", !!unknown);
  assertEqual("...keeping its bare code as its label", unknown.name, "MYSTERY");
  assertEqual("...and landing in 'other' rather than being dropped", unknown.group, "other");
  assertEqual("...and flagged as unknown", unknown.known, false);

  // The failure this guards: silently omitting a source would hide its monsters from a
  // filter the user believes is showing them everything.
  const codes = new Set(rows.map(r => r.code));
  assert("every source in the corpus is representable in the filter",
    CORPUS.every(m => codes.has(m.source)));
}

section("F16 — without the optional title files it still works");
{
  const rows = SRC.sourceRows(CORPUS, null);
  assertEqual("every source still appears", rows.length, 5);
  assert("...labelled by code", rows.every(r => r.name === r.code));
  assert("...and all in one group, rather than vanishing", rows.every(r => r.group === "other"));
  assertEqual("grouping still yields something clickable", SRC.groupRows(rows).length, 1);
}

section("F16 — grouping");
{
  const groups = SRC.groupRows(SRC.sourceRows(CORPUS, CAT));
  assertEqual("books come before adventures", groups.map(g => g.group), ["book", "adventure", "other"]);
  assertEqual("...labelled for humans", groups[0].label, "Books");
  assert("an empty group is omitted rather than rendered blank",
    SRC.groupRows(SRC.sourceRows([mon("Goblin", "MM")], CAT)).length === 1);
}

section("F16 — the tri-state cycle, as pmcrwf cycles its filters");
{
  assertEqual("neutral goes to include first, the commonest intent", SRC.nextState("ignore"), "include");
  assertEqual("...then to exclude", SRC.nextState("include"), "exclude");
  assertEqual("...then back to neutral", SRC.nextState("exclude"), "ignore");
  assertEqual("an unset state starts the cycle", SRC.nextState(undefined), "include");
}

section("F16 — state folds into the spec the scorer reads");
{
  const spec = SRC.toSpec({ MM: "include", VGM: "include", CoS: "exclude", WDH: "ignore" });
  assertEqual("includes are collected", spec.include.sort(), ["MM", "VGM"]);
  assertEqual("excludes are collected", spec.exclude, ["CoS"]);
  assert("neutral sources appear in neither", !spec.include.includes("WDH") && !spec.exclude.includes("WDH"));

  assert("an untouched filter is inactive", !SRC.isActive({}));
  assert("...and one with only neutral entries is too", !SRC.isActive({ MM: "ignore" }));
  assert("...while any opinion makes it active", SRC.isActive({ CoS: "exclude" }));

  // The end-to-end path the UI actually walks: chip states -> spec -> rank().
  const ranked = S.rank(CORPUS.map(m => Object.assign({
    type: "humanoid", typeAlt: [], typeTags: [], size: ["medium"], speeds: { walk: 30 },
    senseTags: [], conditionImmune: [], traitTags: [], actionTags: [], damageTags: [],
    resist: [], immune: [], vulnerable: [], symptoms: [], partial: false,
  }, m)), { type: "humanoid" }, S.buildRarity([]), { sources: SRC.toSpec({ CoS: "exclude" }) });
  assert("excluding an adventure in the UI keeps its monsters out of the ranking",
    !ranked.some(r => r.source === "CoS"));
  assert("...and leaves everything else in", ranked.some(r => r.source === "MM"));
}

report("sources");
