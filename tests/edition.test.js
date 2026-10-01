"use strict";
const N = require("../src/normalize.js");
const S = require("../src/score.js");
const { assert, assertEqual, section, report } = require("./harness.js");

section("2024 content toggle");
const monsters = [
  { name: "Old creature", source: "MM" },
  { name: "Modern creature", source: "XMM" },
  { name: "Tagged creature", source: "CUSTOM", edition: "one" },
  { name: "Later creature", source: "LATER" },
  { name: "Unknown creature", source: "UNKNOWN" },
].map(N.parseMonster);
const sourceDates = { later: "2025-01-01" };
const rarity = S.buildRarity(monsters);
assertEqual("normalization preserves edition metadata", monsters[2].edition, "one");
assert("copies do not inherit their base's edition", !N.resolveCopy(
  { name: "Old copy", source: "MM", _copy: { name: "Base", source: "XMM" } },
  { "base|xmm": { name: "Base", source: "XMM", edition: "one" } }, 0).edition);
assertEqual("disabled excludes core, tagged, and later content",
  S.rank(monsters, {}, rarity, { include2024: false, sourceDates }).map(r => r.name).sort(),
  ["Old creature", "Unknown creature"]);
assertEqual("enabled restores every candidate",
  S.rank(monsters, {}, rarity, { include2024: true, sourceDates }).length, 5);
assertEqual("explicit source exclusions still apply when enabled",
  S.rank(monsters, {}, rarity, { include2024: true, sources: { exclude: ["XMM"] } }).length, 4);
assert("unknown sources are not assumed to be 2024", !S.is2024Monster(monsters[4], sourceDates));
report("edition");
