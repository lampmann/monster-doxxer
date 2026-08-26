/* ============================================================
   The browser suite — src/app.js, the one module the Node tests cannot reach.

     ./doxx test-ui                  run it
     node tests/ui.js                same thing
     node tests/ui.js --headed       watch it work
     node tests/ui.js --keep         leave the server up afterwards

   WHY THIS IS SEPARATE FROM `doxx test`. The Node suites run in milliseconds, and
   DESIGN.md is explicit that this is why the core avoids browsers: the work here is
   tuning numbers against data, and a 40-second round trip would change how often
   anyone runs them. So this is opt-in. `tests/run.js` deliberately does not pick it
   up — the filename is `ui.js`, not `ui.test.js`, and that is the whole mechanism.

   WHY IT EXISTS AT ALL. app.js is 905 lines, the largest file in the project, and
   until now the only one with no assertions against it. Every UI defect found so far
   was found by a human driving the page by hand: a tab label that lagged one render
   behind the ranking it names, a `score` read before its initialiser ran, a blend
   emitting zero-valued entries that made "lexical only" look like it had found things
   it had not. Those are regressions a reviewer does not catch by reading.

   WHAT IT ASSERTS. Behaviour a user would notice, never implementation. The tests
   drive real controls — typing, clicking chips, reloading — and read what the page
   says back. They are deliberately tolerant about wording and strict about state.

   DEPENDENCIES. Playwright, which the project does not otherwise need and does not
   ship a package.json for. Absent, this SKIPS with instructions rather than failing:
   a missing optional dev tool is not a broken build, and the same "degrade, never
   fail" rule the app follows for a missing index applies here.
   ============================================================ */
"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { assert, assertEqual, section, report } = require("./harness.js");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.DOXX_TEST_PORT || 8935);
const BASE = `http://127.0.0.1:${PORT}`;
const ARGS = process.argv.slice(2);
const HEADED = ARGS.includes("--headed");
const KEEP = ARGS.includes("--keep");

/* ---------- preflight: skip cleanly rather than fail ---------- */

function loadPlaywright() {
  const tried = [];
  for (const spec of ["playwright", "playwright-core"]) {
    try { return require(spec); } catch (e) { tried.push(spec); }
  }
  // Also accept an install anywhere on NODE_PATH, so a global one works.
  return null;
}

function skip(why, how) {
  console.log("\n— browser suite\n");
  console.log("  SKIPPED: " + why);
  if (how) console.log("\n" + how);
  console.log("\nui: skipped (not a failure)");
  process.exitCode = 0;
}

const playwright = loadPlaywright();
if (!playwright) {
  skip("Playwright is not installed, and this project deliberately has no package.json.",
    "  Install it just for testing — it is not needed to run the tool:\n\n" +
    "      npm install --no-save playwright\n" +
    "      npx playwright install chromium\n\n" +
    "  Then: ./doxx test-ui");
  return;
}

if (!fs.existsSync(path.join(ROOT, "data", "bestiary", "index.json"))) {
  skip("data/bestiary/index.json is missing, so the page has nothing to rank.",
    "  See data/README.md — no sourcebook content ships with this repo.");
  return;
}

/* ---------- a static server, so the page is fetched exactly as it would be ---------- */

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
               ".json": "application/json", ".i8": "application/octet-stream" };

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const full = path.join(ROOT, rel);
    // Never serve outside the project, even in a test.
    if (!full.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404).end("not found"); return; }
      res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

/* ---------- page helpers ---------- */

const READY = () => /monsters/.test(
  (document.getElementById("corpus-status") || {}).textContent || "");

async function fresh(browser) {
  // A new context each time, so localStorage from one test never leaks into the next.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 950 } });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", e => page.__errors.push(String(e)));
  page.on("console", m => {
    // 404s for the optional CLIP index are expected; anything else is not.
    const t = m.text();
    if (m.type() === "error" && !/Failed to load resource/.test(t)) page.__errors.push(t);
  });
  await page.goto(BASE + "/index.html");
  await page.waitForFunction(READY, null, { timeout: 90000 });
  return { ctx, page };
}

