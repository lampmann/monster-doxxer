/* Runs every *.test.js in this directory in a fresh process each, so one suite
   crashing can't take the others' results with it. `node tests/run.js` */
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const suites = fs.readdirSync(dir).filter(f => f.endsWith(".test.js")).sort();
let failed = 0;

suites.forEach(f => {
  try {
    process.stdout.write(execFileSync(process.execPath, [path.join(dir, f)], { encoding: "utf8" }));
  } catch (e) {
    failed++;
    process.stdout.write((e.stdout || "") + (e.stderr || ""));
  }
});

console.log(failed ? `\n${failed} suite(s) failed` : `\nall ${suites.length} suite(s) passed`);
process.exitCode = failed ? 1 : 0;
