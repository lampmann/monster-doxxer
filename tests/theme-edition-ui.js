/* Standalone browser checks using invented data; no sourcebooks required.
   NODE_PATH=/path/to/playwright/node_modules node tests/theme-edition-ui.js */
"use strict";
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const fixtures = {
  "/data/bestiary/index.json": { MM: "test.json" },
  "/data/bestiary/test.json": { monster: [
    { name: "Test Classic", source: "MM", type: "beast", size: ["M"], ac: [12], hp: { average: 20 }, cr: "1" },
    { name: "Test Modern", source: "XMM", type: "beast", size: ["M"], ac: [12], hp: { average: 20 }, cr: "1" },
  ] },
};
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (fixtures[pathname]) {
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(fixtures[pathname])); return;
  }
  const file = path.resolve(root, "." + pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream"); res.end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(() => document.querySelector("#corpus-status").textContent.includes("2 monsters"));
    assert.equal(await page.locator("#in-2024").isChecked(), false);
    await page.locator("#in-name").fill("Test");
    await page.waitForFunction(() => document.querySelector(".col-results").textContent.includes("Test Classic"));
    assert.equal(await page.locator(".result-name").filter({ hasText: "Test Modern" }).count(), 0);
    await page.locator("#in-2024").check();
    await page.locator(".result-name").filter({ hasText: "Test Modern" }).waitFor();
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#in-2024").checked);
    await page.locator(".result-name").filter({ hasText: "Test Modern" }).waitFor();
    await page.locator("#in-2024").uncheck();
    assert.equal(await page.locator(".result-name").filter({ hasText: "Test Modern" }).count(), 0);
    const themes = JSON.parse(fs.readFileSync(path.join(root, "css/themes/index.json")));
    await page.waitForFunction(n => document.querySelector("#theme-select").options.length === n, Object.keys(themes).length);
    for (const [name, file] of Object.entries(themes)) {
      await page.locator("#theme-select").selectOption({ label: name });
      if (file) await page.waitForFunction(() => document.querySelector("#theme-css").sheet);
      const expected = file ? fs.readFileSync(path.join(root, "css/themes", file), "utf8").match(/--bg:\s*([^;]+)/)[1].trim() : "#fff";
      await page.waitForFunction(bg => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim().toLowerCase() === bg.toLowerCase(), expected);
    }
    await page.locator("#theme-select").selectOption({ label: "Truesight Dark" });
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#theme-select").value === "truesight-dark.css");
    assert.equal(await page.locator('link[rel="icon"]').getAttribute("href"), "icons/thumbnail.png");
    assert.equal((await page.request.get(new URL("/icons/thumbnail.png", page.url()).href)).status(), 200);
    assert.deepEqual(errors, []);
    console.log("2024 filtering and persistence, all 31 themes, saved theme, and thumbnail passed");
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
