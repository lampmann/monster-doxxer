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
const APP = require("../src/appearance.js");
const EM = require("../src/embeddings.js");

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

  /* Fluff, for F10's appearance index. Also optional: without it the description
     documents still exist (name, size, type, trait names) and simply carry no prose.

     TWO LOCATIONS, and both are checked deliberately. 5e.tools ships the fluff files
     INSIDE data/bestiary/ alongside the statblocks; this project's README asked for a
     data/fluff-bestiary/ instead. Looking in only one of those is how you end up with an
     index that loads, reports 4528 monsters, and quietly describes none of them — a tool
     that looks like it works and scores like it doesn't. */
  const fluffLists = [];
  const seenFluff = new Set();
  [["bestiary", /^fluff-.*\.json$/], ["fluff-bestiary", /\.json$/]].forEach(([dir, keep]) => {
    const full = path.join(ROOT, "data", dir);
    if (!fs.existsSync(full)) return;
    fs.readdirSync(full).filter(f => keep.test(f) && !seenFluff.has(f)).forEach(f => {
      seenFluff.add(f);
      try {
        const j = readJson(path.join(full, f));
        if (Array.isArray(j.monsterFluff)) fluffLists.push(j.monsterFluff);
      } catch (e) { badFiles.push(f + ": " + e.message); }
    });
  });
  const fluff = APP.fluffMap(fluffLists);
  const appearanceIndex = APP.buildAppearanceIndex(monsters, fluff);
  /* What a party could say about how it LOOKED, for the harness to paraphrase back.

     Deliberately NOT the description document the scorer indexes. That document leads with
     the monster's name and its trait names, and paraphrasing it produced queries containing
     the word "beholder" — which took top-5 recall to 89.5% by handing the answer over. A
     player who knew the name would not be using this tool.

     So: the fluff prose only, with any word from the creature's own name stripped out. What
     is left is what somebody actually saw. */
  const documents = Object.create(null);
  monsters.forEach(m => {
    const f = fluff[String(m.name).toLowerCase() + "|" + String(m.source || "").toLowerCase()];
    if (!f || !f.entries) return;                       // nothing to describe it from
    // Stems, not exact words: "beholders" was surviving a filter that only removed "beholder".
    const nameStems = new Set(String(m.name).toLowerCase().split(/[^a-z]+/).filter(Boolean).map(APP.stem));
    const prose = APP.fluffProse(f.entries, 4)
      .split(/\s+/)
      .filter(w => !nameStems.has(APP.stem(w.toLowerCase().replace(/[^a-z]/g, ""))))
      .join(" ");
    if (prose.trim()) documents[m.key] = prose;
  });

  const embeddings = loadEmbeddingIndex();
  cached = { monsters, skipped, badFiles, ontology: compiled, files: files.length,
             catalogue, sourceDates, fluff, appearanceIndex, documents, embeddings };
  if (!o.quiet) {
    process.stdout.write(
      `corpus: ${monsters.length} monsters from ${files.length} files, ` +
      `${compiled.symptoms.length} symptoms, ${appearanceIndex.withProse} described` +
      (embeddings ? ", embeddings on" : "") +
      (skipped.length ? `, ${skipped.length} skipped` : "") +
      (badFiles.length ? `, ${badFiles.length} unreadable files` : "") + "\n");
  }
  return cached;
}

/* The CLIP index, if build/embed.py has been run. Absent is the normal state — the
   tool works without it and simply has no semantic half — so this returns null rather
   than complaining. */
function loadEmbeddingIndex() {
  const dir = path.join(ROOT, "index");
  const manifestPath = path.join(dir, "appearance.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = readJson(manifestPath);
    const read = f => {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) return null;
      const buf = fs.readFileSync(p);
      return new Int8Array(buf.buffer, buf.byteOffset, buf.length);
    };
    return EM.buildEmbeddingIndex(manifest, read("appearance-mon.i8"), read("appearance-vocab.i8"));
  } catch (e) {
    process.stderr.write("index/ is present but unreadable: " + e.message + "\n");
    return null;
  }
}

module.exports = { load, bestiaryFiles, loadEmbeddingIndex, BESTIARY, ONTOLOGY, ROOT };
