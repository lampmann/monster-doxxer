/* Ontology health check — how F8 lands on a real bestiary.

     node eval/coverage.js              the summary and anything wrong
     node eval/coverage.js --all        every symptom, commonest first
     node eval/coverage.js --monster "Gelatinous Cube"

   The unit tests can prove the ontology is well formed, but not that its regexes
   fire against WotC's prose — that text is not in the repository. This is where
   that gets checked, against whatever you put in data/.

   What to look for:

     DEAD symptoms match nothing. Either the mechanic is phrased differently in the
     books than the pattern assumes, or it does not exist. Fix the pattern or drop
     the symptom; a symptom that never fires is a promise the query form cannot keep.

     UBIQUITOUS symptoms match most of the corpus. Not automatically wrong — F1
     weights a feature by -log(fraction), so something 60% of monsters have is
     already worth almost nothing and does no harm. It IS wrong if it was meant to
     be distinctive, which usually means the pattern is too loose.

     WEAK symptoms attach mostly by prose guess rather than curated tag. Fine in
     itself; worth knowing when reading a ranking that leans on one. */
"use strict";
const { load } = require("./corpus.js");

function parseArgs(argv) {
  const out = { all: false, monster: "", top: 25 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--all") out.all = true;
    else if (argv[i] === "--monster") out.monster = argv[++i];
    else if (argv[i] === "--top") out.top = Number(argv[++i]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const { monsters, ontology } = load({});
  const SY = require("../src/symptoms.js");

  if (args.monster) {
    const want = args.monster.toLowerCase();
    const hits = monsters.filter(m => m.name.toLowerCase() === want);
    if (!hits.length) {
      console.log(`no monster named "${args.monster}" in the loaded corpus`);
      process.exit(1);
    }
    hits.forEach(m => {
      console.log(`\n${m.name} (${m.source})  ${m.size.join("/")} ${m.type}, CR ${m.cr}`);
      if (!m.symptoms.length) { console.log("  no symptoms — nothing in the ontology matches this statblock"); return; }
      m.symptoms.forEach(id => {
        const s = ontology.byId[id];
        const why = (m.symptomWhy[id] || [])[0] || {};
        console.log(`  ${String(m.symptomConf[id].toFixed(2)).padStart(4)}  ${(s ? s.player : id)}`);
        console.log(`        via ${why.mechanic || "?"}${why.entry ? ` ("${why.entry}")` : ""} [${why.via || "?"}]`);
      });
    });
    return;
  }

  const cov = SY.coverage(monsters, ontology);
  const tagged = monsters.filter(m => m.symptoms.length).length;
  const perMonster = monsters.reduce((n, m) => n + m.symptoms.length, 0) / (monsters.length || 1);

  console.log(`\n${ontology.symptoms.length} symptoms over ${cov.total} monsters`);
  console.log(`  ${tagged} monsters tagged (${(100 * tagged / cov.total).toFixed(1)}%), ${perMonster.toFixed(1)} symptoms each on average`);

  if (ontology.problems.length) {
    console.log(`\nMALFORMED (${ontology.problems.length}):`);
    ontology.problems.forEach(p => console.log("  " + p));
  }
  if (cov.dead.length) {
    console.log(`\nDEAD — match nothing in this corpus (${cov.dead.length}):`);
    cov.dead.forEach(id => console.log("  " + id));
  } else {
    console.log("\nno dead symptoms — every one matches something");
  }
  if (cov.ubiquitous.length) {
    console.log(`\nUBIQUITOUS — over half the corpus (${cov.ubiquitous.length}), worth ~nothing under F1:`);
    cov.ubiquitous.forEach(id => console.log("  " + id));
  }

  const weak = cov.rows.filter(r => r.count >= 20 && r.strong / r.count < 0.2);
  if (weak.length) {
    console.log(`\nMOSTLY GUESSED — attached by prose rather than a curated tag (${weak.length}):`);
    weak.slice(0, 12).forEach(r => console.log(`  ${r.id.padEnd(46)} ${r.strong}/${r.count} confident`));
  }

  const rows = args.all ? cov.rows : cov.rows.slice(0, args.top);
  console.log(`\n${args.all ? "every symptom" : "commonest " + rows.length}, by share of corpus:`);
  rows.forEach(r => console.log(
    `  ${r.id.padEnd(46)} ${String(r.count).padStart(5)}  ${(100 * r.fraction).toFixed(1).padStart(5)}%  ` +
    `${String(r.strong).padStart(5)} confident`));

  if (!args.all) console.log(`\n  (--all for the rest, --monster "Name" to see one statblock's tags)`);
}

if (require.main === module) main();
