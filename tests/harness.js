/* Minimal test harness. No dependencies, runs under plain `node`.

   Assertions are written as readable sentences rather than as names of the
   function under test, because the thing worth pinning here is a claim about
   5e.tools' data ("a coven CR resolves to the base number"), not that a
   function was called. A failure should tell you which claim stopped being
   true. */
"use strict";

let pass = 0, fail = 0;
const failures = [];

function assert(name, cond) {
  if (cond) { pass++; return true; }
  fail++; failures.push(`FAIL  ${name}`);
  return false;
}
function assertEqual(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return true; }
  fail++; failures.push(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
  return false;
}
function assertClose(name, actual, expected, tol) {
  const ok = typeof actual === "number" && Math.abs(actual - expected) <= (tol == null ? 1e-9 : tol);
  if (ok) { pass++; return true; }
  fail++; failures.push(`FAIL  ${name}\n        expected ~${expected}\n        got       ${actual}`);
  return false;
}
function section(title) { console.log("\n— " + title); }
function report(label) {
  failures.forEach(f => console.log(f));
  console.log(`\n${label}: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
  return fail === 0;
}

module.exports = { assert, assertEqual, assertClose, section, report };
