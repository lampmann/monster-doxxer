/* Loads the user's own bestiary from data/ and runs it through the full index-time
   pipeline: normalise, resolve _copy, tag symptoms.

   Node-only, and deliberately separate from src/. Nothing in src/ may read the
   filesystem — it has to run in a browser — but every offline tool here needs the
   same corpus in the same state, and having each one rebuild it differently is how
   an evaluation harness ends up measuring something other than what ships.

   No bestiary content is in the repository. If data/ is empty this exits with a
   pointer to data/README.md rather than a stack trace, because "you have not
   downloaded the data yet" is the overwhelmingly likely reason. */
"use strict";
const fs = require("fs");
const path = require("path");
const N = require("../src/normalize.js");
const SY = require("../src/symptoms.js");
const SRC = require("../src/sources.js");

const ROOT = path.join(__dirname, "..");
const BESTIARY = path.join(ROOT, "data", "bestiary");
const ONTOLOGY = path.join(ROOT, "ontology", "symptoms.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/* 5e.tools ships its own manifest of source code -> filename. Read it rather than
   globbing, so a stray file in data/bestiary can't quietly join the corpus and shift
   every rarity weight. Fall back to globbing only if the manifest is absent. */
function bestiaryFiles() {
  const manifest = path.join(BESTIARY, "index.json");
  if (fs.existsSync(manifest)) {
    return Object.values(readJson(manifest))
      .map(f => path.join(BESTIARY, f))
      .filter(f => fs.existsSync(f));
  }
  if (!fs.existsSync(BESTIARY)) return [];
  return fs.readdirSync(BESTIARY)
    .filter(f => /^bestiary-.*\.json$/.test(f))
    .map(f => path.join(BESTIARY, f));
}

function missingDataMessage() {
  return [
    "",
    "No bestiary found in data/bestiary/.",
    "",
    "Nothing from 5e.tools is committed to this repository, so the offline tools need",
    "you to put a copy there yourself. See data/README.md for the layout.",
    "",
  ].join("\n");
}

let cached = null;

/* opts.quiet suppresses the one-line summary — the harness prints its own. */
function load(opts) {
  const o = opts || {};
  if (cached && !o.fresh) return cached;

  const files = bestiaryFiles();
  if (!files.length) {
    process.stderr.write(missingDataMessage());
    process.exit(2);
  }

  const lists = [];
  const badFiles = [];
  files.forEach(f => {
    try {
      const j = readJson(f);
      if (Array.isArray(j.monster)) lists.push(j.monster);
    } catch (e) { badFiles.push(path.basename(f) + ": " + e.message); }
  });

  const { monsters, skipped } = N.ingest(lists);
  const compiled = SY.compile(readJson(ONTOLOGY));
  SY.tagAll(monsters, compiled);

  /* Optional: book/adventure titles and publication dates, for F16's filter labels and
     the legacy tiebreak. Absent, the ranking still works and simply ties differently —
     so the harness must build them the same way the app does, or it would be measuring
     a ranking nobody uses. */
  const readOptional = f => { try { return readJson(path.join(ROOT, "data", f)); } catch (e) { return null; } };
  const catalogue = SRC.buildCatalogue(readOptional("books.json"), readOptional("adventures.json"));
  const sourceDates = SRC.sourceDates(catalogue);

  cached = { monsters, skipped, badFiles, ontology: compiled, files: files.length,
             catalogue, sourceDates };
  if (!o.quiet) {
    process.stdout.write(
      `corpus: ${monsters.length} monsters from ${files.length} files, ` +
      `${compiled.symptoms.length} symptoms` +
      (skipped.length ? `, ${skipped.length} skipped` : "") +
      (badFiles.length ? `, ${badFiles.length} unreadable files` : "") + "\n");
  }
  return cached;
}

module.exports = { load, bestiaryFiles, BESTIARY, ONTOLOGY, ROOT };
