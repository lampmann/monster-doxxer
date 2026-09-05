/* Loading the bestiary from a dropped folder instead of a server.

   The properties that matter are about the one genuinely tricky part: turning
   whatever the user actually dragged in — 5e.tools' `data` folder itself, a whole
   checkout of the 5e.tools repo, or a renamed folder of just the bestiary files —
   into the same path shape app.js's loader already asks for. Get that wrong and
   a perfectly good drop looks like "not a data folder" for no reason a user could
   guess.

   Run: node tests/localdata.test.js
*/
"use strict";
const L = require("../src/localdata.js");
const { assert, assertEqual, section, report } = require("./harness.js");

const file = text => ({ text: () => Promise.resolve(text) });

section("normalizeRelPath — the same file, however it was handed over");
{
  assertEqual("5e.tools' own data/ folder, dropped directly",
    L.normalizeRelPath("data/bestiary/index.json"), "bestiary/index.json");
  assertEqual("a whole checkout, data/ nested inside it",
    L.normalizeRelPath("5etools-src/data/bestiary/index.json"), "bestiary/index.json");
  assertEqual("a renamed folder with no 'data' segment at all — the wrapper's own name is stripped",
    L.normalizeRelPath("MyExport/bestiary/index.json"), "bestiary/index.json");
  assertEqual("nested deeper still works the same way",
    L.normalizeRelPath("checkout/data/spells/index.json"), "spells/index.json");
  assertEqual("a single file with no folder at all",
    L.normalizeRelPath("data/books.json"), "books.json");
}

section("buildFileIndex — pairs become a lookup keyed the same way getJson asks for paths");
{
  const idx = L.buildFileIndex([
    { path: "data/bestiary/index.json", file: file('{"a":1}') },
    { path: "data/books.json", file: file("[]") },
  ]);
  assert("the bestiary index is reachable by its normalized path", idx.has("bestiary/index.json"));
  assert("so is a top-level file", idx.has("books.json"));
  assertEqual("nothing not handed in is present", idx.size, 2);

  const empty = L.buildFileIndex([]);
  assertEqual("no pairs, no entries — not an error", empty.size, 0);
  assertEqual("...and buildFileIndex(undefined) is the same as buildFileIndex([])",
    L.buildFileIndex(undefined).size, 0);

  const skipped = L.buildFileIndex([{ path: "data/x.json", file: null }, null, { path: "data/y.json" }]);
  assertEqual("a pair with no file, or no pair at all, is skipped rather than crashing", skipped.size, 0);
}

section("pairsFromFileList — an <input webkitdirectory>'s FileList");
{
  const pairs = L.pairsFromFileList([
    { webkitRelativePath: "data/bestiary/index.json", name: "index.json" },
    { webkitRelativePath: "", name: "loose-file.json" },   // no relative path at all, still usable
  ]);
  assertEqual("uses webkitRelativePath when present", pairs[0].path, "data/bestiary/index.json");
  assertEqual("...and falls back to the bare name otherwise", pairs[1].path, "loose-file.json");
  assertEqual("a missing FileList is empty rather than an error", L.pairsFromFileList(undefined).length, 0);
}

/* readJsonFile is the one function here that's genuinely async (a real File's .text()
   always is), so it's the one section that has to wait rather than assert inline. */
async function main() {
  section("readJsonFile — the one thing a real File and this file's mocks both support");
  {
    const j = await L.readJsonFile(file('{"monster":[{"name":"Owlbear"}]}'));
    assertEqual("parses what .text() returns", j.monster[0].name, "Owlbear");
  }

  report("localdata");
}

main();