const resultsText = page => page.$eval("#results", el => el.textContent.replace(/\s+/g, " ").trim());
const tabsText = page => page.$eval("#doxx-tabs", el => el.textContent.replace(/\s+/g, " ").trim())
  .catch(() => "");

/* Click a symptom by the sentence a player would read, via the search box. */
async function pickSymptom(page, search, sentence) {
  await page.fill("#sym-search", search);
  await page.waitForTimeout(400);
  const clicked = await page.evaluate(s => {
    const b = [...document.querySelectorAll("button")]
      .find(x => x.textContent.trim().toLowerCase().startsWith(s.toLowerCase()));
    if (b) { b.click(); return true; }
    return false;
  }, sentence);
  await page.waitForTimeout(700);
  return clicked;
}

async function pickChip(page, group, label) {
  const ok = await page.evaluate(([g, l]) => {
    const b = [...document.querySelectorAll(`#${g} button`)]
      .find(x => x.textContent.trim().toLowerCase() === l.toLowerCase());
    if (b) { b.click(); return true; }
    return false;
  }, [group, label]);
  await page.waitForTimeout(700);
  return ok;
}

/* ---------- the suite ---------- */

async function main() {
  const server = await serve();
  const browser = await playwright.chromium.launch({
    headless: !HEADED,
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  }).catch(() => playwright.chromium.launch({ headless: !HEADED }));

  try {
    /* ---------------------------------------------------------- */
    section("the page loads and says what it has");
    {
      const { ctx, page } = await fresh(browser);
      const status = await page.$eval("#corpus-status", e => e.textContent);
      assert("the status line reports a corpus", /\d[\d,]* monsters/.test(status));
      assert("...and a symptom ontology", /\d+ symptoms/.test(status));
      assertEqual("nothing has been observed yet, and it says so",
        /nothing observed yet/i.test(await resultsText(page)), true);
      assertEqual("no JavaScript errors on load", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("one observation ranks, and explains itself");
    {
      const { ctx, page } = await fresh(browser);
      const found = await pickSymptom(page, "healed between", "It healed between rounds");
      assertEqual("the symptom search finds the sentence a player would say", found, true);

      const txt = await resultsText(page);
      assert("something is ranked", /1\./.test(txt));
      assert("the result explains WHY it ranked (F14)", /for:/i.test(txt));
      assert("...naming the observation back in the player's own words",
        /healed between rounds/i.test(txt));
      assertEqual("no JavaScript errors while ranking", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("evidence accumulates and narrows");
    {
      const { ctx, page } = await fresh(browser);
      await pickSymptom(page, "healed between", "It healed between rounds");
      const before = await page.$$eval("#results .result", n => n.length);

      await pickChip(page, "pick-type", "giant");
      const after = await page.$$eval("#results .result", n => n.length);
      const txt = await resultsText(page);

      assert("a second observation is taken into account", /giant/i.test(txt));
      assert("adding evidence does not increase the candidate count",
        after <= before);
      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("the no-match floor speaks up, and still shows the leads");
    {
      const { ctx, page } = await fresh(browser);
      // A construct that healed itself and is hurt worse by psychic: individually
      // ordinary, jointly explained by nothing. Measured at ~0.375, below the floor.
      await pickChip(page, "pick-type", "construct");
      await pickSymptom(page, "healed between", "It healed between rounds");
      await page.evaluate(() => {
        const r = document.querySelector('input[data-dmg="psychic"][value="vulnerable"]');
        if (r) r.click();
      });
      await page.waitForTimeout(900);

      const txt = await resultsText(page);
      assert("the tool says the books do not explain this well",
        /explains this well|least bad matches/i.test(txt));
      assert("...and blames the DM or the memory, not the party",
        /built this one themselves|misremembered/i.test(txt));
      assert("the leads are still listed — rank, never filter", /1\./.test(txt));
      assert("...with their reasoning intact", /for:/i.test(txt));

      const tabs = await tabsText(page);
      assert("the tab stops asserting a name it cannot support",
        !/shield guardian/i.test(tabs));
      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("a confident match does name itself on the tab");
    {
      const { ctx, page } = await fresh(browser);
      await page.fill("#in-name", "owlbear");
      await page.waitForTimeout(900);
      const txt = await resultsText(page);
      assert("a heard name finds the creature", /owlbear/i.test(txt));
      const tabs = await tabsText(page);
      assert("...and the tab labels itself with the winner", /owlbear/i.test(tabs));
      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("F15 — evidence survives a reload");
    {
      const { ctx, page } = await fresh(browser);
      await pickSymptom(page, "healed between", "It healed between rounds");
      await pickChip(page, "pick-type", "giant");
      const before = await resultsText(page);

      await page.reload();
      await page.waitForFunction(READY, null, { timeout: 90000 });
      await page.waitForTimeout(900);

      const after = await resultsText(page);
      assert("the ranking is the same after a reload", after === before);
      const chosen = await page.$eval("#results", () =>
        document.body.textContent.replace(/\s+/g, " "));
      assert("...because the observations came back, not because both are empty",
        /healed between rounds/i.test(chosen));
      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("tabs keep their evidence apart");
    {
      const { ctx, page } = await fresh(browser);
      await pickSymptom(page, "healed between", "It healed between rounds");
      const first = await resultsText(page);

      const added = await page.evaluate(() => {
        const b = document.getElementById("tab-add");
        if (b) { b.click(); return true; }
        return false;
      });
      await page.waitForTimeout(800);
      assertEqual("a second tab can be opened", added, true);

      const second = await resultsText(page);
      assert("the new tab starts empty rather than inheriting the first's evidence",
        /nothing observed yet/i.test(second) || second !== first);

      // Back to the first tab: its evidence must still be there.
      await page.evaluate(() => {
        const t = document.querySelectorAll("#doxx-tabs .doxx-tab");
        if (t.length) t[0].click();
      });
      await page.waitForTimeout(800);
      const backAgain = await resultsText(page);
      assert("switching back restores the first tab's ranking", backAgain === first);
      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("F16 — excluding every book is survivable");
    {
      const { ctx, page } = await fresh(browser);
      await pickSymptom(page, "healed between", "It healed between rounds");
      const rows = await page.evaluate(() => document.querySelectorAll("[data-src]").length);
      assert("the source filter rendered something to filter with", rows > 0);

      // Use the "Exclude all" control the UI provides, per group — the same path a
      // user takes, rather than synthesising clicks on the tri-state chips.
      /* One group at a time, re-querying between clicks. The filter re-renders on
         every change, so a list of buttons collected up front goes stale after the
         first click and the rest land on detached nodes — which silently excluded
         one group of 37 and left the test asserting against a full corpus. */
      const groups = await page.evaluate(async () => {
        const names = [...document.querySelectorAll("[data-src-none]")]
          .map(b => b.getAttribute("data-src-none"));
        for (const g of names) {
          const b = document.querySelector(`[data-src-none="${g}"]`);
          if (b) b.click();
          await new Promise(r => setTimeout(r, 120));
        }
        return names.length;
      });
      assert("the filter offers an 'exclude all' control per group", groups > 0);
      await page.waitForTimeout(1400);
      const txt = await resultsText(page);
      assert("excluding every book says so, rather than showing a blank panel",
        /nothing left to rank|every book is excluded/i.test(txt));
      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }


    /* ---------------------------------------------------------- */
    section("playtest feedback: the symptom list is browsable");
    {
      const { ctx, page } = await fresh(browser);
      /* It used to render nothing until you typed a matching term, which made the
         highest-value input in the tool look like a text box that did nothing. */
      const b = await page.evaluate(() => ({
        groups: document.querySelectorAll("#sym-results .sym-group").length,
        options: document.querySelectorAll("#sym-results .sym-hit").length,
      }));
      assert("every symptom offered is listed before you type anything", b.options > 90);
      /* The ten damage-type sentences moved into the attack rows, where the type can be
         tied to the action that dealt it. Offering both would score the same evidence
         twice and invite the user to answer in the weaker place. */
      const dmgSentences = await page.evaluate(() =>
        [...document.querySelectorAll("#sym-results .sym-hit")]
          .filter(x => /it burned me|it hit me with cold|deafening boom/i.test(x.textContent)).length);
      assertEqual("the damage-type sentences are not offered here any more", dmgSentences, 0);
      assert("...grouped, rather than as one wall of sentences", b.groups > 5);

      // Searching still narrows it.
      await page.fill("#sym-search", "healed between");
      await page.waitForTimeout(600);
      const narrowed = await page.evaluate(() =>
        document.querySelectorAll("#sym-results .sym-hit").length);
      assert("typing narrows the list", narrowed > 0 && narrowed < b.options);

      /* The sentences avoid naming the mechanic on purpose, which leaves several of
         them reading as near-synonyms. The mechanics are named under each one. */
      await page.fill("#sym-search", "friends were nearby");
      await page.waitForTimeout(600);
      const packTactics = await page.evaluate(() => {
        const row = [...document.querySelectorAll("#sym-results .sym-row")]
          .find(x => /friends were nearby/.test(x.textContent));
        return row ? row.textContent : null;
      });
      assert("a symptom names the mechanic it looks for",
        packTactics && /Pack Tactics/.test(packTactics));
      assert("...after the player's own words, not instead of them",
        packTactics && /friends were nearby/.test(packTactics));

      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("playtest feedback: damage options toggle off");
    {
      const { ctx, page } = await fresh(browser);
      assertEqual("the clear buttons are gone",
        await page.evaluate(() => document.querySelectorAll("[data-dmg-clear]").length), 0);

      const click = () => page.evaluate(() =>
        document.querySelector('input[data-dmg="fire"][value="immune"]').click());
      const checked = () => page.evaluate(() =>
        document.querySelector('input[data-dmg="fire"][value="immune"]').checked);

      await click(); await page.waitForTimeout(500);
      assertEqual("clicking an option selects it", await checked(), true);
      await click(); await page.waitForTimeout(500);
      assertEqual("clicking it again unselects it", await checked(), false);
      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("playtest feedback: named NPCs can be hidden");
    {
      const { ctx, page } = await fresh(browser);
      await pickSymptom(page, "healed between", "It healed between rounds");
      const names = () => page.evaluate(() =>
        [...document.querySelectorAll("#results .result-name button")].map(x => x.textContent.trim()));

      const before = await names();
      await page.evaluate(() => document.getElementById("in-hide-named").click());
      await page.waitForTimeout(1200);
      const after = await names();

      assert("the filter is off by default — a named NPC can be what you fought",
        before.length > 0);
      assert("turning it on removes at least one candidate", 
        before.some(n => !after.includes(n)));
      assert("...and backfills rather than shortening the list",
        after.length >= Math.min(before.length, 10));
      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }


    /* ---------------------------------------------------------- */
    section("playtest feedback: bounds from the dice");
    {
      const { ctx, page } = await fresh(browser);

      // The transcript: "16, 8, 13, which hit?" / "16 hits, the rest miss".
      await page.fill("#in-ac-hit", "16");
      await page.fill("#in-ac-miss", "8, 13");
      await page.waitForTimeout(900);
      const acRead = await page.$eval("#ac-range-read", e => e.textContent);
      assert("the AC bound reads back in words, so a typo is visible",
        /between 14 and 16/.test(acRead));

      // "I'll only tell you if you pass or fail." Rolled 18, passed.
      await page.fill("#in-dc-pass", "18");
      await page.waitForTimeout(700);
      assert("a passed save caps the DC",
        /at most 18/.test(await page.$eval("#dc-range-read", e => e.textContent)));

      /* Impossible input has to LOOK impossible. Silently reconciling it would mean
         inventing evidence, and the user would never know. */
      await page.fill("#in-ac-hit", "13");
      await page.fill("#in-ac-miss", "16");
      await page.waitForTimeout(800);
      const bad = await page.$eval("#ac-range-read", e => e.textContent);
      const flagged = await page.$eval("#ac-range-read", e => e.className.includes("bad"));
      assert("a contradiction says so", /can't both be true/.test(bad));
      assertEqual("...and is styled as a problem, not a hint", flagged, true);

      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("playtest feedback: how it fought");
    {
      const { ctx, page } = await fresh(browser);

      /* One row per action. The whole point is that the fields are true of the SAME
         action, which the old three-bags-of-chips version could not express. */
      await page.click("#atk-add");
      const fields = await page.evaluate(() =>
        [...document.querySelectorAll('#atk-rows [data-field]')].map(x => x.dataset.field));
      assert("an attack row asks how many, what kind, what it rolled, how far, and what damage",
        ["count", "kind", "rolls", "reach", "dmg", "dmgType", "condition"]
          .every(f => fields.includes(f)));

      await page.selectOption('#atk-rows [data-field="kind"]', "melee weapon");
      await page.selectOption('#atk-rows [data-field="dmgType"]', "fire");
      await page.waitForTimeout(1400);

      const paired = await resultsText(page);
      assert("a filled row ranks something", /1\./.test(paired));
      /* THE BUG THIS FEATURE EXISTS TO FIX. Scored against the monster, "a melee
         attack" and "fire damage" matched every dragon. Scored against one entry it
         has to be a creature whose melee attack itself deals fire. */
      assert("...and the reason names the single action that explains both",
        /melee weapon/i.test(paired) && /fire/i.test(paired));
      const top = await page.evaluate(() =>
        (document.querySelector("#results .result .name, #results .result") || {}).textContent || "");
      assert("a creature whose own melee attack burns, not merely one with a breath weapon",
        /azer|magmin|salamander|elemental|hell|fire/i.test(top + paired));

      // Counts add up to attack rolls per turn, rather than being asked for twice.
      await page.fill('#atk-rows [data-field="count"]', "2");
      await page.waitForTimeout(900);
      const total = await page.$eval("#atk-total", el => el.textContent);
      assert("the attack total is derived from the rows and shown back", /2 attack rolls/.test(total));

      // A save row is a different shape and gets different questions.
      await page.click("#sav-add");
      const saveFields = await page.evaluate(() =>
        [...document.querySelectorAll('#sav-rows [data-field]')].map(x => x.dataset.field));
      assert("a save row asks which save, the DC, the area and what it left us with",
        ["abil", "dc", "area", "condition"].every(f => saveFields.includes(f)));

      await page.selectOption('#sav-rows [data-field="abil"]', "dex");
      await page.fill('#sav-rows [data-field="dc"]', "18");
      await page.waitForTimeout(1200);
      assert("the save row ranks too", /dex save/i.test(await resultsText(page)));

      // Rows are removable, and removing the last one leaves no residue.
      await page.click('#sav-rows .rowdel');
      await page.waitForTimeout(600);
      const gone = await page.evaluate(() => document.querySelectorAll("#sav-rows .combatrow").length);
      assertEqual("a row can be removed again", gone, 0);

      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("playtest feedback: what it cast");
    {
      const { ctx, page } = await fresh(browser);

      const vocab = await page.evaluate(() =>
        document.querySelectorAll("#spell-list option").length);
      assert("the spell list is built from the loaded books, not hardcoded", vocab > 200);

      await page.fill("#in-spell", "counterspell");
      await page.waitForTimeout(1200);
      const chosen = await page.$eval("#spell-chosen", el => el.textContent);
      assert("a recognised spell becomes a chip", /counterspell/i.test(chosen));
      const box = await page.$eval("#in-spell", el => el.value);
      assertEqual("...and the box clears, ready for the next one", box, "");

      const txt = await resultsText(page);
      assert("a spell alone ranks something", /1\./.test(txt));

      /* THE POINT OF THE MODULE. GMs re-prepare spells constantly, so a spell the
         statblock lacks is weak evidence against it — and the page has to SAY that,
         or a user reading "against: cure wounds" concludes the tool ruled it out. */
      await page.fill("#in-spell", "cure wounds");
      await page.waitForTimeout(1400);
      const withMiss = await resultsText(page);
      assert("a spell the statblock lacks is shown as weak, with the reason why",
        /re-prepare/i.test(withMiss));

      // How it cast is a different question, asked separately and weighed in full.
      const clicked = await pickChip(page, "pick-castingKind", "innate");
      assert("how it cast is asked separately from what it cast", clicked);
      await page.waitForTimeout(800);
      assert("...and ranks on its own", /1\./.test(await resultsText(page)));
      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("playtest feedback: naming the mechanic directly");
    {
      const { ctx, page } = await fresh(browser);
      /* A symptom is vague on purpose — the players never hear the name — but GMs do
         say it out loud, and then the party knows something the sentence cannot
         express. The parent and its mechanics are a select-all relationship. */
      await page.fill("#sym-search", "specific spell had no effect");
      await page.waitForTimeout(800);

      // The search returns several rows; everything below is scoped to the one we mean.
      const ROW = "One specific spell had no effect";
      const inRow = body => page.evaluate(([label, b]) => {
        const row = [...document.querySelectorAll("#sym-results .sym-row")]
          .find(r => r.querySelector(".sym-hit").textContent.includes(label));
        return row ? new Function("row", b)(row) : null;
      }, [ROW, body]);

      const subs = () => inRow(`return [...row.querySelectorAll(".sym-sub")]
        .map(b => ({ text: b.textContent.trim(), on: b.classList.contains("on") }));`);
      const parentOn = () => inRow(`const b = row.querySelector(".sym-hit");
        return b.classList.contains("on") ? "all" : b.classList.contains("part") ? "some" : "none";`);
      const clickIn = sel => page.evaluate(([label, t]) => {
        const row = [...document.querySelectorAll("#sym-results .sym-row")]
          .find(r => r.querySelector(".sym-hit").textContent.includes(label));
        const el = t === ".sym-hit" ? row.querySelector(".sym-hit")
          : [...row.querySelectorAll(".sym-sub")].find(b => new RegExp(t, "i").test(b.textContent));
        el.click();
      }, [ROW, sel]);

      const before = await subs();
      assertEqual("each mechanic under the sentence is its own button", before.length, 3);
      assert("...named, so a GM's word can be matched to one",
        before.some(b => /Antimagic Susceptibility/i.test(b.text)));
      assert("...and none is selected yet", before.every(b => !b.on));

      await clickIn(".sym-hit");
      await page.waitForTimeout(900);
      assertEqual("clicking the sentence selects all of its mechanics", await parentOn(), "all");
      assert("...visibly, on the children too", (await subs()).every(b => b.on));

      // Turning one child off narrows the claim; the parent goes half-selected.
      await clickIn("Antimagic");
      await page.waitForTimeout(900);
      assertEqual("deselecting one mechanic leaves the sentence partly selected",
        await parentOn(), "some");
      assertEqual("...and exactly that one is off",
        (await subs()).filter(b => !b.on).length, 1);
      assert("the chip says which mechanics survived, since it is the only place you'd see it",
        /Spell Immunity/i.test(await page.$eval("#sym-chosen", el => el.textContent)));

      // Turning it back on widens it to the whole sentence again.
      await clickIn("Antimagic");
      await page.waitForTimeout(900);
      assertEqual("selecting the last mechanic promotes it back to the whole sentence",
        await parentOn(), "all");

      /* THE POINT OF THE FEATURE: a narrowed claim ranks differently from the vague
         one. Antimagic Susceptibility is the animated objects; Spell Immunity is the
         Helmed Horror. The sentence alone cannot tell them apart. */
      await clickIn("Spell Immunity");
      await clickIn("immune to a named spell");
      await page.waitForTimeout(1600);
      assert("naming one mechanic ranks the creatures that have THAT one",
        /flying sword|animated armor|rug of smothering/i.test(await resultsText(page)));

      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }

    /* ---------------------------------------------------------- */
    section("clearing puts it back to the start");
    {
      const { ctx, page } = await fresh(browser);
      await pickSymptom(page, "healed between", "It healed between rounds");
      const cleared = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")]
          .find(x => /^clear observations/i.test(x.textContent.trim()));
        if (b) { b.click(); return true; }
        return false;
      });
      await page.waitForTimeout(800);
      assertEqual("the clear control exists", cleared, true);
      assert("clearing empties the evidence",
        /nothing observed yet/i.test(await resultsText(page)));
      assertEqual("no JavaScript errors", page.__errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (!KEEP) server.close();
    else console.log(`\n  server left up on ${BASE}`);
  }

  report("ui");
}

main().catch(e => {
  console.error("\nbrowser suite crashed:\n", e);
  process.exitCode = 1;
});
